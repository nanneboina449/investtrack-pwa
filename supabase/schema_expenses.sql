-- ============================================================
-- InvestTrack — Project Expenses
-- Expenses split among investors by share %
-- ============================================================

create table project_expenses (
  id           uuid primary key default uuid_generate_v4(),
  project_id   uuid references projects(id) on delete cascade not null,
  amount       numeric(15, 2) not null check (amount > 0),
  category     text not null default 'other'
                 check (category in ('registration','travel','legal','maintenance','tax','construction','other')),
  description  text not null,
  expense_date date not null default current_date,
  notes        text,
  created_at   timestamptz default now()
);

alter table project_expenses enable row level security;

create policy "expenses_select" on project_expenses
  for select using (
    exists (
      select 1 from projects p
      where p.id = project_expenses.project_id
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

create policy "expenses_insert" on project_expenses
  for insert with check (
    exists (
      select 1 from projects p
      where p.id = project_expenses.project_id
        and (
          p.user_id = auth.uid()
          or exists (
            select 1 from project_members pm
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
              and pm.role in ('owner','editor')
              and pm.status = 'accepted'
          )
        )
    )
  );

create policy "expenses_delete" on project_expenses
  for delete using (
    exists (
      select 1 from projects p
      where p.id = project_expenses.project_id
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

-- ============================================================
-- Update investor_profit_summary to include expense deductions
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

  -- Total profit allocated to this investor
  coalesce(
    (select sum(pr.amount * i.share_percent / 100)
     from profit_records pr where pr.project_id = i.project_id), 0
  )                                                                 as total_profit_allocated,

  -- Total expenses charged to this investor
  coalesce(
    (select sum(pe.amount * i.share_percent / 100)
     from project_expenses pe where pe.project_id = i.project_id), 0
  )                                                                 as total_expenses_allocated,

  -- Net = profit - expenses
  coalesce(
    (select sum(pr.amount * i.share_percent / 100)
     from profit_records pr where pr.project_id = i.project_id), 0
  ) -
  coalesce(
    (select sum(pe.amount * i.share_percent / 100)
     from project_expenses pe where pe.project_id = i.project_id), 0
  )                                                                 as net_return,

  -- Current value = invested + net return
  i.amount_invested +
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

-- ============================================================
-- Update project_summary to include total expenses
-- ============================================================
create or replace view project_summary as
select
  p.id,
  p.user_id,
  p.name,
  p.description,
  p.total_value,
  p.our_stake_percent,
  round(p.total_value * p.our_stake_percent / 100, 2)  as our_pool_value,
  p.status,
  p.start_date,
  p.end_date,
  coalesce(sum(distinct_investors.amount_invested), 0)  as total_raised,
  coalesce(sum(pr.amount), 0)                           as total_profit,
  coalesce(
    (select sum(pe.amount) from project_expenses pe where pe.project_id = p.id), 0
  )                                                     as total_expenses,
  coalesce(sum(pr.amount), 0) -
  coalesce(
    (select sum(pe.amount) from project_expenses pe where pe.project_id = p.id), 0
  )                                                     as net_profit,
  count(distinct distinct_investors.id)                 as investor_count
from projects p
left join investors distinct_investors on distinct_investors.project_id = p.id
left join profit_records pr on pr.project_id = p.id
group by p.id;

-- Update my_projects view too
create or replace view my_projects as
select
  p.*,
  round(p.total_value * p.our_stake_percent / 100, 2)  as our_pool_value,
  coalesce(sum(i2.amount_invested), 0)                  as total_raised,
  coalesce(sum(pr.amount), 0)                           as total_profit,
  coalesce(
    (select sum(pe.amount) from project_expenses pe where pe.project_id = p.id), 0
  )                                                     as total_expenses,
  coalesce(sum(pr.amount), 0) -
  coalesce(
    (select sum(pe.amount) from project_expenses pe where pe.project_id = p.id), 0
  )                                                     as net_profit,
  count(distinct i2.id)                                 as investor_count,
  case when p.user_id = auth.uid() then 'owner' else pm.role end as my_role,
  case when p.user_id = auth.uid() then true   else false        end as is_owner
from projects p
left join investors i2      on i2.project_id = p.id
left join profit_records pr on pr.project_id = p.id
left join project_members pm
  on pm.project_id = p.id
  and pm.user_id = auth.uid()
  and pm.status = 'accepted'
where p.user_id = auth.uid() or pm.id is not null
group by p.id, pm.role;
