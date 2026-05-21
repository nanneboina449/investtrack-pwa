-- ============================================================
-- InvestTrack - Loan project_adjustment credits destination
--
-- When a loan repayment is recorded as `project_adjustment` with a
-- to_project_id, the system tracked the intent (repayment_distributions)
-- but no actual cash flowed into the destination project. The
-- contributors' running totals across projects were therefore wrong:
-- the source loan correctly showed "money came back", but the
-- destination project had no record of receiving it.
--
-- Fix: extend process_loan_repayment so that when type =
-- 'project_adjustment', it also creates investor_payments (type
-- 'top_up') on the destination project for each contributor — matched
-- by investor name. That way the cross-project investor running total
-- reflects reality without touching the source project's frozen books.
--
-- Idempotent. Safe to re-run.
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

      -- NEW: when the repayment is being applied to another project,
      -- credit the contributor on that destination project so their
      -- running total reflects it. Match by investor name (the only
      -- cross-project identity link we have today).
      if p_type = 'project_adjustment' and p_to_project_id is not null then
        select id into v_dest_investor_id
        from investors
        where project_id = p_to_project_id
          and name = v_contribution.investor_name
        limit 1;

        if v_dest_investor_id is not null then
          insert into investor_payments
            (investor_id, project_id, amount, payment_type, payment_date, notes)
          values
            (v_dest_investor_id, p_to_project_id, v_dist_amount, 'top_up',
             p_date,
             'Auto: routed from loan repayment (' || coalesce(p_notes, 'no note') || ')');
        end if;
        -- If the contributor is not an investor on the destination
        -- project, we silently skip. The repayment_distribution row
        -- still records what was intended; the owner can manually add
        -- them as an investor and create a top_up later if needed.
      end if;
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
$$;
