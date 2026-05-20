-- ============================================================
-- InvestTrack — Add our_stake_percent to projects
-- Replaces expected_return_percent
-- Run in Supabase SQL Editor
-- ============================================================

-- Add stake column (default 100% = full ownership)
alter table projects
  add column if not exists our_stake_percent numeric(6,2) not null default 100
    check (our_stake_percent > 0 and our_stake_percent <= 100);

-- Migrate: set existing rows to 100% (full ownership)
update projects set our_stake_percent = 100;

-- Update project_summary view to expose our_pool_value
create or replace view project_summary as
select
  p.id,
  p.user_id,
  p.name,
  p.description,
  p.total_value,
  p.our_stake_percent,
  round(p.total_value * p.our_stake_percent / 100, 2) as our_pool_value,
  p.status,
  p.start_date,
  p.end_date,
  coalesce(sum(distinct_investors.amount_invested), 0) as total_raised,
  coalesce(sum(pr.amount), 0)                          as total_profit,
  count(distinct distinct_investors.id)                as investor_count
from projects p
left join investors distinct_investors on distinct_investors.project_id = p.id
left join profit_records pr on pr.project_id = p.id
group by p.id;

-- Update my_projects view the same way
create or replace view my_projects as
select
  p.*,
  round(p.total_value * p.our_stake_percent / 100, 2) as our_pool_value,
  coalesce(sum(distinct_investors.amount_invested), 0) as total_raised,
  coalesce(sum(pr.amount), 0)                          as total_profit,
  count(distinct distinct_investors.id)                as investor_count,
  case
    when p.user_id = auth.uid() then 'owner'
    else pm.role
  end as my_role,
  case
    when p.user_id = auth.uid() then true
    else false
  end as is_owner
from projects p
left join investors distinct_investors on distinct_investors.project_id = p.id
left join profit_records pr on pr.project_id = p.id
left join project_members pm
  on pm.project_id = p.id
  and pm.user_id = auth.uid()
  and pm.status = 'accepted'
where
  p.user_id = auth.uid()
  or (pm.id is not null)
group by p.id, pm.role;
