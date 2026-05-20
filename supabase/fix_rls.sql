-- ============================================================
-- InvestTrack — RLS Quick Fix
-- Run this in Supabase SQL Editor if you get RLS errors
-- ============================================================

-- Step 1: Drop ALL existing policies on projects table
drop policy if exists "projects_owner"   on projects;
drop policy if exists "projects_select"  on projects;
drop policy if exists "projects_insert"  on projects;
drop policy if exists "projects_update"  on projects;
drop policy if exists "projects_delete"  on projects;

-- Step 2: Drop and recreate helper functions cleanly
drop function if exists has_project_access(uuid);
drop function if exists has_project_edit(uuid);
drop function if exists is_project_owner(uuid);

create or replace function has_project_access(pid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from projects p
    where p.id = pid and (
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
    select 1 from projects p
    where p.id = pid and (
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

-- Step 3: Recreate clean policies
create policy "projects_select" on projects
  for select using (has_project_access(id));

create policy "projects_insert" on projects
  for insert with check (auth.uid() = user_id);

create policy "projects_update" on projects
  for update using (has_project_edit(id));

create policy "projects_delete" on projects
  for delete using (is_project_owner(id));

-- Step 4: Verify — should show 4 rows for projects table
select tablename, policyname, cmd
from pg_policies
where tablename = 'projects'
order by cmd;
