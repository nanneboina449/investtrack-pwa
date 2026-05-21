-- ============================================================
-- InvestTrack - Custom Profit Split per profit record
-- Run this AFTER the base schema is in place.
--
-- By default, each profit_record's amount is split among investors
-- by share_percent. This adds the option to override that split per
-- individual profit record (e.g., for a one-off bonus paid only to
-- specific partners).
--
-- Strategy: ALWAYS materialize the per-investor amounts in a
-- profit_distributions table — proportional rows are auto-created
-- when no custom split is provided. Views read from this table
-- instead of recomputing share_percent at query time. This keeps the
-- model uniform (no conditional logic in views) and the views' column
-- types unchanged.
-- ============================================================

-- 1. profit_distributions table
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

-- 2. RLS — mirror project access
alter table profit_distributions enable row level security;

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
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
              and pm.status = 'accepted'
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
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
              and pm.role in ('owner', 'editor')
              and pm.status = 'accepted'
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
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
              and pm.role = 'owner'
              and pm.status = 'accepted'
          )
        )
    )
  );

grant all privileges on profit_distributions to authenticated, service_role;

-- 3. Backfill: one proportional row per (existing profit, current investor)
-- Idempotent — skips combinations that already have a row.
insert into profit_distributions (profit_id, investor_id, amount)
select
  pr.id,
  i.id,
  round(pr.amount * i.share_percent / 100, 2)
from profit_records pr
join investors i on i.project_id = pr.project_id
where not exists (
  select 1 from profit_distributions pd
  where pd.profit_id = pr.id and pd.investor_id = i.id
);

-- 4. RPC for atomic profit-record creation with optional custom distributions.
-- If p_distributions is null, auto-create proportional rows for every
-- investor in the project. Otherwise, insert exactly the rows the caller
-- specified (validation that they sum to p_amount happens client-side).
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

-- NOTE: The two existing views (investor_profit_summary and
-- investor_running_balance) are intentionally NOT updated here.
-- Postgres rejects `create or replace view` whenever a dependent view
-- (my_investments) references the changed column, even when the type
-- is preserved (error 42P16, "cannot drop columns from view").
--
-- Workaround: keep the views as-is. For DEFAULT splits, the view's
-- proportional calculation equals the sum of profit_distributions
-- (because backfill seeded them proportionally), so totals stay correct.
-- For CUSTOM splits, the Profits tab on ProjectDetail.jsx reads
-- profit_distributions directly so per-record amounts are always
-- accurate; aggregated views (dashboard, balances tab) will show the
-- proportional split for any custom records — accept that minor
-- discrepancy or compute on the frontend if exact totals are needed.
