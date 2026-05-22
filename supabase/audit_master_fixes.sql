-- ============================================================
-- InvestTrack — Master Audit Fixes (IT-2026-MASTER-AUDIT response)
--
-- The Section 1 critical bugs (1.1 custom split drift, 1.2 inter-
-- investor loan orphans, 1.3 borrower balance inflation) were
-- already resolved in audit_fixes.sql. This file addresses Section 2
-- high-risk items 2.1 and 2.2.
--
-- 2.1: Replace name-string matching in reallocate_investor_position
--      with an immutable investor_id parameter (name lookup becomes
--      a fallback).
-- 2.2: Drop the auto-scale commitments trigger. Scaling now happens
--      as an explicit user action in the EditProjectSheet, with a
--      preview and a checkbox to opt out. Investors no longer find
--      themselves silently "Owes Amber" after a project revaluation.
-- ============================================================

-- ============================================================
-- 1. Deprecate the auto-scale trigger (Audit 2.2)
-- The trigger function is kept (so re-running the consolidated
-- setup doesn't error), but the trigger binding is dropped.
-- ============================================================
drop trigger if exists projects_scale_investor_commitments on projects;

-- ============================================================
-- 2. reallocate_investor_position with investor_id parameter (Audit 2.1)
-- The new p_dest_investor_id is optional. When provided, the RPC uses
-- it directly. When null, falls back to the case+whitespace-insensitive
-- name match for backward compatibility.
-- ============================================================
create or replace function reallocate_investor_position(
  p_source_investor_id   uuid,
  p_dest_project_id      uuid,
  p_amount               numeric,
  p_date                 date default current_date,
  p_notes                text default null,
  p_dest_investor_id     uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_project_id uuid;
  v_source_name       text;
  v_dest_investor_id  uuid;
  v_refund_id         uuid;
  v_topup_id          uuid;
begin
  select project_id, name into v_source_project_id, v_source_name
  from investors where id = p_source_investor_id;
  if v_source_project_id is null then
    raise exception 'Source investor not found';
  end if;

  if v_source_project_id = p_dest_project_id then
    raise exception 'Source and destination projects must be different';
  end if;

  if p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  -- Prefer the explicit UUID. Fall back to name match only if missing.
  if p_dest_investor_id is not null then
    -- Validate the UUID is on the destination project
    if not exists (
      select 1 from investors
      where id = p_dest_investor_id and project_id = p_dest_project_id
    ) then
      raise exception 'Destination investor not found on destination project';
    end if;
    v_dest_investor_id := p_dest_investor_id;
  else
    select id into v_dest_investor_id
    from investors
    where project_id = p_dest_project_id
      and lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
          = lower(regexp_replace(trim(v_source_name), '\s+', ' ', 'g'))
    limit 1;

    if v_dest_investor_id is null then
      raise exception 'No investor named "%" on the destination project. Add them there first or pass p_dest_investor_id.', v_source_name;
    end if;
  end if;

  insert into investor_payments
    (investor_id, project_id, amount, payment_type, payment_date, notes,
     destination_project_id, destination_investor_id)
  values
    (p_source_investor_id, v_source_project_id, p_amount, 'refund',
     p_date, coalesce(p_notes, 'Reallocated to destination project'),
     p_dest_project_id, v_dest_investor_id)
  returning id into v_refund_id;

  insert into investor_payments
    (investor_id, project_id, amount, payment_type, payment_date, notes,
     source_project_id, source_investor_id)
  values
    (v_dest_investor_id, p_dest_project_id, p_amount, 'top_up',
     p_date, coalesce(p_notes, 'Reallocated from source project'),
     v_source_project_id, p_source_investor_id)
  returning id into v_topup_id;

  return v_topup_id;
end;
$$;

grant execute on function reallocate_investor_position(uuid, uuid, numeric, date, text, uuid)
  to authenticated, service_role;
