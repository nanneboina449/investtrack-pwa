-- ============================================================
-- InvestTrack — Audit Fixes (May 2026)
--
-- Closes the three issues flagged in the System Integrity Report:
--
--   BUG 1 — Custom Split Profit Mismatch:
--           my_investments view ignored profit_distributions and
--           recomputed share% × profit_amount on the fly. Fixed by
--           re-engineering the view per the audit's CTE design.
--
--   BUG 2 — Inter-Investor Loan Orphans on Deletion:
--           deleteCashAdjustment used best-effort matching by
--           (amount, date, contributor) which is unsafe with
--           duplicates. Fixed by adding cash_adjustment_id on
--           investor_payments + backfilling historical rows.
--
--   BUG 3 — Borrower Balance Inflation Hole:
--           Borrower's running_balance was inflated by the borrowed
--           top_up because their outstanding payable wasn't
--           subtracted. The new cash_adjustment_id link lets us
--           compute loans_received_outstanding correctly. The
--           frontend takes the rest of the fix.
--
-- Plus an OPTIONAL Data Governance trigger that freezes
-- investor_payments on completed projects (enable by uncommenting
-- the bottom CREATE TRIGGER block).
-- ============================================================

-- ============================================================
-- 1. Add cash_adjustment_id link column + index
-- ============================================================
alter table investor_payments
  add column if not exists cash_adjustment_id uuid
    references cash_adjustments(id) on delete cascade;

create index if not exists investor_payments_cash_adj_idx
  on investor_payments(cash_adjustment_id);

-- ============================================================
-- 2. Backfill the link for existing inter-investor loan payments
-- (refund on lender + top_up on borrower) so historical deletes
-- benefit from the strict cascade.
-- Matches by (contributor + amount + date) — same risk as the old
-- JS layer but only runs once, not every delete.
-- ============================================================
update investor_payments ip
set cash_adjustment_id = ca.id
from cash_adjustments ca
join loan_contributions lc on lc.loan_id = ca.id
where ca.type = 'loan_given'
  and ip.cash_adjustment_id is null
  and ip.payment_type = 'refund'
  and ip.investor_id = lc.investor_id
  and ip.amount = lc.amount
  and ip.payment_date = ca.adjustment_date
  and ip.destination_investor_id is not null;

update investor_payments ip
set cash_adjustment_id = ca.id
from cash_adjustments ca
join loan_contributions lc on lc.loan_id = ca.id
where ca.type = 'loan_given'
  and ip.cash_adjustment_id is null
  and ip.payment_type = 'top_up'
  and ip.source_investor_id = lc.investor_id
  and ip.amount = lc.amount
  and ip.payment_date = ca.adjustment_date;

-- ============================================================
-- 3. Update transfer_funds_as_loan RPC to populate the link going
-- forward
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
  if v_source_project_id is null then raise exception 'Source investor not found'; end if;

  select project_id, name into v_dest_project_id, v_dest_name
  from investors where id = p_dest_investor_id;
  if v_dest_project_id is null then raise exception 'Destination investor not found'; end if;

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

  insert into loan_contributions
    (loan_id, investor_id, investor_name, project_id, amount)
  values
    (v_loan_id, p_source_investor_id, v_source_name, v_source_project_id, p_amount);

  -- Refund on lender — now anchored to the loan via cash_adjustment_id
  insert into investor_payments
    (investor_id, project_id, amount, payment_type, payment_date, notes,
     destination_project_id, destination_investor_id, cash_adjustment_id)
  values
    (p_source_investor_id, v_source_project_id, p_amount, 'refund',
     p_date,
     coalesce(p_notes, 'Lent to ' || v_dest_name),
     v_dest_project_id, p_dest_investor_id, v_loan_id);

  -- Top-up on borrower — also anchored
  insert into investor_payments
    (investor_id, project_id, amount, payment_type, payment_date, notes,
     source_project_id, source_investor_id, cash_adjustment_id)
  values
    (p_dest_investor_id, v_dest_project_id, p_amount, 'top_up',
     p_date,
     coalesce(p_notes, 'Borrowed from ' || v_source_name),
     v_source_project_id, p_source_investor_id, v_loan_id);

  return v_loan_id;
end;
$$;

-- ============================================================
-- 4. Refactor my_investments view (Audit BUG 1 fix)
-- Reads from profit_distributions for custom-split accuracy and
-- uses a CTE to avoid duplicate per-row recomputation.
--
-- Schema reality: investors has `email` (added via the email-linking
-- migration referenced in commit 9bb79fc) but no user_id column.
-- Match by auth.email().
--
-- Drop + recreate to avoid the "cannot drop columns from view" lock.
-- ============================================================
drop view if exists my_investments cascade;

create view my_investments as
with investor_financial_aggregates as (
  select
    i.id as investor_id,
    coalesce(sum(pd.amount), 0) as total_profit_allocated,
    coalesce((
      select sum(pe.amount * i.share_percent / 100::numeric)
      from project_expenses pe
      where pe.project_id = i.project_id
    ), 0) as total_expenses_allocated,
    coalesce((
      select sum(case
        when payment_type in ('share_contribution', 'top_up', 'expense_paid') then amount
        when payment_type = 'refund' then -amount
        else 0
      end)
      from investor_payments ip
      where ip.investor_id = i.id
    ), 0) as net_cash_paid
  from investors i
  left join profit_distributions pd on pd.investor_id = i.id
  group by i.id
)
select
  i.id          as investor_id,
  i.project_id,
  i.name        as investor_name,
  i.email       as investor_email,
  i.share_percent,
  i.amount_invested,
  p.name        as project_name,
  p.status      as project_status,
  p.total_value,
  p.our_stake_percent,
  round(p.total_value * p.our_stake_percent / 100::numeric, 2)              as our_pool_value,
  f.total_profit_allocated,
  f.total_expenses_allocated,
  (f.total_profit_allocated - f.total_expenses_allocated)                   as net_return,
  (f.net_cash_paid + f.total_profit_allocated - f.total_expenses_allocated) as current_value
from investors i
join projects p on p.id = i.project_id
join investor_financial_aggregates f on f.investor_id = i.id
where i.email is not null
  and lower(trim(i.email)) = lower(trim(coalesce(auth.email(), '')));

grant select on my_investments to authenticated, service_role;

-- ============================================================
-- 5. (OPTIONAL) Data Governance: lock the books on completed projects
-- Uncomment the trigger to enable. Reversible — drop the trigger to
-- unlock. We don't enable by default because the app currently has
-- no "Re-open project" UI.
-- ============================================================
create or replace function check_project_book_lock()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status
  from projects
  where id = coalesce(NEW.project_id, OLD.project_id);

  if v_status = 'completed' then
    raise exception 'Database Write Blocked: Project is completed — books are immutable. Re-open the project to make changes.';
  end if;
  return coalesce(NEW, OLD);
end;
$$;

-- Drop any earlier installation; do NOT recreate by default.
drop trigger if exists tr_lock_completed_project_payments on investor_payments;
-- create trigger tr_lock_completed_project_payments
--   before insert or update or delete on investor_payments
--   for each row execute function check_project_book_lock();
