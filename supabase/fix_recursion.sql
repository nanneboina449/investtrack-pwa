-- ============================================================
-- Fix: restore security definer to prevent infinite RLS recursion
-- security definer bypasses RLS inside the function (stops the loop)
-- auth.uid() still works because it reads from connection GUC settings
-- Run in Supabase SQL Editor
-- ============================================================

drop function if exists has_project_access(uuid) cascade;
drop function if exists has_project_edit(uuid)   cascade;
drop function if exists is_project_owner(uuid)   cascade;

-- Restore security definer — required to avoid RLS recursion
-- (function queries projects table, which has RLS using this function)
create or replace function has_project_access(pid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from projects p where p.id = pid and (
      p.user_id = auth.uid()
      or exists (
        select 1 from project_members pm
        where pm.project_id = pid
          and pm.user_id = auth.uid()
          and pm.status = 'accepted'
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
        where pm.project_id = pid
          and pm.user_id = auth.uid()
          and pm.role in ('owner','editor')
          and pm.status = 'accepted'
      )
    )
  );
$$;

create or replace function is_project_owner(pid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from projects where id = pid and user_id = auth.uid()
  );
$$;

-- Recreate all dependent policies
drop policy if exists "projects_select"  on projects;
drop policy if exists "projects_insert"  on projects;
drop policy if exists "projects_update"  on projects;
drop policy if exists "projects_delete"  on projects;
drop policy if exists "investors_select" on investors;
drop policy if exists "investors_insert" on investors;
drop policy if exists "investors_delete" on investors;
drop policy if exists "profit_select"    on profit_records;
drop policy if exists "profit_insert"    on profit_records;
drop policy if exists "profit_delete"    on profit_records;
drop policy if exists "expenses_select"  on project_expenses;
drop policy if exists "expenses_insert"  on project_expenses;
drop policy if exists "expenses_delete"  on project_expenses;
drop policy if exists "members_select"   on project_members;
drop policy if exists "members_insert"   on project_members;
drop policy if exists "members_update"   on project_members;
drop policy if exists "members_delete"   on project_members;

create policy "projects_select" on projects  for select using (has_project_access(id));
create policy "projects_insert" on projects  for insert with check (true);
create policy "projects_update" on projects  for update using (has_project_edit(id));
create policy "projects_delete" on projects  for delete using (is_project_owner(id));

create policy "investors_select" on investors for select using (has_project_access(project_id));
create policy "investors_insert" on investors for insert with check (has_project_edit(project_id));
create policy "investors_delete" on investors for delete using (is_project_owner(project_id));

create policy "profit_select" on profit_records for select using (has_project_access(project_id));
create policy "profit_insert" on profit_records for insert with check (has_project_edit(project_id));
create policy "profit_delete" on profit_records for delete using (is_project_owner(project_id));

create policy "expenses_select" on project_expenses for select using (has_project_access(project_id));
create policy "expenses_insert" on project_expenses for insert with check (has_project_edit(project_id));
create policy "expenses_delete" on project_expenses for delete using (is_project_owner(project_id));

create policy "members_select" on project_members for select using (
  has_project_access(project_id) or invited_email = auth.email()
);
create policy "members_insert" on project_members for insert with check (is_project_owner(project_id));
create policy "members_update" on project_members for update using (
  invited_email = auth.email() or is_project_owner(project_id)
);
create policy "members_delete" on project_members for delete using (is_project_owner(project_id));

grant execute on function has_project_access(uuid) to authenticated, anon;
grant execute on function has_project_edit(uuid)   to authenticated, anon;
grant execute on function is_project_owner(uuid)   to authenticated, anon;

select 'Recursion fixed ✓' as status;
