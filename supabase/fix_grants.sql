-- ============================================================
-- InvestTrack — Fix table privileges
-- The authenticated role needs explicit SQL grants
-- Run in Supabase SQL Editor
-- ============================================================

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on
  projects,
  investors,
  profit_records,
  project_expenses,
  cash_adjustments,
  loan_contributions,
  loan_repayments,
  repayment_distributions,
  project_members
to authenticated;

grant select on
  projects,
  investors,
  profit_records,
  project_expenses,
  cash_adjustments,
  loan_contributions,
  loan_repayments,
  repayment_distributions,
  project_members
to anon;

-- Grant access to views
grant select on
  investor_profit_summary,
  project_summary,
  my_projects,
  loan_summary,
  investor_running_balance,
  my_pending_invites
to authenticated;

-- Grant execute on functions
grant execute on function
  has_project_access(uuid),
  has_project_edit(uuid),
  is_project_owner(uuid),
  accept_pending_invites(),
  process_loan_repayment(uuid, numeric, text, uuid, date, text),
  debug_auth()
to authenticated, anon;

select 'Grants applied ✓' as status;
