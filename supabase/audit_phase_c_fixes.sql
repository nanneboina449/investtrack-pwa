-- ============================================================
-- InvestTrack — Master Audit Phase C — Final Compliance Corrections
--
-- Addresses the four items in the Phase C remediation directive:
--
--   1. (doc-only — see CALCULATIONS.md)
--   2. block_over_repayment trigger — hard abort when a new
--      loan_repayment would push the total past total_due_with_interest
--   3. Hard abort in process_loan_repayment / reallocate_investor_position
--      when UUID context is missing instead of falling back to name match
--   4. Switch investor_payments.investor_id FK from CASCADE → RESTRICT
--      and add investors.is_deleted soft-delete flag
--
-- Idempotent.
-- ============================================================

-- ============================================================
-- 1. Soft-delete + RESTRICT cascade on investors → investor_payments
-- ============================================================
alter table investors
  add column if not exists is_deleted boolean default false;

create index if not exists investors_is_deleted_idx on investors(is_deleted);

alter table investor_payments
  drop constraint if exists investor_payments_investor_id_fkey;

alter table investor_payments
  add constraint investor_payments_investor_id_fkey
  foreign key (investor_id)
  references investors(id)
  on delete restrict;

comment on column investors.is_deleted is
  'Soft-delete flag. Hard delete via FK was switched to RESTRICT in Phase C to preserve ledger history. UI hides is_deleted=true rows from pickers.';

-- The same protection for the other ledger tables that reference investors
alter table loan_contributions
  drop constraint if exists loan_contributions_investor_id_fkey;

alter table loan_contributions
  add constraint loan_contributions_investor_id_fkey
  foreign key (investor_id)
  references investors(id)
  on delete restrict;

alter table profit_distributions
  drop constraint if exists profit_distributions_investor_id_fkey;

alter table profit_distributions
  add constraint profit_distributions_investor_id_fkey
  foreign key (investor_id)
  references investors(id)
  on delete restrict;

-- ============================================================
-- 2. block_over_repayment trigger — abort on overruns
-- The DB-level CHECK (amount > 0) stays (zero/negative guard).
-- This trigger adds the missing rule: cumulative repayments
-- must not exceed total_due (principal + flat interest).
-- ============================================================
create or replace function block_over_repayment()
returns trigger
language plpgsql
as $$
declare
  v_total_due    numeric;
  v_already_paid numeric;
  v_new_total    numeric;
begin
  select round(amount * (1 + interest_rate_percent / 100::numeric), 2)
    into v_total_due
  from cash_adjustments
  where id = NEW.loan_id;

  select coalesce(sum(amount), 0) into v_already_paid
  from loan_repayments
  where loan_id = NEW.loan_id;

  v_new_total := v_already_paid + NEW.amount;

  if v_new_total > v_total_due + 0.01 then
    raise exception
      'Repayment of ₹% would exceed outstanding (total due ₹%, already repaid ₹%, this would total ₹%). Edit the loan amount/interest first, or route the overpayment elsewhere.',
      NEW.amount, v_total_due, v_already_paid, v_new_total;
  end if;

  return NEW;
end;
$$;

drop trigger if exists tr_block_over_repayment on loan_repayments;
create trigger tr_block_over_repayment
  before insert on loan_repayments
  for each row execute function block_over_repayment();

-- ============================================================
-- 3a. reallocate_investor_position — abort when destination
-- investor UUID is missing (no name-match fallback).
-- ============================================================
drop function if exists reallocate_investor_position(uuid, uuid, numeric, date, text, uuid);

create or replace function reallocate_investor_position(
  p_source_investor_id   uuid,
  p_dest_project_id      uuid,
  p_amount               numeric,
  p_date                 date default current_date,
  p_notes                text default null,
  p_dest_investor_id     uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_project_id uuid;
  v_source_name       text;
  v_refund_id         uuid;
  v_topup_id          uuid;
begin
  -- Phase C: hard abort when caller didn't supply the destination UUID.
  if p_dest_investor_id is null then
    raise exception
      'Compliance Violation: p_dest_investor_id is required. Name-string fallback has been removed.';
  end if;

  select project_id, name into v_source_project_id, v_source_name
  from investors where id = p_source_investor_id;
  if v_source_project_id is null then raise exception 'Source investor not found'; end if;
  if v_source_project_id = p_dest_project_id then
    raise exception 'Source and destination projects must be different';
  end if;
  if p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  if not exists (
    select 1 from investors
    where id = p_dest_investor_id and project_id = p_dest_project_id
  ) then
    raise exception 'Destination investor not found on destination project';
  end if;

  insert into investor_payments
    (investor_id, project_id, amount, payment_type, payment_date, notes,
     destination_project_id, destination_investor_id)
  values
    (p_source_investor_id, v_source_project_id, p_amount, 'refund',
     p_date, coalesce(p_notes, 'Reallocated to destination project'),
     p_dest_project_id, p_dest_investor_id)
  returning id into v_refund_id;

  insert into investor_payments
    (investor_id, project_id, amount, payment_type, payment_date, notes,
     source_project_id, source_investor_id)
  values
    (p_dest_investor_id, p_dest_project_id, p_amount, 'top_up',
     p_date, coalesce(p_notes, 'Reallocated from source project'),
     v_source_project_id, p_source_investor_id)
  returning id into v_topup_id;

  return v_topup_id;
end;
$$;

grant execute on function reallocate_investor_position(uuid, uuid, numeric, date, text, uuid)
  to authenticated, service_role;

-- ============================================================
-- 3b. process_loan_repayment — abort on project_adjustment
-- repayments when no UUID destination map is provided. Cash
-- repayments don't need a map (no destination involved).
-- ============================================================
drop function if exists process_loan_repayment(uuid, numeric, text, uuid, date, text, json);

create or replace function process_loan_repayment(
  p_loan_id            uuid,
  p_amount             numeric,
  p_type               text,
  p_to_project_id      uuid default null,
  p_date               date default current_date,
  p_notes              text default null,
  p_dest_investor_map  json default null
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
  -- Phase C: when routing to another project, the caller MUST supply
  -- the contributor→destination_investor mapping. No string fallback.
  if p_type = 'project_adjustment' and p_dest_investor_map is null then
    raise exception
      'Compliance Violation: p_dest_investor_map is required for project_adjustment repayments. Name-string fallback has been removed.';
  end if;

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
        -- Resolve via UUID map. Contributors not in the map are SKIPPED
        -- (no name-match fallback). Caller is responsible for completeness.
        select (item->>'dest_investor_id')::uuid into v_dest_investor_id
        from json_array_elements(p_dest_investor_map) item
        where (item->>'contributor_id')::uuid = v_contribution.investor_id
        limit 1;

        if v_dest_investor_id is not null then
          insert into investor_payments
            (investor_id, project_id, amount, payment_type, payment_date, notes,
             source_project_id, source_investor_id, cash_adjustment_id)
          values
            (v_dest_investor_id, p_to_project_id, v_dist_amount, 'top_up',
             p_date,
             'From loan repayment on source project',
             v_contribution.project_id, v_contribution.investor_id, p_loan_id);
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

grant execute on function process_loan_repayment(uuid, numeric, text, uuid, date, text, json)
  to authenticated, service_role;
