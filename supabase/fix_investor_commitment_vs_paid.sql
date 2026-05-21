-- ============================================================
-- InvestTrack - Fix: investor.amount_invested is COMMITMENT, not PAID
-- Run this AFTER schema_investor_payments.sql
--
-- The earlier migration auto-created a share_contribution payment row
-- whenever an investor was added, treating their committed share as
-- already paid. That is wrong. The correct model is:
--
--   amount_committed  = what they OWE the project (commitment / stake)
--                      = investors.amount_invested  (this column)
--   expense_share     = sum of expenses * share_percent / 100
--                      = total_expenses_allocated   (already in views)
--   amount_paid       = sum of investor_payments
--   outstanding       = amount_committed + expense_share - amount_paid
--
-- This migration:
--   1) drops the auto-payment triggers
--   2) resets investors.amount_invested back to the original commitment
--      value (preserved on the auto-created share_contribution rows)
--   3) deletes the auto-created share_contribution rows so they no longer
--      appear in the payment ledger
--
-- It is idempotent and preserves any user-entered share_contribution
-- payments (they have different note text).
-- ============================================================

-- 1. Drop the triggers that conflated commitment with payment
drop trigger if exists investors_to_payment       on investors;
drop trigger if exists payments_to_investor_amount on investor_payments;
drop function if exists sync_investor_to_payment() cascade;
drop function if exists sync_amount_invested()     cascade;

-- 2. Reset investors.amount_invested to the original commitment.
-- The auto-created share_contribution row's amount IS the commitment
-- value the user entered at investor creation. Take it from there.
update investors i
set amount_invested = sub.original_commitment
from (
  select distinct on (investor_id)
    investor_id,
    amount as original_commitment
  from investor_payments
  where payment_type = 'share_contribution'
    and notes in ('Initial share contribution', 'Backfilled from initial amount_invested')
  order by investor_id, created_at
) sub
where sub.investor_id = i.id;

-- 3. Delete the auto-created share_contribution rows.
-- Any user-entered share_contribution payments (with different note text)
-- are preserved as legitimate payments.
delete from investor_payments
where payment_type = 'share_contribution'
  and notes in ('Initial share contribution', 'Backfilled from initial amount_invested');
