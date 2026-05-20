-- ============================================================
-- InvestTrack — Complete Database Schema
-- Run this ONCE in Supabase SQL Editor (fresh project)
-- Includes: core tables, loans, sharing, stake %, expenses
-- ============================================================

-- Extensions
create extension if not exists "uuid-ossp";

-- ============================================================
-- TABLES
-- ============================================================

create table projects (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid references auth.users(id) on delete cascade not null,
  name                text not null,
  description         text,
  total_value         numeric(15,2) not null default 0,
  our_stake_percent   numeric(6,2)  not null default 100
                        check (our_stake_percent > 0 and our_stake_percent <= 100),
  status              text not null default 'upcoming'
                        check (status in ('upcoming','active','completed')),
  start_date          date,
  end_date            date,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create table investors (
  id              uuid primary key default uuid_generate_v4(),
  project_id      uuid references projects(id) on delete cascade not null,
  name            text not null,
  phone           text,
  share_percent   numeric(6,2) not null
                    check (share_percent > 0 and share_percent <= 100),
  amount_invested numeric(15,2) not null default 0,
  joined_at       date default current_date,
  notes           text,
  created_at      timestamptz default now()
);

create table profit_records (
  id           uuid primary key default uuid_generate_v4(),
  project_id   uuid references projects(id) on delete cascade not null,
  amount       numeric(15,2) not null,
  record_date  date not null default current_date,
  notes        text,
  created_at   timestamptz default now()
);

create table project_expenses (
  id           uuid primary key default uuid_generate_v4(),
  project_id   uuid references projects(id) on delete cascade not null,
  amount       numeric(15,2) not null check (amount > 0),
  category     text not null default 'other'
                 check (category in ('registration','travel','legal','maintenance','tax','construction','other')),
  description  text not null,
  expense_date date not null default current_date,
  notes        text,
  created_at   timestamptz default now()
);

create table cash_adjustments (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  type            text not null
                    check (type in ('loan_given','loan_received','reallocation','withdrawal','deposit')),
  amount          numeric(15,2) not null,
  description     text not null,
  from_project_id uuid references projects(id),
  to_project_id   uuid references projects(id),
  counterparty    text,
  adjustment_date date not null default current_date,
  is_settled      boolean default false,
  settled_date    date,
  created_at      timestamptz default now()
);

create table loan_contributions (
  id            uuid primary key default uuid_generate_v4(),
  loan_id       uuid references cash_adjustments(id) on delete cascade not null,
  project_id    uuid references projects(id),
  investor_id   uuid references investors(id),
  investor_name text not null,
  amount        numeric(15,2) not null,
  created_at    timestamptz default now()
);

create table loan_repayments (
  id             uuid primary key default uuid_generate_v4(),
  loan_id        uuid references cash_adjustments(id) on delete cascade not null,
  amount         numeric(15,2) not null,
  repayment_type text not null default 'cash'
                   check (repayment_type in ('cash','project_adjustment')),
  to_project_id  uuid references projects(id),
  repayment_date date not null default current_date,
  notes          text,
  created_at     timestamptz default now()
);

create table repayment_distributions (
  id                   uuid primary key default uuid_generate_v4(),
  repayment_id         uuid references loan_repayments(id) on delete cascade not null,
  loan_contribution_id uuid references loan_contributions(id) on delete cascade not null,
  investor_name        text not null,
  project_id           uuid references projects(id),
  amount_returned      numeric(15,2) not null,
  created_at           timestamptz default now()
);

create table project_members (
  id            uuid primary key default uuid_generate_v4(),
  project_id    uuid references projects(id) on delete cascade not null,
  user_id       uuid references auth.users(id) on delete cascade,
  role          text not null default 'viewer'
                  check (role in ('owner','editor','viewer')),
  invited_by    uuid references auth.users(id) not null,
  invited_email text not null,
  status        text not null default 'pending'
                  check (status in ('pending','accepted','declined')),
  created_at    timestamptz default now(),
  accepted_at   timestamptz,
  unique (project_id, invited_email)
);

-- ============================================================
-- VIEWS
-- ============================================================

create or replace view investor_profit_summary as
select
  i.id                                                              as investor_id,
  i.project_id,
  i.name                                                            as investor_name,
  i.share_percent,
  i.amount_invested,
  p.name                                                            as project_name,
  p.status                                                          as project_status,
  p.total_value,
  p.our_stake_percent,
  round(p.total_value * p.our_stake_percent / 100, 2)              as our_pool_value,
  coalesce(
    (select sum(pr.amount * i.share_percent / 100)
     from profit_records pr where pr.project_id = i.project_id), 0)  as total_profit_allocated,
  coalesce(
    (select sum(pe.amount * i.share_percent / 100)
     from project_expenses pe where pe.project_id = i.project_id), 0) as total_expenses_allocated,
  coalesce(
    (select sum(pr.amount * i.share_percent / 100)
     from profit_records pr where pr.project_id = i.project_id), 0) -
  coalesce(
    (select sum(pe.amount * i.share_percent / 100)
     from project_expenses pe where pe.project_id = i.project_id), 0) as net_return,
  i.amount_invested +
  coalesce(
    (select sum(pr.amount * i.share_percent / 100)
     from profit_records pr where pr.project_id = i.project_id), 0) -
  coalesce(
    (select sum(pe.amount * i.share_percent / 100)
     from project_expenses pe where pe.project_id = i.project_id), 0) as current_value
from investors i
join projects p on p.id = i.project_id;

create or replace view project_summary as
select
  p.id, p.user_id, p.name, p.description, p.total_value,
  p.our_stake_percent,
  round(p.total_value * p.our_stake_percent / 100, 2)  as our_pool_value,
  p.status, p.start_date, p.end_date,
  coalesce(sum(i.amount_invested), 0)                  as total_raised,
  coalesce(sum(pr.amount), 0)                          as total_profit,
  coalesce((select sum(pe.amount) from project_expenses pe where pe.project_id = p.id), 0) as total_expenses,
  coalesce(sum(pr.amount), 0) -
  coalesce((select sum(pe.amount) from project_expenses pe where pe.project_id = p.id), 0) as net_profit,
  count(distinct i.id)                                 as investor_count
from projects p
left join investors i     on i.project_id  = p.id
left join profit_records pr on pr.project_id = p.id
group by p.id;

create or replace view my_projects as
select
  p.*,
  round(p.total_value * p.our_stake_percent / 100, 2)  as our_pool_value,
  coalesce(sum(i.amount_invested), 0)                   as total_raised,
  coalesce(sum(pr.amount), 0)                           as total_profit,
  coalesce((select sum(pe.amount) from project_expenses pe where pe.project_id = p.id), 0) as total_expenses,
  coalesce(sum(pr.amount), 0) -
  coalesce((select sum(pe.amount) from project_expenses pe where pe.project_id = p.id), 0) as net_profit,
  count(distinct i.id)                                  as investor_count,
  case when p.user_id = auth.uid() then 'owner' else pm.role end as my_role,
  case when p.user_id = auth.uid() then true   else false        end as is_owner
from projects p
left join investors i       on i.project_id  = p.id
left join profit_records pr on pr.project_id = p.id
left join project_members pm
  on pm.project_id = p.id and pm.user_id = auth.uid() and pm.status = 'accepted'
where p.user_id = auth.uid() or pm.id is not null
group by p.id, pm.role;

create or replace view loan_summary as
select
  ca.id, ca.user_id, ca.type,
  ca.amount                                as total_loan_amount,
  ca.description, ca.counterparty,
  ca.adjustment_date                       as loan_date,
  ca.is_settled, ca.settled_date,
  coalesce(sum(lr.amount), 0)              as total_repaid,
  ca.amount - coalesce(sum(lr.amount), 0)  as outstanding_balance,
  count(distinct lc.id)                    as contributor_count,
  json_agg(distinct jsonb_build_object(
    'investor_name', lc.investor_name,
    'project_id',    lc.project_id,
    'amount',        lc.amount
  )) filter (where lc.id is not null)      as contributions,
  json_agg(distinct jsonb_build_object(
    'repayment_id',  lr.id,
    'amount',        lr.amount,
    'type',          lr.repayment_type,
    'to_project_id', lr.to_project_id,
    'date',          lr.repayment_date
  )) filter (where lr.id is not null)      as repayments
from cash_adjustments ca
left join loan_contributions lc on lc.loan_id = ca.id
left join loan_repayments lr    on lr.loan_id  = ca.id
where ca.type in ('loan_given','loan_received')
group by ca.id;

create or replace view investor_running_balance as
select
  i.id            as investor_id,
  i.project_id,
  i.name          as investor_name,
  p.name          as project_name,
  i.amount_invested,
  i.share_percent,
  coalesce(
    (select sum(pr.amount * i.share_percent / 100)
     from profit_records pr where pr.project_id = i.project_id), 0) as profit_allocated,
  coalesce(
    (select sum(pe.amount * i.share_percent / 100)
     from project_expenses pe where pe.project_id = i.project_id), 0) as total_expenses_allocated,
  coalesce(
    (select sum(lc.amount)
     from loan_contributions lc
     join cash_adjustments ca on ca.id = lc.loan_id
     where lc.investor_id = i.id and ca.type = 'loan_given' and ca.is_settled = false), 0) as money_loaned_out,
  coalesce(
    (select sum(rd.amount_returned)
     from repayment_distributions rd
     join loan_repayments lr on lr.id = rd.repayment_id
     join loan_contributions lc on lc.id = rd.loan_contribution_id
     join cash_adjustments ca on ca.id = lc.loan_id
     where lc.investor_id = i.id and lr.repayment_type = 'cash'), 0) as money_repaid_received,
  coalesce(
    (select sum(rd.amount_returned)
     from repayment_distributions rd
     join loan_repayments lr on lr.id = rd.repayment_id
     join loan_contributions lc on lc.id = rd.loan_contribution_id
     join cash_adjustments ca on ca.id = lc.loan_id
     where lc.investor_id = i.id and lr.repayment_type = 'project_adjustment'), 0) as money_moved_to_projects
from investors i
join projects p on p.id = i.project_id;

create or replace view my_pending_invites as
select
  pm.id, pm.project_id, pm.role, pm.invited_by, pm.created_at,
  p.name        as project_name,
  p.description as project_description,
  p.status      as project_status,
  u.email       as invited_by_email,
  u.raw_user_meta_data->>'full_name' as invited_by_name
from project_members pm
join projects p    on p.id  = pm.project_id
join auth.users u  on u.id  = pm.invited_by
where pm.invited_email = (select email from auth.users where id = auth.uid())
  and pm.status = 'pending';

-- ============================================================
-- FUNCTIONS
-- ============================================================

create or replace function update_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger projects_updated_at
  before update on projects
  for each row execute function update_updated_at();

create or replace function process_loan_repayment(
  p_loan_id       uuid,
  p_amount        numeric,
  p_type          text,
  p_to_project_id uuid default null,
  p_date          date default current_date,
  p_notes         text default null
) returns uuid as $$
declare
  v_repayment_id      uuid;
  v_total_contributed numeric;
  v_contribution      record;
  v_dist_amount       numeric;
begin
  insert into loan_repayments (loan_id, amount, repayment_type, to_project_id, repayment_date, notes)
  values (p_loan_id, p_amount, p_type, p_to_project_id, p_date, p_notes)
  returning id into v_repayment_id;

  select sum(amount) into v_total_contributed
  from loan_contributions where loan_id = p_loan_id;

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
  end loop;

  update cash_adjustments
  set is_settled = true, settled_date = p_date
  where id = p_loan_id
    and (select coalesce(sum(amount),0) from loan_repayments where loan_id = p_loan_id) >= amount;

  return v_repayment_id;
end;
$$ language plpgsql;

create or replace function accept_pending_invites()
returns void as $$
begin
  update project_members
  set user_id = auth.uid(), status = 'accepted', accepted_at = now()
  where invited_email = (select email from auth.users where id = auth.uid())
    and status = 'pending';
end;
$$ language plpgsql security definer;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table projects              enable row level security;
alter table investors             enable row level security;
alter table profit_records        enable row level security;
alter table project_expenses      enable row level security;
alter table cash_adjustments      enable row level security;
alter table loan_contributions    enable row level security;
alter table loan_repayments       enable row level security;
alter table repayment_distributions enable row level security;
alter table project_members       enable row level security;

-- Helper: check if current user has project access
create or replace function has_project_access(pid uuid)
returns boolean language sql security definer as $$
  select exists (
    select 1 from projects p
    where p.id = pid and (
      p.user_id = auth.uid()
      or exists (
        select 1 from project_members pm
        where pm.project_id = pid and pm.user_id = auth.uid() and pm.status = 'accepted'
      )
    )
  );
$$;

create or replace function has_project_edit(pid uuid)
returns boolean language sql security definer as $$
  select exists (
    select 1 from projects p
    where p.id = pid and (
      p.user_id = auth.uid()
      or exists (
        select 1 from project_members pm
        where pm.project_id = pid and pm.user_id = auth.uid()
          and pm.role in ('owner','editor') and pm.status = 'accepted'
      )
    )
  );
$$;

create or replace function is_project_owner(pid uuid)
returns boolean language sql security definer as $$
  select exists (
    select 1 from projects where id = pid and user_id = auth.uid()
  );
$$;

-- Projects
create policy "projects_select" on projects for select using (has_project_access(id));
create policy "projects_insert" on projects for insert with check (auth.uid() = user_id);
create policy "projects_update" on projects for update using (has_project_edit(id));
create policy "projects_delete" on projects for delete using (is_project_owner(id));

-- Investors
create policy "investors_select" on investors for select using (has_project_access(project_id));
create policy "investors_insert" on investors for insert with check (has_project_edit(project_id));
create policy "investors_delete" on investors for delete using (is_project_owner(project_id));

-- Profit records
create policy "profit_select" on profit_records for select using (has_project_access(project_id));
create policy "profit_insert" on profit_records for insert with check (has_project_edit(project_id));
create policy "profit_delete" on profit_records for delete using (is_project_owner(project_id));

-- Expenses
create policy "expenses_select" on project_expenses for select using (has_project_access(project_id));
create policy "expenses_insert" on project_expenses for insert with check (has_project_edit(project_id));
create policy "expenses_delete" on project_expenses for delete using (is_project_owner(project_id));

-- Cash adjustments
create policy "cash_select" on cash_adjustments for select using (auth.uid() = user_id);
create policy "cash_insert" on cash_adjustments for insert with check (auth.uid() = user_id);
create policy "cash_update" on cash_adjustments for update using (auth.uid() = user_id);

-- Loan contributions
create policy "lc_select" on loan_contributions for select using (
  exists (select 1 from cash_adjustments ca where ca.id = loan_contributions.loan_id and ca.user_id = auth.uid())
);
create policy "lc_insert" on loan_contributions for insert with check (
  exists (select 1 from cash_adjustments ca where ca.id = loan_contributions.loan_id and ca.user_id = auth.uid())
);

-- Loan repayments
create policy "lr_select" on loan_repayments for select using (
  exists (select 1 from cash_adjustments ca where ca.id = loan_repayments.loan_id and ca.user_id = auth.uid())
);
create policy "lr_insert" on loan_repayments for insert with check (
  exists (select 1 from cash_adjustments ca where ca.id = loan_repayments.loan_id and ca.user_id = auth.uid())
);

-- Repayment distributions
create policy "rd_select" on repayment_distributions for select using (
  exists (
    select 1 from loan_repayments lr
    join cash_adjustments ca on ca.id = lr.loan_id
    where lr.id = repayment_distributions.repayment_id and ca.user_id = auth.uid()
  )
);
create policy "rd_insert" on repayment_distributions for insert with check (
  exists (
    select 1 from loan_repayments lr
    join cash_adjustments ca on ca.id = lr.loan_id
    where lr.id = repayment_distributions.repayment_id and ca.user_id = auth.uid()
  )
);

-- Project members
create policy "members_select" on project_members for select using (
  has_project_access(project_id)
  or invited_email = (select email from auth.users where id = auth.uid())
);
create policy "members_insert" on project_members for insert with check (is_project_owner(project_id));
create policy "members_update" on project_members for update using (
  invited_email = (select email from auth.users where id = auth.uid())
  or is_project_owner(project_id)
);
create policy "members_delete" on project_members for delete using (is_project_owner(project_id));
