-- ============================================================
-- InvestTrack — Fix grants (comprehensive version)
-- Run in Supabase SQL Editor
-- ============================================================

-- Step 1: Check current privileges (run this first to see state)
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'projects'
order by grantee, privilege_type;

-- Step 2: Grant schema access
grant usage  on schema public to anon, authenticated, service_role;
grant create on schema public to postgres, service_role;

-- Step 3: Grant table privileges (explicit schema-qualified names)
grant all privileges on "public"."projects"                to authenticated, service_role;
grant all privileges on "public"."investors"               to authenticated, service_role;
grant all privileges on "public"."profit_records"          to authenticated, service_role;
grant all privileges on "public"."project_expenses"        to authenticated, service_role;
grant all privileges on "public"."cash_adjustments"        to authenticated, service_role;
grant all privileges on "public"."loan_contributions"      to authenticated, service_role;
grant all privileges on "public"."loan_repayments"         to authenticated, service_role;
grant all privileges on "public"."repayment_distributions" to authenticated, service_role;
grant all privileges on "public"."project_members"         to authenticated, service_role;

-- Grant read to anon
grant select on "public"."projects"                to anon;
grant select on "public"."investors"               to anon;
grant select on "public"."profit_records"          to anon;

-- Step 4: Grant on views
grant select on "public"."investor_profit_summary"  to authenticated, anon;
grant select on "public"."project_summary"          to authenticated, anon;
grant select on "public"."my_projects"              to authenticated;
grant select on "public"."loan_summary"             to authenticated;
grant select on "public"."investor_running_balance" to authenticated;
grant select on "public"."my_pending_invites"       to authenticated;

-- Step 5: Grant on functions
grant execute on all functions in schema public to authenticated, anon, service_role;

-- Step 6: Set default privileges for future tables
alter default privileges in schema public
  grant all privileges on tables to authenticated, service_role;
alter default privileges in schema public
  grant all privileges on sequences to authenticated, service_role;
alter default privileges in schema public
  grant all privileges on functions to authenticated, service_role;

-- Step 7: Verify projects table grants
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'projects'
order by grantee, privilege_type;
