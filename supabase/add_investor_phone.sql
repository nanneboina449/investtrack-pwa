-- ============================================================
-- InvestTrack — add investors.phone (idempotent)
--
-- Adds a free-text phone column so the Investors management screen
-- can store and edit contact info per person. The Investors screen
-- treats records sharing the same normalized name as one person and
-- propagates email/phone updates to every row in that group.
--
-- Safe to re-run.
-- ============================================================

alter table investors
  add column if not exists phone text;

comment on column investors.phone is
  'Free-text phone number. Managed centrally in the /investors screen — when edited there, the update is broadcast to every investor row sharing the same normalized name so a person has consistent contact details across projects.';
