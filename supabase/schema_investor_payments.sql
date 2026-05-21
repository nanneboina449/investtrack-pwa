-- ============================================================
-- InvestTrack - Investor Payment Ledger
-- Run this AFTER full_schema.sql (or schema.sql + schema_expenses.sql)
--
-- Adds a per-investor payment ledger so we can track:
--   * Multiple payments per investor (share + top-ups + refunds)
--   * Expenses paid by a specific investor out of pocket
--
-- After this migration, investor "amount_invested" becomes
-- a derived sum of the ledger rather than a static field.
-- ============================================================

-- ============================================================
-- 1. investor_payments ledger table
-- ============================================================
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

-- ============================================================
-- 2. project_expenses.paid_by_investor_id
-- Null = paid from project cash (default, backward compatible)
-- ============================================================
alter table project_expenses
  add column if not exists paid_by_investor_id uuid references investors(id) on delete set null;

create index if not exists project_expenses_paid_by_idx on project_expenses(paid_by_investor_id);

-- ============================================================
-- 3. Backfill: one share_contribution row per existing investor
-- Skips investors that already have payment rows (idempotent)
-- ============================================================
insert into investor_payments (investor_id, project_id, amount, payment_type, payment_date, notes)
select i.id, i.project_id, i.amount_invested, 'share_contribution', i.joined_at,
       'Backfilled from initial amount_invested'
from investors i
where i.amount_invested > 0
  and not exists (select 1 from investor_payments ip where ip.investor_id = i.id);

-- ============================================================
-- 4. Trigger: when an investor is inserted with amount_invested > 0,
-- auto-create the matching share_contribution payment row.
-- Frontend can keep calling createInvestor() unchanged.
-- ============================================================
create or replace function sync_investor_to_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.amount_invested > 0 then
    insert into investor_payments
      (investor_id, project_id, amount, payment_type, payment_date, notes)
    values
      (NEW.id, NEW.project_id, NEW.amount_invested, 'share_contribution',
       coalesce(NEW.joined_at, current_date),
       'Initial share contribution');
  end if;
  return NEW;
end;
$$;

drop trigger if exists investors_to_payment on investors;
create trigger investors_to_payment
  after insert on investors
  for each row execute function sync_investor_to_payment();

-- ============================================================
-- 5. Trigger: when an expense is inserted with paid_by_investor_id,
-- auto-create the matching expense_paid payment row.
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
-- 6. RLS on investor_payments
-- Mirrors project access: owners + accepted members read,
-- owners + editors write, owners delete.
-- ============================================================
alter table investor_payments enable row level security;

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
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
              and pm.status = 'accepted'
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
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
              and pm.role in ('owner', 'editor')
              and pm.status = 'accepted'
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
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
              and pm.role = 'owner'
              and pm.status = 'accepted'
          )
        )
    )
  );

grant all privileges on investor_payments to authenticated, service_role;

-- ============================================================
-- 7. Updated views: amount_invested now comes from the ledger
-- (refunds subtract; everything else adds)
-- ============================================================

create or replace view investor_profit_summary as
select
  i.id                                                              as investor_id,
  i.project_id,
  i.name                                                            as investor_name,
  i.share_percent,
  coalesce(
    (select sum(case when payment_type = 'refund' then -amount else amount end)
     from investor_payments where investor_id = i.id),
    i.amount_invested
  )::numeric(15,2)                                                  as amount_invested,
  p.name                                                            as project_name,
  p.status                                                          as project_status,
  p.total_value,
  p.our_stake_percent,
  round(p.total_value * p.our_stake_percent / 100, 2)              as our_pool_value,
  coalesce(
    (select sum(pr.amount * i.share_percent / 100)
     from profit_records pr where pr.project_id = i.project_id), 0
  )                                                                 as total_profit_allocated,
  coalesce(
    (select sum(pe.amount * i.share_percent / 100)
     from project_expenses pe where pe.project_id = i.project_id), 0
  )                                                                 as total_expenses_allocated,
  coalesce(
    (select sum(pr.amount * i.share_percent / 100)
     from profit_records pr where pr.project_id = i.project_id), 0
  ) -
  coalesce(
    (select sum(pe.amount * i.share_percent / 100)
     from project_expenses pe where pe.project_id = i.project_id), 0
  )                                                                 as net_return,
  coalesce(
    (select sum(case when payment_type = 'refund' then -amount else amount end)
     from investor_payments where investor_id = i.id),
    i.amount_invested
  ) +
  coalesce(
    (select sum(pr.amount * i.share_percent / 100)
     from profit_records pr where pr.project_id = i.project_id), 0
  ) -
  coalesce(
    (select sum(pe.amount * i.share_percent / 100)
     from project_expenses pe where pe.project_id = i.project_id), 0
  )                                                                 as current_value
from investors i
join projects p on p.id = i.project_id;

create or replace view investor_running_balance as
select
  i.id            as investor_id,
  i.project_id,
  i.name          as investor_name,
  p.name          as project_name,
  coalesce(
    (select sum(case when payment_type = 'refund' then -amount else amount end)
     from investor_payments where investor_id = i.id),
    i.amount_invested
  )::numeric(15,2) as amount_invested,
  i.share_percent,
  coalesce(
    (select sum(pr.amount * i.share_percent / 100)
     from profit_records pr where pr.project_id = i.project_id), 0
  ) as profit_allocated,
  coalesce(
    (select sum(pe.amount * i.share_percent / 100)
     from project_expenses pe where pe.project_id = i.project_id), 0
  ) as total_expenses_allocated,
  coalesce(
    (select sum(lc.amount)
     from loan_contributions lc
     join cash_adjustments ca on ca.id = lc.loan_id
     where lc.investor_id = i.id and ca.type = 'loan_given' and ca.is_settled = false), 0
  ) as money_loaned_out,
  coalesce(
    (select sum(rd.amount_returned)
     from repayment_distributions rd
     join loan_repayments lr on lr.id = rd.repayment_id
     join loan_contributions lc on lc.id = rd.loan_contribution_id
     join cash_adjustments ca on ca.id = lc.loan_id
     where lc.investor_id = i.id and lr.repayment_type = 'cash'), 0
  ) as money_repaid_received,
  coalesce(
    (select sum(rd.amount_returned)
     from repayment_distributions rd
     join loan_repayments lr on lr.id = rd.repayment_id
     join loan_contributions lc on lc.id = rd.loan_contribution_id
     join cash_adjustments ca on ca.id = lc.loan_id
     where lc.investor_id = i.id and lr.repayment_type = 'project_adjustment'), 0
  ) as money_moved_to_projects
from investors i
join projects p on p.id = i.project_id;

-- ============================================================
-- 8. investor_payment_history view: ready-to-render ledger
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
  ip.created_at
from investor_payments ip
join investors i           on i.id = ip.investor_id
join projects p            on p.id = ip.project_id
left join project_expenses pe on pe.id = ip.expense_id;
