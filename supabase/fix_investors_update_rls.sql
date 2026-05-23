-- ============================================================
-- InvestTrack — add missing investors_update RLS policy
--
-- ROOT CAUSE of "0 updated" when editing investor details:
-- The investors table has SELECT / INSERT / DELETE RLS policies
-- but NO UPDATE policy. When RLS is enabled and a policy doesn't
-- exist for an operation, Postgres silently denies the operation
-- to every row — no error is raised, the response just shows
-- 0 rows affected. This silently broke the existing per-row
-- updateInvestor() too; the UI optimistically re-rendered so it
-- looked like it worked.
--
-- Fix: add an UPDATE policy mirroring the INSERT one — project
-- owners and editors can update investor rows on projects they
-- have edit access to.
--
-- Idempotent.
-- ============================================================

drop policy if exists "investors_update" on investors;

create policy "investors_update" on investors
  for update
  using (has_project_edit(project_id))
  with check (has_project_edit(project_id));

comment on policy "investors_update" on investors is
  'Project owners and editors can update investor rows on projects they have edit access to. Added after debugging the Investors-tab batch edit returning 0 rows updated.';
