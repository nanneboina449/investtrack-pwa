-- ============================================================
-- InvestTrack — FULL SETUP (idempotent)
--
-- Run this single file in the Supabase SQL Editor against an existing
-- InvestTrack database. It applies every schema change, RPC, view,
-- trigger, RLS policy, and data-hygiene fix from the entire migration
-- history in one go.
--
-- Safe to re-run. All operations use IF NOT EXISTS / CREATE OR REPLACE
-- / DROP IF EXISTS patterns.
--
-- Prereqs:
--   * Base tables from full_schema.sql (projects, investors,
--     profit_records, project_expenses, cash_adjustments,
--     loan_contributions, loan_repayments, repayment_distributions,
--     project_members) must already exist.
-- ============================================================

-- ============================================================
-- 1. COLUMN ADDITIONS (idempotent)
-- ============================================================

-- 1a. Loan interest (flat % on principal)
alter table cash_adjustments
  add column if not exists interest_rate_percent numeric(6, 2) not null default 0
    check (interest_rate_percent >= 0 and interest_rate_percent <= 100);

-- 1b. Expense paid by which investor
alter table project_expenses
  add column if not exists paid_by_investor_id uuid references investors(id) on delete set null;

create index if not exists project_expenses_paid_by_idx on project_expenses(paid_by_investor_id);

-- ============================================================
-- 2. NEW TABLES
-- ============================================================

-- 2a. investor_payments ledger
create table if not exists investor_payments (
  id           uuid primary key default uuid_generate_v4(),
  investor_id  uuid references investors(id)        on delete cascade not null,
  project_id   uuid references projects(id)         on delete cascade not null,
  amount       numeric(15, 2) not null check (amount > 0),
  payment_type text not null
                 check (payment_type in ('share_contribution', 'expense_paid', 'top_up', 'refund')),
  expense_id   uuid references project_expenses(id) on delete set null,
  payment_date date not null default current_date,
  notes        text,
  created_at   timestamptz default now()
);

create index if not exists investor_payments_investor_idx on investor_payments(investor_id);
create index if not exists investor_payments_project_idx  on investor_payments(project_id);
create index if not exists investor_payments_expense_idx  on investor_payments(expense_id);

-- 2b. Cross-project link columns on investor_payments
alter table investor_payments
  add column if not exists source_project_id        uuid references projects(id),
  add column if not exists source_investor_id       uuid references investors(id),
  add column if not exists destination_project_id   uuid references projects(id),
  add column if not exists destination_investor_id  uuid references investors(id);

create index if not exists investor_payments_source_project_idx      on investor_payments(source_project_id);
create index if not exists investor_payments_destination_project_idx on investor_payments(destination_project_id);

-- 2c. profit_distributions table
create table if not exists profit_distributions (
  id          uuid primary key default uuid_generate_v4(),
  profit_id   uuid references profit_records(id) on delete cascade not null,
  investor_id uuid references investors(id)      on delete cascade not null,
  amount      numeric(15, 2) not null,
  created_at  timestamptz default now(),
  unique (profit_id, investor_id)
);

create index if not exists profit_distributions_profit_idx   on profit_distributions(profit_id);
create index if not exists profit_distributions_investor_idx on profit_distributions(investor_id);

-- ============================================================
-- 3. DROP OLD AUTO-TRIGGERS THAT CONFLATED COMMITMENT WITH PAID
-- (safe if they don't exist)
-- ============================================================
drop trigger if exists investors_to_payment        on investors;
drop trigger if exists payments_to_investor_amount on investor_payments;
drop function if exists sync_investor_to_payment() cascade;
drop function if exists sync_amount_invested()     cascade;

-- ============================================================
-- 4. TRIGGER: expense paid by investor → auto-create payment row
-- ============================================================
create or replace function sync_expense_to_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.paid_by_investor_id is not null then
    insert into investor_payments
      (investor_id, project_id, amount, payment_type, expense_id, payment_date, notes)
    values
      (NEW.paid_by_investor_id, NEW.project_id, NEW.amount, 'expense_paid', NEW.id,
       NEW.expense_date,
       'Paid ' || NEW.category || ' expense: ' || NEW.description);
  end if;
  return NEW;
end;
$$;

drop trigger if exists expenses_to_payment on project_expenses;
create trigger expenses_to_payment
  after insert on project_expenses
  for each row execute function sync_expense_to_payment();

-- ============================================================
-- 4b. TRIGGER: scale investor commitments when project pool changes
-- ============================================================
create or replace function scale_investor_commitments_on_project_change()
returns trigger
language plpgsql
as $$
declare
  old_pool numeric;
  new_pool numeric;
begin
  old_pool := coalesce(OLD.total_value, 0) * coalesce(OLD.our_stake_percent, 100) / 100;
  new_pool := coalesce(NEW.total_value, 0) * coalesce(NEW.our_stake_percent, 100) / 100;

  if old_pool > 0 and abs(new_pool - old_pool) > 0.01 then
    update investors
    set amount_invested = round(amount_invested * (new_pool / old_pool), 2)
    where project_id = NEW.id;
  end if;

  return NEW;
end;
$$;

drop trigger if exists projects_scale_investor_commitments on projects;
create trigger projects_scale_investor_commitments
  after update of total_value, our_stake_percent on projects
  for each row execute function scale_investor_commitments_on_project_change();

-- ============================================================
-- 4c. TRIGGER: keep denormalized investor_name fields in sync
-- (loan_contributions and repayment_distributions store the
-- investor's name as text so they survive investor deletion. When
-- an investor is renamed, fan the new name out to those rows.)
-- ============================================================
create or replace function sync_investor_name_to_denormalized()
returns trigger
language plpgsql
as $$
begin
  if NEW.name is distinct from OLD.name then
    update loan_contributions
      set investor_name = NEW.name
      where investor_id = NEW.id;

    update repayment_distributions
      set investor_name = NEW.name
      where loan_contribution_id in (
        select id from loan_contributions where investor_id = NEW.id
      );
  end if;
  return NEW;
end;
$$;

drop trigger if exists investors_name_sync on investors;
create trigger investors_name_sync
  after update of name on investors
  for each row execute function sync_investor_name_to_denormalized();

-- ============================================================
-- 5. RLS POLICIES — re-create idempotently
-- ============================================================
alter table investor_payments      enable row level security;
alter table profit_distributions   enable row level security;

-- investor_payments
drop policy if exists "payments_select" on investor_payments;
create policy "payments_select" on investor_payments
  for select using (
    exists (
      select 1 from projects p
      where p.id = investor_payments.project_id
        and (
          p.user_id = auth.uid()
          or exists (
            select 1 from project_members pm
            where pm.project_id = p.id and pm.user_id = auth.uid() and pm.status = 'accepted'
          )
        )
    )
  );

drop policy if exists "payments_insert" on investor_payments;
create policy "payments_insert" on investor_payments
  for insert with check (
    exists (
      select 1 from projects p
      where p.id = investor_payments.project_id
        and (
          p.user_id = auth.uid()
          or exists (
            select 1 from project_members pm
            where pm.project_id = p.id and pm.user_id = auth.uid()
              and pm.role in ('owner', 'editor') and pm.status = 'accepted'
          )
        )
    )
  );

drop policy if exists "payments_update" on investor_payments;
create policy "payments_update" on investor_payments
  for update using (
    exists (
      select 1 from projects p
      where p.id = investor_payments.project_id
        and (
          p.user_id = auth.uid()
          or exists (
            select 1 from project_members pm
            where pm.project_id = p.id and pm.user_id = auth.uid()
              and pm.role in ('owner', 'editor') and pm.status = 'accepted'
          )
        )
    )
  );

drop policy if exists "payments_delete" on investor_payments;
create policy "payments_delete" on investor_payments
  for delete using (
    exists (
      select 1 from projects p
      where p.id = investor_payments.project_id
        and (
          p.user_id = auth.uid()
          or exists (
            select 1 from project_members pm
            where pm.project_id = p.id and pm.user_id = auth.uid()
              and pm.role = 'owner' and pm.status = 'accepted'
          )
        )
    )
  );

grant all privileges on investor_payments to authenticated, service_role;

-- profit_distributions
drop policy if exists "pd_select" on profit_distributions;
create policy "pd_select" on profit_distributions
  for select using (
    exists (
      select 1 from profit_records pr
      join projects p on p.id = pr.project_id
      where pr.id = profit_distributions.profit_id
        and (
          p.user_id = auth.uid()
          or exists (
            select 1 from project_members pm
            where pm.project_id = p.id and pm.user_id = auth.uid() and pm.status = 'accepted'
          )
        )
    )
  );

drop policy if exists "pd_insert" on profit_distributions;
create policy "pd_insert" on profit_distributions
  for insert with check (
    exists (
      select 1 from profit_records pr
      join projects p on p.id = pr.project_id
      where pr.id = profit_distributions.profit_id
        and (
          p.user_id = auth.uid()
          or exists (
            select 1 from project_members pm
            where pm.project_id = p.id and pm.user_id = auth.uid()
              and pm.role in ('owner', 'editor') and pm.status = 'accepted'
          )
        )
    )
  );

drop policy if exists "pd_update" on profit_distributions;
create policy "pd_update" on profit_distributions
  for update using (
    exists (
      select 1 from profit_records pr
      join projects p on p.id = pr.project_id
      where pr.id = profit_distributions.profit_id
        and (
          p.user_id = auth.uid()
          or exists (
            select 1 from project_members pm
            where pm.project_id = p.id and pm.user_id = auth.uid()
              and pm.role in ('owner', 'editor') and pm.status = 'accepted'
          )
        )
    )
  );

drop policy if exists "pd_delete" on profit_distributions;
create policy "pd_delete" on profit_distributions
  for delete using (
    exists (
      select 1 from profit_records pr
      join projects p on p.id = pr.project_id
      where pr.id = profit_distributions.profit_id
        and (
          p.user_id = auth.uid()
          or exists (
            select 1 from project_members pm
            where pm.project_id = p.id and pm.user_id = auth.uid()
              and pm.role = 'owner' and pm.status = 'accepted'
          )
        )
    )
  );

grant all privileges on profit_distributions to authenticated, service_role;

-- ============================================================
-- 6. DATA HYGIENE — case + whitespace fixup on investor names
-- ============================================================
update investors
set name = regexp_replace(trim(name), '\s+', ' ', 'g')
where name <> regexp_replace(trim(name), '\s+', ' ', 'g');

create index if not exists investors_normalized_name_idx
  on investors (project_id, (lower(trim(name))));

-- ============================================================
-- 7. BACKFILLS for historical data
-- ============================================================

-- 7a. profit_distributions for pre-existing profit records
insert into profit_distributions (profit_id, investor_id, amount)
select
  pr.id, i.id,
  round(pr.amount * i.share_percent / 100, 2)
from profit_records pr
join investors i on i.project_id = pr.project_id
where not exists (
  select 1 from profit_distributions pd
  where pd.profit_id = pr.id and pd.investor_id = i.id
);

-- 7b. investor_payments rows for expenses that have paid_by_investor_id
--     set but never got a matching payment row (likely created before the
--     trigger existed, or before this migration ran).
insert into investor_payments
  (investor_id, project_id, amount, payment_type, expense_id, payment_date, notes)
select
  e.paid_by_investor_id, e.project_id, e.amount, 'expense_paid', e.id,
  e.expense_date, 'Paid ' || e.category || ' expense (backfilled)'
from project_expenses e
where e.paid_by_investor_id is not null
  and not exists (
    select 1 from investor_payments p where p.expense_id = e.id
  );

-- ============================================================
-- 8. VIEWS — replace with current versions
-- ============================================================

-- 8a. my_projects (subquery-based to avoid Cartesian fanout)
create or replace view my_projects as
select
  p.*,
  round(p.total_value * p.our_stake_percent / 100, 2)                            as our_pool_value,
  coalesce((select sum(amount_invested) from investors      where project_id = p.id), 0) as total_raised,
  coalesce((select sum(amount)          from profit_records where project_id = p.id), 0) as total_profit,
  coalesce((select sum(amount)          from project_expenses where project_id = p.id), 0) as total_expenses,
  coalesce((select sum(amount)          from profit_records where project_id = p.id), 0) -
  coalesce((select sum(amount)          from project_expenses where project_id = p.id), 0) as net_profit,
  (select count(*) from investors where project_id = p.id)                       as investor_count,
  case when p.user_id = auth.uid() then 'owner' else pm.role end                 as my_role,
  case when p.user_id = auth.uid() then true   else false        end             as is_owner
from projects p
left join project_members pm
  on pm.project_id = p.id and pm.user_id = auth.uid() and pm.status = 'accepted'
where p.user_id = auth.uid() or pm.id is not null;

-- 8b. project_summary (same subquery treatment)
create or replace view project_summary as
select
  p.id, p.user_id, p.name, p.description, p.total_value,
  p.our_stake_percent,
  round(p.total_value * p.our_stake_percent / 100, 2)                                     as our_pool_value,
  p.status, p.start_date, p.end_date,
  coalesce((select sum(amount_invested) from investors      where project_id = p.id), 0)  as total_raised,
  coalesce((select sum(amount)          from profit_records where project_id = p.id), 0)  as total_profit,
  coalesce((select sum(amount)          from project_expenses where project_id = p.id), 0) as total_expenses,
  coalesce((select sum(amount)          from profit_records where project_id = p.id), 0) -
  coalesce((select sum(amount)          from project_expenses where project_id = p.id), 0) as net_profit,
  (select count(*) from investors where project_id = p.id)                                as investor_count
from projects p;

-- 8c. loan_summary (with interest fields)
create or replace view loan_summary as
select
  ca.id, ca.user_id, ca.type,
  ca.amount                                                          as total_loan_amount,
  ca.description, ca.counterparty,
  ca.adjustment_date                                                 as loan_date,
  ca.is_settled, ca.settled_date,
  coalesce(sum(lr.amount), 0)                                        as total_repaid,
  round(ca.amount * (1 + ca.interest_rate_percent / 100), 2)
    - coalesce(sum(lr.amount), 0)                                    as outstanding_balance,
  count(distinct lc.id)                                              as contributor_count,
  json_agg(distinct jsonb_build_object(
    'investor_name', lc.investor_name,
    'project_id',    lc.project_id,
    'amount',        lc.amount
  )) filter (where lc.id is not null)                                as contributions,
  json_agg(distinct jsonb_build_object(
    'repayment_id',  lr.id,
    'amount',        lr.amount,
    'type',          lr.repayment_type,
    'to_project_id', lr.to_project_id,
    'date',          lr.repayment_date
  )) filter (where lr.id is not null)                                as repayments,
  ca.interest_rate_percent,
  round(ca.amount * ca.interest_rate_percent / 100, 2)               as interest_amount,
  round(ca.amount * (1 + ca.interest_rate_percent / 100), 2)         as total_due_with_interest
from cash_adjustments ca
left join loan_contributions lc on lc.loan_id = ca.id
left join loan_repayments lr    on lr.loan_id  = ca.id
where ca.type in ('loan_given','loan_received')
group by ca.id;

-- ============================================================
-- 9. RPC: process_loan_repayment — interest + project_adjustment + case-insensitive match
-- ============================================================
create or replace function process_loan_repayment(
  p_loan_id       uuid,
  p_amount        numeric,
  p_type          text,
  p_to_project_id uuid default null,
  p_date          date default current_date,
  p_notes         text default null
) returns uuid
language plpgsql
as $$
declare
  v_repayment_id      uuid;
  v_total_contributed numeric;
  v_contribution      record;
  v_dist_amount       numeric;
  v_dest_investor_id  uuid;
begin
  insert into loan_repayments (loan_id, amount, repayment_type, to_project_id, repayment_date, notes)
  values (p_loan_id, p_amount, p_type, p_to_project_id, p_date, p_notes)
  returning id into v_repayment_id;

  select sum(amount) into v_total_contributed
  from loan_contributions where loan_id = p_loan_id;

  if v_total_contributed > 0 then
    for v_contribution in (
      select id, investor_id, investor_name, project_id, amount
      from loan_contributions where loan_id = p_loan_id
    ) loop
      v_dist_amount := round((v_contribution.amount / v_total_contributed) * p_amount, 2);

      insert into repayment_distributions
        (repayment_id, loan_contribution_id, investor_name, project_id, amount_returned)
      values
        (v_repayment_id, v_contribution.id, v_contribution.investor_name,
         v_contribution.project_id, v_dist_amount);

      if p_type = 'project_adjustment' and p_to_project_id is not null then
        select id into v_dest_investor_id
        from investors
        where project_id = p_to_project_id
          and lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
              = lower(regexp_replace(trim(v_contribution.investor_name), '\s+', ' ', 'g'))
        limit 1;

        if v_dest_investor_id is not null then
          insert into investor_payments
            (investor_id, project_id, amount, payment_type, payment_date, notes,
             source_project_id, source_investor_id)
          values
            (v_dest_investor_id, p_to_project_id, v_dist_amount, 'top_up',
             p_date,
             'From loan repayment on source project',
             v_contribution.project_id, v_contribution.investor_id);
        end if;
      end if;
    end loop;
  end if;

  update cash_adjustments ca
  set is_settled = true, settled_date = p_date
  where ca.id = p_loan_id
    and (select coalesce(sum(amount),0) from loan_repayments where loan_id = p_loan_id)
        >= ca.amount * (1 + ca.interest_rate_percent / 100);

  return v_repayment_id;
end;
$$;

grant execute on function process_loan_repayment(uuid, numeric, text, uuid, date, text)
  to authenticated, service_role;

-- ============================================================
-- 10. RPC: create_profit_record — supports custom split distributions
-- ============================================================
create or replace function create_profit_record(
  p_project_id    uuid,
  p_amount        numeric,
  p_record_date   date,
  p_notes         text default null,
  p_distributions json default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into profit_records (project_id, amount, record_date, notes)
  values (p_project_id, p_amount, p_record_date, p_notes)
  returning id into v_id;

  if p_distributions is not null then
    insert into profit_distributions (profit_id, investor_id, amount)
    select v_id, (d->>'investor_id')::uuid, (d->>'amount')::numeric
    from json_array_elements(p_distributions) d;
  else
    insert into profit_distributions (profit_id, investor_id, amount)
    select v_id, i.id, round(p_amount * i.share_percent / 100, 2)
    from investors i where i.project_id = p_project_id;
  end if;

  return v_id;
end;
$$;

grant execute on function create_profit_record(uuid, numeric, date, text, json)
  to authenticated, service_role;

-- ============================================================
-- 11. RPC: reallocate_investor_position — atomic linked refund + top_up
-- ============================================================
create or replace function reallocate_investor_position(
  p_source_investor_id   uuid,
  p_dest_project_id      uuid,
  p_amount               numeric,
  p_date                 date default current_date,
  p_notes                text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_project_id uuid;
  v_source_name       text;
  v_dest_investor_id  uuid;
  v_refund_id         uuid;
  v_topup_id          uuid;
begin
  select project_id, name into v_source_project_id, v_source_name
  from investors where id = p_source_investor_id;

  if v_source_project_id is null then
    raise exception 'Source investor not found';
  end if;

  if v_source_project_id = p_dest_project_id then
    raise exception 'Source and destination projects must be different';
  end if;

  if p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  select id into v_dest_investor_id
  from investors
  where project_id = p_dest_project_id
    and lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
        = lower(regexp_replace(trim(v_source_name), '\s+', ' ', 'g'))
  limit 1;

  if v_dest_investor_id is null then
    raise exception 'No investor named "%" on the destination project (matched case + spacing insensitively). Add them there first.', v_source_name;
  end if;

  insert into investor_payments
    (investor_id, project_id, amount, payment_type, payment_date, notes,
     destination_project_id, destination_investor_id)
  values
    (p_source_investor_id, v_source_project_id, p_amount, 'refund',
     p_date, coalesce(p_notes, 'Reallocated to destination project'),
     p_dest_project_id, v_dest_investor_id)
  returning id into v_refund_id;

  insert into investor_payments
    (investor_id, project_id, amount, payment_type, payment_date, notes,
     source_project_id, source_investor_id)
  values
    (v_dest_investor_id, p_dest_project_id, p_amount, 'top_up',
     p_date, coalesce(p_notes, 'Reallocated from source project'),
     v_source_project_id, p_source_investor_id)
  returning id into v_topup_id;

  return v_topup_id;
end;
$$;

grant execute on function reallocate_investor_position(uuid, uuid, numeric, date, text)
  to authenticated, service_role;

-- ============================================================
-- 11b. RPC: transfer_funds_as_loan — A's funds used for B (B owes A)
-- ============================================================
create or replace function transfer_funds_as_loan(
  p_source_investor_id uuid,
  p_dest_investor_id   uuid,
  p_amount             numeric,
  p_interest_pct       numeric default 0,
  p_date               date default current_date,
  p_notes              text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_project_id uuid;
  v_dest_project_id   uuid;
  v_source_name       text;
  v_dest_name         text;
  v_user_id           uuid;
  v_loan_id           uuid;
begin
  v_user_id := auth.uid();

  if p_source_investor_id = p_dest_investor_id then
    raise exception 'Source and destination investors must be different';
  end if;
  if p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;
  if p_interest_pct < 0 or p_interest_pct > 100 then
    raise exception 'Interest rate must be between 0 and 100';
  end if;

  select project_id, name into v_source_project_id, v_source_name
  from investors where id = p_source_investor_id;
  if v_source_project_id is null then
    raise exception 'Source investor not found';
  end if;

  select project_id, name into v_dest_project_id, v_dest_name
  from investors where id = p_dest_investor_id;
  if v_dest_project_id is null then
    raise exception 'Destination investor not found';
  end if;

  insert into cash_adjustments
    (user_id, type, amount, description, counterparty, adjustment_date,
     interest_rate_percent, from_project_id)
  values
    (v_user_id, 'loan_given', p_amount,
     'Inter-investor loan: ' || v_source_name || ' → ' || v_dest_name,
     v_dest_name,
     p_date,
     coalesce(p_interest_pct, 0),
     v_source_project_id)
  returning id into v_loan_id;

  insert into loan_contributions
    (loan_id, investor_id, investor_name, project_id, amount)
  values
    (v_loan_id, p_source_investor_id, v_source_name, v_source_project_id, p_amount);

  insert into investor_payments
    (investor_id, project_id, amount, payment_type, payment_date, notes,
     destination_project_id, destination_investor_id)
  values
    (p_source_investor_id, v_source_project_id, p_amount, 'refund',
     p_date,
     coalesce(p_notes, 'Lent to ' || v_dest_name),
     v_dest_project_id, p_dest_investor_id);

  insert into investor_payments
    (investor_id, project_id, amount, payment_type, payment_date, notes,
     source_project_id, source_investor_id)
  values
    (p_dest_investor_id, v_dest_project_id, p_amount, 'top_up',
     p_date,
     coalesce(p_notes, 'Borrowed from ' || v_source_name),
     v_source_project_id, p_source_investor_id);

  return v_loan_id;
end;
$$;

grant execute on function transfer_funds_as_loan(uuid, uuid, numeric, numeric, date, text)
  to authenticated, service_role;

-- ============================================================
-- 12. Optional helper view for the Payments tab UI
-- ============================================================
create or replace view investor_payment_history as
select
  ip.id,
  ip.investor_id,
  i.name              as investor_name,
  i.share_percent,
  ip.project_id,
  p.name              as project_name,
  ip.amount,
  ip.payment_type,
  ip.expense_id,
  pe.category         as expense_category,
  pe.description      as expense_description,
  ip.payment_date,
  ip.notes,
  ip.created_at,
  ip.source_project_id,
  ip.source_investor_id,
  ip.destination_project_id,
  ip.destination_investor_id
from investor_payments ip
join investors i           on i.id = ip.investor_id
join projects p            on p.id = ip.project_id
left join project_expenses pe on pe.id = ip.expense_id;

-- ============================================================
-- DONE.
-- After running this, hard-refresh the app (Ctrl+Shift+R) so the
-- frontend picks up any cached schema info.
-- ============================================================
