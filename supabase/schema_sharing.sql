-- ============================================================
-- InvestTrack — Schema: Project Sharing & Roles
-- Run this AFTER schema.sql and schema_loan_contributions.sql
-- ============================================================

-- ============================================================
-- PROJECT MEMBERS
-- Tracks who has access to a project and at what role
-- ============================================================
create table project_members (
  id            uuid primary key default uuid_generate_v4(),
  project_id    uuid references projects(id) on delete cascade not null,
  user_id       uuid references auth.users(id) on delete cascade,   -- null until invite accepted
  role          text not null default 'viewer'
                  check (role in ('owner', 'editor', 'viewer')),
  invited_by    uuid references auth.users(id) not null,
  invited_email text not null,
  status        text not null default 'pending'
                  check (status in ('pending', 'accepted', 'declined')),
  created_at    timestamptz default now(),
  accepted_at   timestamptz,
  unique (project_id, invited_email)
);

-- ============================================================
-- UPDATE RLS: Projects
-- Owner can see own projects; members can see shared projects
-- ============================================================
drop policy if exists "projects_owner" on projects;

create policy "projects_select" on projects
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from project_members pm
      where pm.project_id = projects.id
        and pm.user_id = auth.uid()
        and pm.status = 'accepted'
    )
  );

create policy "projects_insert" on projects
  for insert with check (auth.uid() = user_id);

create policy "projects_update" on projects
  for update using (
    auth.uid() = user_id
    or exists (
      select 1 from project_members pm
      where pm.project_id = projects.id
        and pm.user_id = auth.uid()
        and pm.role in ('owner', 'editor')
        and pm.status = 'accepted'
    )
  );

create policy "projects_delete" on projects
  for delete using (auth.uid() = user_id);

-- ============================================================
-- UPDATE RLS: Investors
-- ============================================================
drop policy if exists "investors_owner" on investors;

create policy "investors_select" on investors
  for select using (
    exists (
      select 1 from projects p
      where p.id = investors.project_id
        and (
          p.user_id = auth.uid()
          or exists (
            select 1 from project_members pm
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
              and pm.status = 'accepted'
          )
        )
    )
  );

create policy "investors_insert" on investors
  for insert with check (
    exists (
      select 1 from projects p
      where p.id = investors.project_id
        and (
          p.user_id = auth.uid()
          or exists (
            select 1 from project_members pm
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
              and pm.role in ('owner', 'editor')
              and pm.status = 'accepted'
          )
        )
    )
  );

create policy "investors_delete" on investors
  for delete using (
    exists (
      select 1 from projects p
      where p.id = investors.project_id
        and (
          p.user_id = auth.uid()
          or exists (
            select 1 from project_members pm
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
              and pm.role = 'owner'
              and pm.status = 'accepted'
          )
        )
    )
  );

-- ============================================================
-- UPDATE RLS: Profit Records
-- ============================================================
drop policy if exists "profit_records_owner" on profit_records;

create policy "profit_records_select" on profit_records
  for select using (
    exists (
      select 1 from projects p
      where p.id = profit_records.project_id
        and (
          p.user_id = auth.uid()
          or exists (
            select 1 from project_members pm
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
              and pm.status = 'accepted'
          )
        )
    )
  );

create policy "profit_records_insert" on profit_records
  for insert with check (
    exists (
      select 1 from projects p
      where p.id = profit_records.project_id
        and (
          p.user_id = auth.uid()
          or exists (
            select 1 from project_members pm
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
              and pm.role in ('owner', 'editor')
              and pm.status = 'accepted'
          )
        )
    )
  );

create policy "profit_records_delete" on profit_records
  for delete using (
    exists (
      select 1 from projects p
      where p.id = profit_records.project_id
        and (
          p.user_id = auth.uid()
          or exists (
            select 1 from project_members pm
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
              and pm.role = 'owner'
              and pm.status = 'accepted'
          )
        )
    )
  );

-- ============================================================
-- RLS: Project Members table itself
-- ============================================================
alter table project_members enable row level security;

-- Anyone can see members of projects they have access to
create policy "members_select" on project_members
  for select using (
    exists (
      select 1 from projects p
      where p.id = project_members.project_id
        and (
          p.user_id = auth.uid()
          or exists (
            select 1 from project_members pm2
            where pm2.project_id = p.id
              and pm2.user_id = auth.uid()
              and pm2.status = 'accepted'
          )
        )
    )
    or invited_email = (select email from auth.users where id = auth.uid())
  );

-- Only owners can invite
create policy "members_insert" on project_members
  for insert with check (
    exists (
      select 1 from projects p
      where p.id = project_members.project_id
        and (
          p.user_id = auth.uid()
          or exists (
            select 1 from project_members pm
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
              and pm.role = 'owner'
              and pm.status = 'accepted'
          )
        )
    )
  );

-- Owners can update roles; invited users can accept/decline their own invite
create policy "members_update" on project_members
  for update using (
    invited_email = (select email from auth.users where id = auth.uid())
    or exists (
      select 1 from projects p
      where p.id = project_members.project_id
        and (
          p.user_id = auth.uid()
          or exists (
            select 1 from project_members pm
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
              and pm.role = 'owner'
              and pm.status = 'accepted'
          )
        )
    )
  );

-- Owners can remove members
create policy "members_delete" on project_members
  for delete using (
    exists (
      select 1 from projects p
      where p.id = project_members.project_id
        and p.user_id = auth.uid()
    )
  );

-- ============================================================
-- FUNCTION: Accept invite (links user_id to the pending invite)
-- Call this after a user logs in to auto-accept pending invites
-- ============================================================
create or replace function accept_pending_invites()
returns void as $$
begin
  update project_members
  set
    user_id     = auth.uid(),
    status      = 'accepted',
    accepted_at = now()
  where
    invited_email = (select email from auth.users where id = auth.uid())
    and status = 'pending';
end;
$$ language plpgsql security definer;

-- ============================================================
-- VIEW: Projects with my role (for display)
-- ============================================================
create or replace view my_projects as
select
  p.*,
  case
    when p.user_id = auth.uid() then 'owner'
    else pm.role
  end as my_role,
  case
    when p.user_id = auth.uid() then true
    else false
  end as is_owner
from projects p
left join project_members pm
  on pm.project_id = p.id
  and pm.user_id = auth.uid()
  and pm.status = 'accepted'
where
  p.user_id = auth.uid()
  or (pm.id is not null);

-- ============================================================
-- VIEW: Pending invites for current user
-- ============================================================
create or replace view my_pending_invites as
select
  pm.id,
  pm.project_id,
  pm.role,
  pm.invited_by,
  pm.created_at,
  p.name        as project_name,
  p.description as project_description,
  p.status      as project_status,
  u.email       as invited_by_email,
  u.raw_user_meta_data->>'full_name' as invited_by_name
from project_members pm
join projects p on p.id = pm.project_id
join auth.users u on u.id = pm.invited_by
where
  pm.invited_email = (select email from auth.users where id = auth.uid())
  and pm.status = 'pending';
