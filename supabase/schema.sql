-- ============================================================
-- InvestTrack - Supabase Schema
-- Primary currency: INR (₹)
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- PROJECTS
-- ============================================================
create table projects (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  name          text not null,
  description   text,
  total_value   numeric(15, 2) not null default 0,   -- Total project value in INR
  status        text not null default 'upcoming'      -- 'upcoming' | 'active' | 'completed'
                  check (status in ('upcoming', 'active', 'completed')),
  start_date    date,
  end_date      date,
  expected_return_percent numeric(6, 2),              -- Expected annual return %
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ============================================================
-- INVESTORS (per project)
-- ============================================================
create table investors (
  id             uuid primary key default uuid_generate_v4(),
  project_id     uuid references projects(id) on delete cascade not null,
  name           text not null,
  phone          text,
  share_percent  numeric(6, 2) not null               -- e.g. 25.00 = 25%
                   check (share_percent > 0 and share_percent <= 100),
  amount_invested numeric(15, 2) not null default 0,  -- Actual INR invested
  joined_at      date default current_date,
  notes          text,
  created_at     timestamptz default now()
);

-- ============================================================
-- PROFIT RECORDS (per project)
-- ============================================================
create table profit_records (
  id           uuid primary key default uuid_generate_v4(),
  project_id   uuid references projects(id) on delete cascade not null,
  amount       numeric(15, 2) not null,               -- Total profit for this record (INR)
  record_date  date not null default current_date,
  notes        text,
  created_at   timestamptz default now()
);

-- ============================================================
-- CASH ADJUSTMENTS (money moved, loaned, reallocated)
-- ============================================================
create table cash_adjustments (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  type            text not null                       -- 'loan_given' | 'loan_received' | 'reallocation' | 'withdrawal' | 'deposit'
                    check (type in ('loan_given', 'loan_received', 'reallocation', 'withdrawal', 'deposit')),
  amount          numeric(15, 2) not null,            -- INR amount (always positive)
  description     text not null,
  from_project_id uuid references projects(id),       -- Source project (if applicable)
  to_project_id   uuid references projects(id),       -- Destination project (if applicable)
  counterparty    text,                               -- Person name (for loans)
  adjustment_date date not null default current_date,
  is_settled      boolean default false,              -- For loans: repaid or not
  settled_date    date,
  created_at      timestamptz default now()
);

-- ============================================================
-- VIEWS
-- ============================================================

-- Per-investor profit allocation view
create or replace view investor_profit_summary as
select
  i.id            as investor_id,
  i.project_id,
  i.name          as investor_name,
  i.share_percent,
  i.amount_invested,
  p.name          as project_name,
  p.status        as project_status,
  p.total_value,
  coalesce(sum(pr.amount * i.share_percent / 100), 0) as total_profit_allocated,
  i.amount_invested + coalesce(sum(pr.amount * i.share_percent / 100), 0) as current_value
from investors i
join projects p on p.id = i.project_id
left join profit_records pr on pr.project_id = i.project_id
group by i.id, i.project_id, i.name, i.share_percent, i.amount_invested, p.name, p.status, p.total_value;

-- Project summary with total raised and profit
create or replace view project_summary as
select
  p.id,
  p.user_id,
  p.name,
  p.description,
  p.total_value,
  p.status,
  p.start_date,
  p.end_date,
  p.expected_return_percent,
  coalesce(sum(distinct_investors.amount_invested), 0) as total_raised,
  coalesce(sum(pr.amount), 0)                          as total_profit,
  count(distinct distinct_investors.id)                as investor_count
from projects p
left join investors distinct_investors on distinct_investors.project_id = p.id
left join profit_records pr on pr.project_id = p.id
group by p.id;

-- Running cash balance view
create or replace view cash_balance as
select
  user_id,
  sum(case
    when type in ('loan_received', 'deposit') then amount
    when type in ('loan_given', 'withdrawal') then -amount
    when type = 'reallocation' then 0  -- neutral (moves between projects)
    else 0
  end) as net_cash_balance,
  sum(case when type = 'loan_given' and not is_settled then amount else 0 end) as outstanding_loans_given,
  sum(case when type = 'loan_received' and not is_settled then amount else 0 end) as outstanding_loans_received
from cash_adjustments
group by user_id;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table projects enable row level security;
alter table investors enable row level security;
alter table profit_records enable row level security;
alter table cash_adjustments enable row level security;

-- Projects: owner only
create policy "projects_owner" on projects
  for all using (auth.uid() = user_id);

-- Investors: via project ownership
create policy "investors_owner" on investors
  for all using (
    exists (select 1 from projects where id = investors.project_id and user_id = auth.uid())
  );

-- Profit records: via project ownership
create policy "profit_records_owner" on profit_records
  for all using (
    exists (select 1 from projects where id = profit_records.project_id and user_id = auth.uid())
  );

-- Cash adjustments: owner only
create policy "cash_adjustments_owner" on cash_adjustments
  for all using (auth.uid() = user_id);

-- ============================================================
-- TRIGGERS: updated_at
-- ============================================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger projects_updated_at
  before update on projects
  for each row execute function update_updated_at();
