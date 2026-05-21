-- ============================================================
-- InvestTrack - Collapse internal whitespace in investor names
--
-- Follow-up to fix_name_matching_case_insensitive.sql. That migration
-- trimmed leading/trailing whitespace but left internal double-spaces
-- alone, so records like "Venkatesh  Nanneboina" and
-- "Venkatesh Nanneboina" still appeared as duplicates on the dashboard.
--
-- Fix: collapse any run of whitespace to a single space. Also update
-- the linking RPCs to do the same collapse during matching so case +
-- spacing variations link correctly even before the data hygiene run.
-- ============================================================

-- 1. Data hygiene: collapse all internal whitespace runs to single
-- spaces on every existing investor name. Idempotent.
update investors
set name = regexp_replace(trim(name), '\s+', ' ', 'g')
where name <> regexp_replace(trim(name), '\s+', ' ', 'g');

-- 2. process_loan_repayment — match with collapse-whitespace as well
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

      if p_type = 'project_adjustment' and p_to_project_id is not null then
        select id into v_dest_investor_id
        from investors
        where project_id = p_to_project_id
          and lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
              = lower(regexp_replace(trim(v_contribution.investor_name), '\s+', ' ', 'g'))
        limit 1;

        if v_dest_investor_id is not null then
          insert into investor_payments
            (investor_id, project_id, amount, payment_type, payment_date, notes,
             source_project_id, source_investor_id)
          values
            (v_dest_investor_id, p_to_project_id, v_dist_amount, 'top_up',
             p_date,
             'From loan repayment on source project',
             v_contribution.project_id, v_contribution.investor_id);
        end if;
      end if;
    end loop;
  end if;

  update cash_adjustments ca
  set is_settled = true, settled_date = p_date
  where ca.id = p_loan_id
    and (select coalesce(sum(amount),0) from loan_repayments where loan_id = p_loan_id)
        >= ca.amount * (1 + ca.interest_rate_percent / 100);

  return v_repayment_id;
end;
$$;

-- 3. reallocate_investor_position — same collapse-whitespace match
create or replace function reallocate_investor_position(
  p_source_investor_id   uuid,
  p_dest_project_id      uuid,
  p_amount               numeric,
  p_date                 date default current_date,
  p_notes                text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_project_id uuid;
  v_source_name       text;
  v_dest_investor_id  uuid;
  v_refund_id         uuid;
  v_topup_id          uuid;
begin
  select project_id, name into v_source_project_id, v_source_name
  from investors where id = p_source_investor_id;

  if v_source_project_id is null then
    raise exception 'Source investor not found';
  end if;

  if v_source_project_id = p_dest_project_id then
    raise exception 'Source and destination projects must be different';
  end if;

  if p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  select id into v_dest_investor_id
  from investors
  where project_id = p_dest_project_id
    and lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
        = lower(regexp_replace(trim(v_source_name), '\s+', ' ', 'g'))
  limit 1;

  if v_dest_investor_id is null then
    raise exception 'No investor named "%" on the destination project (matched case + spacing insensitively). Add them there first.', v_source_name;
  end if;

  insert into investor_payments
    (investor_id, project_id, amount, payment_type, payment_date, notes,
     destination_project_id, destination_investor_id)
  values
    (p_source_investor_id, v_source_project_id, p_amount, 'refund',
     p_date, coalesce(p_notes, 'Reallocated to destination project'),
     p_dest_project_id, v_dest_investor_id)
  returning id into v_refund_id;

  insert into investor_payments
    (investor_id, project_id, amount, payment_type, payment_date, notes,
     source_project_id, source_investor_id)
  values
    (v_dest_investor_id, p_dest_project_id, p_amount, 'top_up',
     p_date, coalesce(p_notes, 'Reallocated from source project'),
     v_source_project_id, p_source_investor_id)
  returning id into v_topup_id;

  return v_topup_id;
end;
$$;
