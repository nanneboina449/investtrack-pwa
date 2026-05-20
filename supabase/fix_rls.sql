-- ============================================================
-- InvestTrack — RLS Fix
-- Run in Supabase SQL Editor
-- ============================================================

-- Step 1: Drop every policy explicitly by name
drop policy if exists "projects_owner"    on projects;
drop policy if exists "projects_select"   on projects;
drop policy if exists "projects_insert"   on projects;
drop policy if exists "projects_update"   on projects;
drop policy if exists "projects_delete"   on projects;

drop policy if exists "investors_owner"   on investors;
drop policy if exists "investors_select"  on investors;
drop policy if exists "investors_insert"  on investors;
drop policy if exists "investors_delete"  on investors;

drop policy if exists "profit_records_owner"  on profit_records;
drop policy if exists "profit_select"         on profit_records;
drop policy if exists "profit_insert"         on profit_records;
drop policy if exists "profit_delete"         on profit_records;

drop policy if exists "expenses_select"  on project_expenses;
drop policy if exists "expenses_insert"  on project_expenses;
drop policy if exists "expenses_delete"  on project_expenses;

drop policy if exists "cash_adjustments_owner" on cash_adjustments;
drop policy if exists "cash_select"            on cash_adjustments;
drop policy if exists "cash_insert"            on cash_adjustments;
drop policy if exists "cash_update"            on cash_adjustments;

drop policy if exists "loan_contributions_owner" on loan_contributions;
drop policy if exists "lc_select"                on loan_contributions;
drop policy if exists "lc_insert"                on loan_contributions;

drop policy if exists "loan_repayments_owner" on loan_repayments;
drop policy if exists "lr_select"             on loan_repayments;
drop policy if exists "lr_insert"             on loan_repayments;

drop policy if exists "repayment_distributions_owner" on repayment_distributions;
drop policy if exists "rd_select"                     on repayment_distributions;
drop policy if exists "rd_insert"                     on repayment_distributions;

drop policy if exists "members_select" on project_members;
drop policy if exists "members_insert" on project_members;
drop policy if exists "members_update" on project_members;
drop policy if exists "members_delete" on project_members;

-- Step 2: Now drop functions (no dependents left)
drop function if exists has_project_access(uuid);
drop function if exists has_project_edit(uuid);
drop function if exists is_project_owner(uuid);

-- Step 3: Recreate functions
create or replace function has_project_access(pid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from projects p where p.id = pid and (
      p.user_id = auth.uid()
      or exists (
        select 1 from project_members pm
        where pm.project_id = pid and pm.user_id = auth.uid() and pm.status = 'accepted'
      )
    )
  );
$$;

create or replace function has_project_edit(pid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from projects p where p.id = pid and (
      p.user_id = auth.uid()
      or exists (
        select 1 from project_members pm
        where pm.project_id = pid and pm.user_id = auth.uid()
          and pm.role in ('owner','editor') and pm.status = 'accepted'
      )
    )
  );
$$;

create or replace function is_project_owner(pid uuid)
returns boolean language sql security definer stable as $$
  select exists (select 1 from projects where id = pid and user_id = auth.uid());
$$;

-- Step 4: Recreate all policies

create policy "projects_select" on projects for select using (has_project_access(id));
create policy "projects_insert" on projects for insert with check (auth.uid() = user_id);
create policy "projects_update" on projects for update using (has_project_edit(id));
create policy "projects_delete" on projects for delete using (is_project_owner(id));

create policy "investors_select" on investors for select using (has_project_access(project_id));
create policy "investors_insert" on investors for insert with check (has_project_edit(project_id));
create policy "investors_delete" on investors for delete using (is_project_owner(project_id));

create policy "profit_select" on profit_records for select using (has_project_access(project_id));
create policy "profit_insert" on profit_records for insert with check (has_project_edit(project_id));
create policy "profit_delete" on profit_records for delete using (is_project_owner(project_id));

create policy "expenses_select" on project_expenses for select using (has_project_access(project_id));
create policy "expenses_insert" on project_expenses for insert with check (has_project_edit(project_id));
create policy "expenses_delete" on project_expenses for delete using (is_project_owner(project_id));

create policy "cash_select" on cash_adjustments for select using (auth.uid() = user_id);
create policy "cash_insert" on cash_adjustments for insert with check (auth.uid() = user_id);
create policy "cash_update" on cash_adjustments for update using (auth.uid() = user_id);

create policy "lc_select" on loan_contributions for select using (
  exists (select 1 from cash_adjustments ca where ca.id = loan_contributions.loan_id and ca.user_id = auth.uid())
);
create policy "lc_insert" on loan_contributions for insert with check (
  exists (select 1 from cash_adjustments ca where ca.id = loan_contributions.loan_id and ca.user_id = auth.uid())
);

create policy "lr_select" on loan_repayments for select using (
  exists (select 1 from cash_adjustments ca where ca.id = loan_repayments.loan_id and ca.user_id = auth.uid())
);
create policy "lr_insert" on loan_repayments for insert with check (
  exists (select 1 from cash_adjustments ca where ca.id = loan_repayments.loan_id and ca.user_id = auth.uid())
);

create policy "rd_select" on repayment_distributions for select using (
  exists (
    select 1 from loan_repayments lr
    join cash_adjustments ca on ca.id = lr.loan_id
    where lr.id = repayment_distributions.repayment_id and ca.user_id = auth.uid()
  )
);
create policy "rd_insert" on repayment_distributions for insert with check (
  exists (
    select 1 from loan_repayments lr
    join cash_adjustments ca on ca.id = lr.loan_id
    where lr.id = repayment_distributions.repayment_id and ca.user_id = auth.uid()
  )
);

create policy "members_select" on project_members for select using (
  has_project_access(project_id)
  or invited_email = (select email from auth.users where id = auth.uid())
);
create policy "members_insert" on project_members for insert with check (is_project_owner(project_id));
create policy "members_update" on project_members for update using (
  invited_email = (select email from auth.users where id = auth.uid())
  or is_project_owner(project_id)
);
create policy "members_delete" on project_members for delete using (is_project_owner(project_id));

-- Step 5: Verify
select tablename, policyname, cmd
from pg_policies where schemaname = 'public'
order by tablename, cmd;
