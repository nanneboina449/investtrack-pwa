-- ============================================================
-- InvestTrack — Auto-scale investor commitments when project pool changes
--
-- When projects.total_value or projects.our_stake_percent changes,
-- the investable pool changes (= total_value * our_stake_percent / 100).
-- An investor with a 25% share should still have 25% of the new pool
-- as their commitment, so their amount_invested needs to scale by the
-- same factor.
--
-- This trigger fires once per project UPDATE that touches either
-- column, and scales every investor's amount_invested in that project
-- proportionally. Investor payments, profit distributions, and other
-- ledger rows are left alone — only the commitment field changes.
-- ============================================================

create or replace function scale_investor_commitments_on_project_change()
returns trigger
language plpgsql
as $$
declare
  old_pool numeric;
  new_pool numeric;
begin
  old_pool := coalesce(OLD.total_value, 0) * coalesce(OLD.our_stake_percent, 100) / 100;
  new_pool := coalesce(NEW.total_value, 0) * coalesce(NEW.our_stake_percent, 100) / 100;

  if old_pool > 0 and abs(new_pool - old_pool) > 0.01 then
    update investors
    set amount_invested = round(amount_invested * (new_pool / old_pool), 2)
    where project_id = NEW.id;
  end if;

  return NEW;
end;
$$;

drop trigger if exists projects_scale_investor_commitments on projects;
create trigger projects_scale_investor_commitments
  after update of total_value, our_stake_percent on projects
  for each row execute function scale_investor_commitments_on_project_change();
