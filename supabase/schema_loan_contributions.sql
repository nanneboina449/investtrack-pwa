-- ============================================================
-- InvestTrack — Schema Addition: Loan Contribution Tracking
-- Adds to existing schema.sql
-- ============================================================

-- ============================================================
-- LOAN CONTRIBUTIONS
-- Who pooled money for each loan given, and from which project
-- ============================================================
create table loan_contributions (
  id              uuid primary key default uuid_generate_v4(),
  loan_id         uuid references cash_adjustments(id) on delete cascade not null,
  project_id      uuid references projects(id),            -- which project the funds came from (null = personal cash)
  investor_id     uuid references investors(id),           -- specific investor (null = owner's own funds)
  investor_name   text not null,                           -- denormalised for display even if investor deleted
  amount          numeric(15, 2) not null,                 -- INR amount this contributor put in
  created_at      timestamptz default now()
);

-- ============================================================
-- LOAN REPAYMENTS
-- Tracks how a loan is paid back: cash or moved into a project
-- ============================================================
create table loan_repayments (
  id              uuid primary key default uuid_generate_v4(),
  loan_id         uuid references cash_adjustments(id) on delete cascade not null,
  amount          numeric(15, 2) not null,                 -- INR amount repaid in this event
  repayment_type  text not null default 'cash'
                    check (repayment_type in ('cash', 'project_adjustment')),
  to_project_id   uuid references projects(id),            -- if type = project_adjustment
  repayment_date  date not null default current_date,
  notes           text,
  created_at      timestamptz default now()
);

-- ============================================================
-- REPAYMENT DISTRIBUTION
-- For each repayment, how much goes back to each contributor
-- (auto-computed proportionally but can be manually overridden)
-- ============================================================
create table repayment_distributions (
  id                  uuid primary key default uuid_generate_v4(),
  repayment_id        uuid references loan_repayments(id) on delete cascade not null,
  loan_contribution_id uuid references loan_contributions(id) on delete cascade not null,
  investor_name       text not null,
  project_id          uuid references projects(id),
  amount_returned     numeric(15, 2) not null,             -- INR going back to this contributor
  created_at          timestamptz default now()
);

-- ============================================================
-- VIEW: Loan summary with contribution and repayment totals
-- ============================================================
create or replace view loan_summary as
select
  ca.id,
  ca.user_id,
  ca.type,
  ca.amount                                         as total_loan_amount,
  ca.description,
  ca.counterparty,
  ca.adjustment_date                                as loan_date,
  ca.is_settled,
  ca.settled_date,
  coalesce(sum(lr.amount), 0)                       as total_repaid,
  ca.amount - coalesce(sum(lr.amount), 0)           as outstanding_balance,
  count(distinct lc.id)                             as contributor_count,
  json_agg(distinct jsonb_build_object(
    'investor_name',  lc.investor_name,
    'project_id',     lc.project_id,
    'amount',         lc.amount
  )) filter (where lc.id is not null)               as contributions,
  json_agg(distinct jsonb_build_object(
    'repayment_id',   lr.id,
    'amount',         lr.amount,
    'type',           lr.repayment_type,
    'to_project_id',  lr.to_project_id,
    'date',           lr.repayment_date
  )) filter (where lr.id is not null)               as repayments
from cash_adjustments ca
left join loan_contributions lc on lc.loan_id = ca.id
left join loan_repayments lr    on lr.loan_id  = ca.id
where ca.type in ('loan_given', 'loan_received')
group by ca.id;

-- ============================================================
-- VIEW: Per-investor running balance
-- Shows how much each investor has deployed vs available
-- ============================================================
create or replace view investor_running_balance as
select
  i.id            as investor_id,
  i.project_id,
  i.name          as investor_name,
  p.name          as project_name,
  i.amount_invested,
  i.share_percent,

  -- Profit allocated to this investor
  coalesce(
    (select sum(pr.amount * i.share_percent / 100)
     from profit_records pr where pr.project_id = i.project_id), 0
  )               as profit_allocated,

  -- Money this investor has loaned out (not yet repaid)
  coalesce(
    (select sum(lc.amount)
     from loan_contributions lc
     join cash_adjustments ca on ca.id = lc.loan_id
     where lc.investor_id = i.id and ca.type = 'loan_given' and ca.is_settled = false), 0
  )               as money_loaned_out,

  -- Money repaid back to this investor (cash)
  coalesce(
    (select sum(rd.amount_returned)
     from repayment_distributions rd
     join loan_repayments lr on lr.id = rd.repayment_id
     join loan_contributions lc on lc.id = rd.loan_contribution_id
     join cash_adjustments ca on ca.id = lc.loan_id
     where lc.investor_id = i.id and lr.repayment_type = 'cash'), 0
  )               as money_repaid_received,

  -- Money adjusted into another project
  coalesce(
    (select sum(rd.amount_returned)
     from repayment_distributions rd
     join loan_repayments lr on lr.id = rd.repayment_id
     join loan_contributions lc on lc.id = rd.loan_contribution_id
     join cash_adjustments ca on ca.id = lc.loan_id
     where lc.investor_id = i.id and lr.repayment_type = 'project_adjustment'), 0
  )               as money_moved_to_projects

from investors i
join projects p on p.id = i.project_id;

-- ============================================================
-- FUNCTION: Create repayment and auto-distribute proportionally
-- ============================================================
create or replace function process_loan_repayment(
  p_loan_id       uuid,
  p_amount        numeric,
  p_type          text,
  p_to_project_id uuid default null,
  p_date          date default current_date,
  p_notes         text default null
) returns uuid as $$
declare
  v_repayment_id    uuid;
  v_total_contributed numeric;
  v_contribution    record;
  v_dist_amount     numeric;
begin
  -- Insert repayment
  insert into loan_repayments (loan_id, amount, repayment_type, to_project_id, repayment_date, notes)
  values (p_loan_id, p_amount, p_type, p_to_project_id, p_date, p_notes)
  returning id into v_repayment_id;

  -- Get total contributed for proportional distribution
  select sum(amount) into v_total_contributed
  from loan_contributions where loan_id = p_loan_id;

  -- Distribute proportionally to each contributor
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

  -- Mark loan settled if fully repaid
  update cash_adjustments
  set is_settled = true, settled_date = p_date
  where id = p_loan_id
    and (select coalesce(sum(amount),0) from loan_repayments where loan_id = p_loan_id) >= amount;

  return v_repayment_id;
end;
$$ language plpgsql;

-- ============================================================
-- RLS for new tables
-- ============================================================
alter table loan_contributions enable row level security;
alter table loan_repayments enable row level security;
alter table repayment_distributions enable row level security;

create policy "loan_contributions_owner" on loan_contributions
  for all using (
    exists (select 1 from cash_adjustments ca where ca.id = loan_contributions.loan_id and ca.user_id = auth.uid())
  );

create policy "loan_repayments_owner" on loan_repayments
  for all using (
    exists (select 1 from cash_adjustments ca where ca.id = loan_repayments.loan_id and ca.user_id = auth.uid())
  );

create policy "repayment_distributions_owner" on repayment_distributions
  for all using (
    exists (
      select 1 from loan_repayments lr
      join cash_adjustments ca on ca.id = lr.loan_id
      where lr.id = repayment_distributions.repayment_id and ca.user_id = auth.uid()
    )
  );
