-- ============================================================
-- InvestTrack — Master Audit Phase B + Calculations Patch
--
-- Resolves the four follow-up items I agreed with from the late
-- May 2026 audit pass:
--
--   • Switch investor_payments.cash_adjustment_id FK from
--     ON DELETE CASCADE to ON DELETE RESTRICT (financial records
--     can't be wiped by a stray DELETE on cash_adjustments).
--   • Add a safe-cleanup RPC delete_cash_adjustment(id) so the
--     Delete-loan UX still works one-click — the RPC handles the
--     explicit teardown order inside a transaction.
--   • Extend process_loan_repayment with a p_dest_investor_map
--     JSON parameter so multi-leg project_adjustment repayments
--     resolve via immutable UUIDs (name match remains as fallback).
--   • Add CHECK (amount > 0) on loan_repayments so a typo can't
--     poison the ledger with a zero / negative repayment row.
--
-- The audit's "block updates to share_contribution rows" trigger is
-- intentionally NOT applied — it would break the legitimate Edit
-- Payment UX. Documented in DESIGN.md as a design choice.
-- ============================================================

-- ============================================================
-- 1. RESTRICT on cash_adjustment_id FK
-- Existing constraint was created in audit_fixes.sql with CASCADE.
-- Drop and recreate with RESTRICT.
-- ============================================================
alter table investor_payments
  drop constraint if exists investor_payments_cash_adjustment_id_fkey;

alter table investor_payments
  add constraint investor_payments_cash_adjustment_id_fkey
  foreign key (cash_adjustment_id)
  references cash_adjustments(id)
  on delete restrict;

comment on constraint investor_payments_cash_adjustment_id_fkey on investor_payments
  is 'Protects historical financial ledgers from being cleared by a cascade. Delete via delete_cash_adjustment RPC.';

-- ============================================================
-- 2. Safe-cleanup RPC for deleting a cash_adjustment + its links
-- ============================================================
create or replace function delete_cash_adjustment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Explicit cleanup since the FK is now RESTRICT.
  -- Order: payments (which point at cash_adjustment_id) -> contributions
  -- and repayments cascade via their own FKs -> finally the cash_adjustment itself.
  delete from investor_payments where cash_adjustment_id = p_id;
  delete from cash_adjustments where id = p_id;
end;
$$;

grant execute on function delete_cash_adjustment(uuid) to authenticated, service_role;

-- ============================================================
-- 3. process_loan_repayment with UUID destination map
-- p_dest_investor_map is a JSON array of {contributor_id, dest_investor_id}
-- pairs. When supplied, the routine looks up each contributor's destination
-- via the map instead of name matching. When null, falls back to the
-- case + whitespace insensitive name match.
-- ============================================================
drop function if exists process_loan_repayment(uuid, numeric, text, uuid, date, text);

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
        v_dest_investor_id := null;

        -- Prefer the explicit UUID map.
        if p_dest_investor_map is not null then
          select (item->>'dest_investor_id')::uuid into v_dest_investor_id
          from json_array_elements(p_dest_investor_map) item
          where (item->>'contributor_id')::uuid = v_contribution.investor_id
          limit 1;
        end if;

        -- Fall back to case + whitespace insensitive name match.
        if v_dest_investor_id is null then
          select id into v_dest_investor_id
          from investors
          where project_id = p_to_project_id
            and lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
                = lower(regexp_replace(trim(v_contribution.investor_name), '\s+', ' ', 'g'))
          limit 1;
        end if;

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

-- ============================================================
-- 4. Positive amount CHECK on loan_repayments
-- ============================================================
alter table loan_repayments
  drop constraint if exists check_repayment_positive_value;

alter table loan_repayments
  add constraint check_repayment_positive_value check (amount > 0);
