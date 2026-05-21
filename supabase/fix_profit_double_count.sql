-- ============================================================
-- InvestTrack - Fix project-card profit / raised double-counting
--
-- The my_projects view LEFT JOIN'd both investors and profit_records,
-- then aggregated with sum(). With N investors and M profit records,
-- the join produces N×M rows per project, so:
--   sum(pr.amount)       -> N times the real total profit
--   sum(i.amount_invested) -> M times the real total raised
-- Example: 3 investors, one profit record of 24L -> displayed 72L.
--
-- Fix: replace the join + aggregate pattern with per-column scalar
-- subqueries (the same approach total_expenses already used). No more
-- fanout. Column names, order, and types are preserved so create-or-
-- replace is accepted on a live DB.
-- ============================================================

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
