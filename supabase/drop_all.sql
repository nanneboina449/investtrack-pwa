-- ============================================================
-- InvestTrack — Drop everything (run BEFORE full_schema.sql)
-- ============================================================

-- Drop ALL policies on ALL tables (catches old + new names)
do $$ declare
  r record;
begin
  for r in (select policyname, tablename from pg_policies where schemaname = 'public') loop
    execute format('drop policy if exists %I on %I', r.policyname, r.tablename);
  end loop;
end $$;

-- Drop views
drop view if exists my_pending_invites          cascade;
drop view if exists investor_running_balance    cascade;
drop view if exists loan_summary                cascade;
drop view if exists my_projects                 cascade;
drop view if exists project_summary             cascade;
drop view if exists investor_profit_summary     cascade;
drop view if exists cash_balance                cascade;

-- Drop functions
drop function if exists accept_pending_invites()                            cascade;
drop function if exists process_loan_repayment(uuid,numeric,text,uuid,date,text) cascade;
drop function if exists update_updated_at()                                 cascade;
drop function if exists has_project_access(uuid)                            cascade;
drop function if exists has_project_edit(uuid)                              cascade;
drop function if exists is_project_owner(uuid)                              cascade;

-- Drop tables (children before parents)
drop table if exists repayment_distributions    cascade;
drop table if exists loan_repayments            cascade;
drop table if exists loan_contributions         cascade;
drop table if exists project_members            cascade;
drop table if exists project_expenses           cascade;
drop table if exists profit_records             cascade;
drop table if exists investors                  cascade;
drop table if exists cash_adjustments           cascade;
drop table if exists projects                   cascade;
