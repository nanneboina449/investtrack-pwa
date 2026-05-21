-- ============================================================
-- InvestTrack — Inter-investor loan (A's funds used for B)
--
-- When investor A's project capital is redirected to fund investor B
-- (whether B is in the same project or a different one), three things
-- happen atomically:
--
--   1. A loan_given cash_adjustment is created. Counterparty = B's
--      name. Optional interest rate. This is the obligation B owes A.
--   2. A loan_contributions row records A as the sole contributor of
--      the loan principal. So when the loan is later repaid via
--      process_loan_repayment, A is the one credited.
--   3. A refund payment lands on A's payment ledger (A's project
--      balance drops) and a top_up lands on B's (B's project balance
--      rises). Both are linked bidirectionally through the existing
--      source/destination_* columns so the trail is traceable from
--      both ends.
--
-- When B "repays" later, just call process_loan_repayment normally —
-- it'll distribute back to A through the existing repayment plumbing.
-- ============================================================

create or replace function transfer_funds_as_loan(
  p_source_investor_id uuid,
  p_dest_investor_id   uuid,
  p_amount             numeric,
  p_interest_pct       numeric default 0,
  p_date               date default current_date,
  p_notes              text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_project_id uuid;
  v_dest_project_id   uuid;
  v_source_name       text;
  v_dest_name         text;
  v_user_id           uuid;
  v_loan_id           uuid;
begin
  v_user_id := auth.uid();

  if p_source_investor_id = p_dest_investor_id then
    raise exception 'Source and destination investors must be different';
  end if;
  if p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;
  if p_interest_pct < 0 or p_interest_pct > 100 then
    raise exception 'Interest rate must be between 0 and 100';
  end if;

  select project_id, name into v_source_project_id, v_source_name
  from investors where id = p_source_investor_id;
  if v_source_project_id is null then
    raise exception 'Source investor not found';
  end if;

  select project_id, name into v_dest_project_id, v_dest_name
  from investors where id = p_dest_investor_id;
  if v_dest_project_id is null then
    raise exception 'Destination investor not found';
  end if;

  -- 1. Loan record (B owes A)
  insert into cash_adjustments
    (user_id, type, amount, description, counterparty, adjustment_date,
     interest_rate_percent, from_project_id)
  values
    (v_user_id, 'loan_given', p_amount,
     'Inter-investor loan: ' || v_source_name || ' → ' || v_dest_name,
     v_dest_name,
     p_date,
     coalesce(p_interest_pct, 0),
     v_source_project_id)
  returning id into v_loan_id;

  -- 2. A is the sole contributor (full principal)
  insert into loan_contributions
    (loan_id, investor_id, investor_name, project_id, amount)
  values
    (v_loan_id, p_source_investor_id, v_source_name, v_source_project_id, p_amount);

  -- 3a. Refund on A's payment ledger — A's balance in the source project drops
  insert into investor_payments
    (investor_id, project_id, amount, payment_type, payment_date, notes,
     destination_project_id, destination_investor_id)
  values
    (p_source_investor_id, v_source_project_id, p_amount, 'refund',
     p_date,
     coalesce(p_notes, 'Lent to ' || v_dest_name),
     v_dest_project_id, p_dest_investor_id);

  -- 3b. Top-up on B's payment ledger — B's balance in their project rises
  insert into investor_payments
    (investor_id, project_id, amount, payment_type, payment_date, notes,
     source_project_id, source_investor_id)
  values
    (p_dest_investor_id, v_dest_project_id, p_amount, 'top_up',
     p_date,
     coalesce(p_notes, 'Borrowed from ' || v_source_name),
     v_source_project_id, p_source_investor_id);

  return v_loan_id;
end;
$$;

grant execute on function transfer_funds_as_loan(uuid, uuid, numeric, numeric, date, text)
  to authenticated, service_role;
