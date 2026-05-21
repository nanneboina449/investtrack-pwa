-- ============================================================
-- InvestTrack — Keep denormalized investor_name in sync
--
-- loan_contributions and repayment_distributions store the investor's
-- name as a plain text column (so the historical record survives even
-- if the investor row is deleted). When a name is corrected via the
-- Edit Investor sheet, those denormalized fields go stale and the UI
-- shows the old spelling on past loan repayment records.
--
-- This trigger propagates the new name to all dependent rows whenever
-- investors.name changes.
-- ============================================================

create or replace function sync_investor_name_to_denormalized()
returns trigger
language plpgsql
as $$
begin
  if NEW.name is distinct from OLD.name then
    update loan_contributions
      set investor_name = NEW.name
      where investor_id = NEW.id;

    update repayment_distributions
      set investor_name = NEW.name
      where loan_contribution_id in (
        select id from loan_contributions where investor_id = NEW.id
      );
  end if;
  return NEW;
end;
$$;

drop trigger if exists investors_name_sync on investors;
create trigger investors_name_sync
  after update of name on investors
  for each row execute function sync_investor_name_to_denormalized();
