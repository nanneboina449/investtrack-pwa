-- ============================================================
-- InvestTrack - Loan Interest (flat % on principal)
-- Run this AFTER the original schema is in place.
--
-- Adds a flat interest rate to every loan. Total expected back =
-- principal * (1 + rate/100). Existing loans default to 0% so the
-- numbers are backward-compatible.
--
-- The existing per-contributor distribution math already works
-- correctly for principal + interest:
--   each repayment R distributes to contributor C as
--     R * (C.contribution / total_principal)
-- Across all repayments (totaling P + interest), contributor C gets
-- back C.contribution * (1 + rate/100) — their share of principal plus
-- their share of interest.
--
-- This migration also updates the auto-settle threshold and the
-- loan_summary view to surface interest fields.
-- ============================================================

-- 1. Add the interest rate column
alter table cash_adjustments
  add column if not exists interest_rate_percent numeric(6,2) not null default 0
    check (interest_rate_percent >= 0 and interest_rate_percent <= 100);

-- 2. Update loan_summary view to expose interest and total-due fields.
-- All existing columns kept in the same order with the same types;
-- new columns appended at the end (PG accepts this for create-or-replace).
create or replace view loan_summary as
select
  ca.id, ca.user_id, ca.type,
  ca.amount                                                          as total_loan_amount,
  ca.description, ca.counterparty,
  ca.adjustment_date                                                 as loan_date,
  ca.is_settled, ca.settled_date,
  coalesce(sum(lr.amount), 0)                                        as total_repaid,
  -- outstanding_balance now reflects principal + interest minus repaid
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
  -- new columns
  ca.interest_rate_percent,
  round(ca.amount * ca.interest_rate_percent / 100, 2)               as interest_amount,
  round(ca.amount * (1 + ca.interest_rate_percent / 100), 2)         as total_due_with_interest
from cash_adjustments ca
left join loan_contributions lc on lc.loan_id = ca.id
left join loan_repayments lr    on lr.loan_id  = ca.id
where ca.type in ('loan_given','loan_received')
group by ca.id;

-- 3. Update process_loan_repayment to use P + interest as the
-- threshold for auto-settle. Distribution math is unchanged.
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
    end loop;
  end if;

  -- Auto-settle when total repaid covers principal + interest
  update cash_adjustments ca
  set is_settled = true, settled_date = p_date
  where ca.id = p_loan_id
    and (select coalesce(sum(amount),0) from loan_repayments where loan_id = p_loan_id)
        >= ca.amount * (1 + ca.interest_rate_percent / 100);

  return v_repayment_id;
end;
$$ language plpgsql;
