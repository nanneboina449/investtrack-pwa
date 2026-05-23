# InvestTrack — Design & Implementation Guide

> Companion: see [`CALCULATIONS.md`](./CALCULATIONS.md) for every formula in
> the system with definitions and worked examples.


A multi-investor, multi-project portfolio tracker. This document describes the
data model, the calculation rules, the UI surfaces, and the migration history
of every feature shipped so far.

---

## 1. Stack & Deployment

| Layer        | Technology                                                          |
| ------------ | ------------------------------------------------------------------- |
| Frontend     | React 18, Vite 5, Tailwind 3, Recharts, react-router-dom v6         |
| Backend / DB | Supabase (Postgres + RLS) via `@supabase/supabase-js` v2            |
| Auth         | Supabase email/password                                             |
| PWA          | `vite-plugin-pwa` (Workbox) — offline cache + installable manifest  |
| Deploy       | Vercel (configured), Netlify drop also supported                    |

Required env vars in `.env`:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Missing env vars → app renders a `SetupScreen` instead of crashing.

---

## 2. Data Model

### Core tables

| Table                      | Purpose                                                                       |
| -------------------------- | ----------------------------------------------------------------------------- |
| `projects`                 | Project rows. Owns total value + our stake %. Status: upcoming/active/completed |
| `investors`                | Per-project investor records. Has `name`, `share_percent`, `amount_invested` (commitment), optional `email`/`phone` |
| `profit_records`           | Project-level profit events                                                   |
| `profit_distributions`     | Per-investor allocation for each profit_record (custom or auto-proportional)  |
| `project_expenses`         | Project-level expenses; optional `paid_by_investor_id`                        |
| `investor_payments`        | Ledger of cash flows per investor record. Types: `share_contribution`, `top_up`, `expense_paid`, `refund`. Link cols: `source_/destination_project_id`, `source_/destination_investor_id`, `expense_id` |
| `cash_adjustments`         | Project-level cash events: `loan_given`, `loan_received`, `deposit`, `withdrawal`, `reallocation`. Carries `interest_rate_percent` |
| `loan_contributions`       | Per-investor funding of a loan_given                                          |
| `loan_repayments`          | Repayment events against a loan                                               |
| `repayment_distributions`  | How each repayment splits back to contributors                                |
| `project_members`          | Project sharing — invite users by email with role (owner/editor/viewer)       |

### Key columns on `investor_payments` (the central ledger)

```sql
investor_id              uuid    -- whose ledger this row belongs to
project_id               uuid    -- which project this row affects
amount                   numeric -- always positive; sign is implied by payment_type
payment_type             text    -- share_contribution / top_up / expense_paid / refund
expense_id               uuid    -- FK if this payment is linked to a paid expense
source_project_id        uuid    -- where the money came from (for top_ups)
source_investor_id       uuid    -- which other investor / record sent it
destination_project_id   uuid    -- where the money went (for refunds)
destination_investor_id  uuid    -- which other investor / record received it
```

The link columns make every move bidirectionally traceable from either end.

---

## 3. Key Concepts

### Committed vs Paid

These mean two different things and never conflate:

- **Committed** = `investors.amount_invested`. The investor's pledged stake in a project. This is what they *agreed to invest*.
- **Paid** = derived from `investor_payments`. Cumulative cash they've actually contributed to a project.

A typical investor card shows: `Owes = Committed + Expense_share − Paid`.

### Project-level Paid vs Dashboard Net Cash

These also differ on purpose:

- **Project-level Paid** preserves the *original contribution history*. Internal extractions (Move to another project, Lend to another investor) **don't** reduce it — the original cash going in is a historical fact.
- **Dashboard Net Cash** is the **net cash position right now**, summed across every investor record this person owns. Refunds with destination cancel out across the paired top_up rows when the same person is on both ends; for inter-investor lending, only one side shows on the lender's ledger and the receivable is added back via `loans_given_outstanding`.

### Profit Distribution

Two modes, both backed by stored `profit_distributions` rows:

- **Default** — when recording a profit, the RPC `create_profit_record` auto-creates one distribution row per investor at `amount × share_percent / 100`.
- **Custom** — the Add Profit sheet lets the owner enter each investor's amount manually. Sum must equal the total.

Either way the ledger row is the source of truth — the views never recompute share % at query time.

### Move vs Lend vs Inter-investor Loan

| Action               | What it creates                                                         | Obligation tracked? |
| -------------------- | ----------------------------------------------------------------------- | ------------------- |
| **Move Position**    | Refund on source + Top-up on destination (same name on both projects)   | No — same person redistributing |
| **Lend (↗ Lend)**    | Refund on lender + Top-up on borrower + `cash_adjustments.loan_given` + `loan_contributions` row | Yes — `process_loan_repayment` distributes back |
| **CashFlow Reallocation** | Same as Move, but invoked from the Cash Flow Add Transaction sheet; also drops a marker `cash_adjustments` row | No |
| **Loan Repayment as project_adjustment** | If `to_project_id` is set on the repayment, contributors get auto-credited via top_up on the destination | n/a (repayment) |

### Cash vs Reinvested

A `top_up` payment with `source_project_id` set is a **reinvestment** (paper profit / capital redeployed). One without is **fresh cash** out of pocket.
This is surfaced as a chip on the Payments tab.

---

## 4. RPC Functions

Located in `supabase/investtrack_full_setup.sql` (idempotent, re-runnable).

### `create_profit_record(p_project_id, p_amount, p_record_date, p_notes, p_distributions json)`

Inserts the profit_record and the per-investor `profit_distributions` atomically.
If `p_distributions` is null, auto-creates proportional rows. Otherwise inserts exactly what the caller specified.

### `process_loan_repayment(p_loan_id, p_amount, p_type, p_to_project_id, p_date, p_notes, p_dest_investor_map json)`

Records a repayment and distributes proportionally to contributors. When `p_type='project_adjustment'`, also creates `top_up` payments on the destination project for each contributor.

**Destination matching** — when `p_dest_investor_map` is supplied as a JSON array of `{contributor_id, dest_investor_id}` pairs, the RPC uses those UUIDs directly (Master Audit Phase B). When null, falls back to case + whitespace-insensitive name match.

Auto-settles when total repaid ≥ principal × (1 + interest%/100).

### `reallocate_investor_position(p_source_investor_id, p_dest_project_id, p_amount, p_date, p_notes, p_dest_investor_id uuid)`

Atomic refund + top-up between projects. When `p_dest_investor_id` is provided (UUID), uses it directly (Master Audit 2.1). When null, falls back to name matching. Used by both the Investors tab "⇄ Move" and the Cash Flow Reallocation form.

### `transfer_funds_as_loan(p_source_investor_id, p_dest_investor_id, p_amount, p_interest_pct, p_date, p_notes)`

Inter-investor loan. Creates `cash_adjustments.loan_given` with the borrower as counterparty + `loan_contributions` row crediting the lender + the paired refund/top-up payment rows, all linked back to the loan via `cash_adjustment_id`.

### `delete_cash_adjustment(p_id uuid)`

Safe-cleanup teardown of a cash_adjustment when the `cash_adjustment_id` FK is RESTRICT. Deletes linked `investor_payments` first, then the `cash_adjustment` (which cascades to `loan_contributions` and `loan_repayments` via their own FKs). All inside a transaction. Used by `deleteCashAdjustment` in `useData.js`.

---

## 5. Triggers (dependency auto-sync)

| Trigger | When | What it does |
|---|---|---|
| `expenses_to_payment` | AFTER INSERT on `project_expenses` | If `paid_by_investor_id` is set, auto-creates an `expense_paid` payment on the investor's ledger |
| `investors_name_sync` | AFTER UPDATE OF name on `investors` | Propagates the new name to `loan_contributions.investor_name` and `repayment_distributions.investor_name` (denormalized text fields) |

**Dropped** — `projects_scale_investor_commitments` was removed per Master Audit 2.2. The scaling function `scale_investor_commitments_on_project_change()` is still defined (so older deployments don't error), but the trigger binding is gone. Investor commitment scaling is now an explicit checkbox in EditProjectSheet — see section 7 (Project detail).

**Optional / opt-in** — `check_project_book_lock()` function ships in section 11e of the consolidated SQL but the trigger creation is commented out. Uncomment to enable, which throws `Database Write Blocked: ...` on any insert/update/delete to `investor_payments` whose parent project is `status = 'completed'`.

### FK ON DELETE behavior

| Parent → Child | Behavior |
|---|---|
| `investors` → `investor_payments` | CASCADE |
| `investors` → `loan_contributions` | CASCADE |
| `investors` → `profit_distributions` | CASCADE |
| `profit_records` → `profit_distributions` | CASCADE |
| `project_expenses` → `investor_payments.expense_id` | SET NULL |
| **`cash_adjustments` → `investor_payments.cash_adjustment_id`** | **RESTRICT** (Master Audit Phase B). Use `delete_cash_adjustment` RPC for safe teardown. |
| `cash_adjustments` → `loan_contributions` | CASCADE |
| `cash_adjustments` → `loan_repayments` | CASCADE |
| `loan_repayments` → `repayment_distributions` | CASCADE |

### Table-level CHECK constraints

- `investor_payments.amount > 0`
- `profit_records.amount` (any sign allowed; expense vs profit semantics is in the value)
- `project_expenses.amount > 0`
- `loan_repayments.amount > 0` (Master Audit Phase B)
- `investors.share_percent > 0 AND <= 100`

---

## 6. Dashboard Math

### Per-investor Running Balance

```
running_balance = profit_allocated
                − expense_share_absorbed
                + paid_net                       (refunds subtract; aggregate across all their records)
                + loans_given_outstanding         (receivables — money I'm owed back)
                − loans_received_outstanding      (payables — money I owe — Master Audit Phase B)
```

Where:
- `loans_given_outstanding` = sum over each unsettled loan they contributed to of `contribution × (1 + interest%/100) − repaid_to_them_so_far`
- `loans_received_outstanding` = sum over each `top_up` row linked to an unsettled loan (via `cash_adjustment_id`) of `top_up.amount × (1 + interest%/100) − their_share_of_repaid`

### Aggregate row metrics

| Metric | Formula |
|---|---|
| Profit | sum of `profit_distributions` |
| Expenses | sum of `project_expenses × share_percent / 100` |
| Net cash | sum of payments with refunds subtracting |
| Loans out | sum of unsettled `loan_contributions × (1 + interest%/100) − repaid` |
| Loans in | sum of unsettled `top_up.amount × (1 + interest%/100) − share of repaid` (via `cash_adjustment_id` link) |
| Committed | sum of `amount_invested` across all their investor records |
| Out-of-pocket cash | sum of `share_contribution + top_up_without_source + expense_paid` |
| Wallet | sum of `refund_without_destination` — refunds received but not redeployed |

### Project Header — Capital Flow

```
Value Generated = total_paid_in + total_profit
Extracted       = total of refund-with-destination
Active Capital  = Value Generated − Extracted − total_expenses
```

### Per-investor Ledger (chronological)

Implemented as `useInvestorLedger(investorIds)` — fetches every payment, profit distribution, and expense share allocation for the supplied investor records, sorts by date, and walks the rows computing a running portfolio total. Surfaced via a modal from each Dashboard investor row.

---

## 7. UI Surfaces

### Dashboard (`/`)

- Portfolio banner (total value / invested / profit / return %)
- 4 stat cards (Active Projects / Upcoming / Loans Given / Loans Received)
- Portfolio Allocation donut (interactive)
- **Investor Running Totals** — aggregate metric row + per-investor cards with Running Balance + tap-to-expand breakdown + "📜 View full ledger" modal
- "My Investments" section (cross-project view of user's own investor records)
- Active + Upcoming project cards (grid on desktop)

### Projects list (`/projects`)

Tabs: Active / Upcoming / Done. Grid layout on desktop.

### Project detail (`/projects/:id`)

- Header: project name + 6 metric cards in two rows (Property Value / Net Return / Share Filled + Value Generated / Extracted / Active Capital)
- ShareBar showing per-investor allocation
- Tabs: Investors / Payments / Profit History / Expenses / Balances
- Per-investor card actions: ✎ Edit, ⇄ Move, ↗ Lend, × Delete
- Payments tab: per-investor grouped ledger with `← from / → to` clickable links + 💵 cash / ♻ reinvested chips
- AddProfitSheet: Default by share % / Custom split toggle
- AddExpenseSheet: "Paid by" quick-pick buttons at top

### Cash Flow (`/cashflow`)

- Net balance banner
- Pending loans alert with Settle / Edit / Record Repayment actions
- Filter tabs (All / Loans / Deposits / Moves)
- Add Transaction sheet: type-aware (loan_given / loan_received / deposit / withdrawal / reallocation)
- Reallocation form: filtered destination dropdown (only projects where source investor exists)
- Edit Transaction sheet with Delete button

### Settings (`/settings`)

Account, version, clear cache + reload.

### Layout

Responsive — mobile bottom nav + 430px phone frame, desktop sidebar nav + full width + centred sheets (≥ 1024px breakpoint).

---

## 8. SQL Migration History

The repo's `supabase/` folder contains the full migration timeline, but they're all idempotent and consolidated into one re-runnable file. Run this single file in the Supabase SQL Editor against your database — it brings everything to current state:

**`supabase/investtrack_full_setup.sql`**

Sections inside it:

| § | What |
|---|---|
| 1 | Column additions: `interest_rate_percent` on `cash_adjustments`, `paid_by_investor_id` on `project_expenses` |
| 2a | New table `investor_payments` |
| 2b | Cross-project link columns on `investor_payments` (source/destination project + investor) |
| 2c | `cash_adjustment_id` link with **ON DELETE RESTRICT** (Master Audit Phase B). New table `profit_distributions`. |
| 3 | Drop legacy auto-payment triggers that conflated commitment with paid |
| 4a | Trigger `expenses_to_payment` — expense paid by investor → auto-payment row |
| 4b | Function `scale_investor_commitments_on_project_change` retained; **trigger binding DROPPED** per Master Audit 2.2 |
| 4c | Trigger `investors_name_sync` — propagate name updates to denormalized text columns |
| 5 | RLS policies (select / insert / update / delete) + grants for `investor_payments` and `profit_distributions` |
| 6 | Data hygiene: trim + collapse whitespace on names; normalized case-insensitive name index |
| 7a | Backfill `profit_distributions` for pre-existing profit records (proportional) |
| 7b | Backfill `investor_payments` for expenses with `paid_by_investor_id` set but no linked payment |
| 8a | View `my_projects` — subquery-based to avoid Cartesian fanout |
| 8b | View `project_summary` — same subquery treatment |
| 8c | View `loan_summary` — with `interest_amount`, `total_due_with_interest` |
| 9 | RPC `process_loan_repayment(loan, amount, type, to_project, date, notes, **dest_investor_map**)` — interest + project_adjustment + UUID map (Phase B) with name match fallback |
| 9b | RPC `delete_cash_adjustment(uuid)` — safe teardown for the RESTRICT FK |
| 9c | `CHECK (amount > 0)` on `loan_repayments` |
| 10 | RPC `create_profit_record(project, amount, date, notes, distributions json)` |
| 11 | RPC `reallocate_investor_position(source, dest_project, amount, date, notes, **dest_investor_id**)` — UUID-aware (Audit 2.1) |
| 11b | RPC `transfer_funds_as_loan(source, dest, amount, interest_pct, date, notes)` — inter-investor lending |
| 11c | Backfill `cash_adjustment_id` on historical inter-investor loan payments |
| 11d | View `my_investments` — CTE that reads `profit_distributions` + ledger (custom-split-aware) |
| 11e | Function `check_project_book_lock()`; trigger creation commented out (opt-in) |
| 12 | Helper view `investor_payment_history` for the Payments tab UI |

### Standalone migration files (each idempotent — applies one audit pass)

| File | Patches |
|---|---|
| `audit_fixes.sql` | First audit: `cash_adjustment_id` column + CASCADE, `my_investments` rewrite, loan-orphan + borrower-inflation fixes |
| `audit_master_fixes.sql` | Master Audit Section 2: UUID match in `reallocate_investor_position`, drop auto-scale commitments trigger |
| `audit_phase_b_fixes.sql` | Master Audit Phase B: RESTRICT FK + `delete_cash_adjustment` RPC, UUID map for `process_loan_repayment`, positive-amount CHECK on loan_repayments |

You can run the standalone files against a live DB (they detect existing state), or simply re-run `investtrack_full_setup.sql` which has every change folded in.

---

## 9. Frontend Hooks (data layer)

Located in `src/hooks/useData.js`. The fetch hooks return `{ data, loading, error, reload }`.

| Hook | Purpose |
|---|---|
| `useProjects` | All visible projects + their totals (client-side recompute as a backstop) |
| `useInvestors(projectId)` | Investors on a project (with per-investor profit/expense allocation from the view) |
| `useInvestorBalances(projectId)` | `investor_running_balance` view |
| `useProfitRecords(projectId)` | Project profit history |
| `useProfitDistributions(projectId)` | Per-record distributions |
| `useExpenses(projectId)` | Project expenses |
| `useInvestorPayments(projectId)` | Payment ledger for a project |
| `useCashFlow` | All cash adjustments |
| `useLoans` | `loan_summary` view |
| `useDashboard` | Aggregate cross-project for the signed-in user |
| `useMyInvestments` | Cross-project view of user's own investor records |
| `useAllInvestors` | Flat list of every investor record (for cross-project pickers) |
| `useAllInvestorsSummary` | Aggregated per-person totals across projects (Dashboard) |
| `useInvestorLedger(investorIds)` | Chronological cross-project ledger for one person |

Mutations: `createProject`, `updateProject`, `deleteProject`, `createInvestor`, `updateInvestor`, `deleteInvestor`, `createProfitRecord`, `updateProfitRecord`, `deleteProfitRecord`, `createExpense`, `updateExpense`, `deleteExpense`, `createPayment`, `updatePayment`, `deletePayment`, `updateMove`, `createLoan`, `recordRepayment`, `updateLoan`, `markSettled`, `updateCashAdjustment`, `deleteCashAdjustment`, `reallocateInvestorPosition`, `transferFundsAsLoan`.

---

## 10. Known Limitations & Future Work

### Resolved by the May 2026 audit (sections 11d, 11c, 11e in `investtrack_full_setup.sql`)

- ✅ **Loans-received outstanding for borrowers** — now subtracted from Running Balance. The frontend computes it by joining `investor_payments` to `cash_adjustments` via the new `cash_adjustment_id` link.
- ✅ **Inter-investor loan cleanup on delete** — `cash_adjustment_id` link column added. The old best-effort match by `(amount, date, contributor)` is gone from `deleteCashAdjustment`. FK was later switched from CASCADE → RESTRICT in Phase B for ledger preservation; teardown now goes through the `delete_cash_adjustment` RPC.
- ✅ **`my_investments` view drift on custom splits** — view rewritten with a CTE that pulls `profit_distributions` and the actual ledger.
- ✅ **`my_investments` view definition** — now committed in the consolidated setup (sections 11d).

### Resolved by the May 2026 Master Audit (sections 11, this file's commit + `audit_master_fixes.sql`)

- ✅ **Audit 2.1 — Name-string matching in RPC**: `reallocate_investor_position` now takes an optional `p_dest_investor_id` UUID. The UI looks up the destination investor in the (already filtered) destination project dropdown and passes the UUID; name matching is fallback only.
- ✅ **Audit 2.2 — Auto-scale trigger silently overwrites commitments**: The `projects_scale_investor_commitments` trigger is dropped. Scaling is now an explicit checkbox in EditProjectSheet (default ON), executing a batch `updateInvestor` after the project update — so the user actively confirms.

### Resolved by the May 2026 Master Audit Phase B (`audit_phase_b_fixes.sql`)

- ✅ **`cash_adjustment_id` FK switched to ON DELETE RESTRICT**: financial records can't be wiped by a stray DELETE on cash_adjustments. The Delete-loan UX still works via the new `delete_cash_adjustment(uuid)` RPC, which handles the explicit teardown order inside a transaction.
- ✅ **Multi-leg repayment name-match closed**: `process_loan_repayment` now takes an optional `p_dest_investor_map` JSON parameter (array of `{contributor_id, dest_investor_id}` pairs). Frontend pre-resolves the mapping and passes it; name match remains only as a safety net.
- ✅ **Over-repayment validation**: `loan_repayments.amount` now has a `CHECK (amount > 0)` constraint at the DB level, and the Record Repayment sheet displays an inline amber warning when the entered amount exceeds the outstanding balance.

### Still open

- **Audit 2.3 — Hard delete cascades on investors**. Deleting an investor still wipes their entire ledger history through FK CASCADE. For compliance-grade audit trails the right move is soft delete (`deleted_at` column + filter in every view). Documented as a future schema migration.
- **Audit Phase B — `share_contribution` immutability trigger declined**. The audit recommended a BEFORE UPDATE trigger that blocks edits to share_contribution payment rows. Declined intentionally: the Edit Payment sheet legitimately exists for correcting typos and adjusting historical amounts. Hard-blocking trades real UX for theoretical compliance gain. Documented design choice.
- **No explicit Wallet table**. Wallet balance is currently derived (refunds-without-destination minus implied next contribution). For thousands of rows per investor this becomes a frontend bottleneck. Recommended: an `investor_wallets` table that INSERTS on external refund and DEBITs on next deployment.
- **No explicit "exit investor" flow**. To exit cleanly today you record a refund + delete the investor. A dedicated "Exit Investor" sheet would do this atomically with a settlement preview.
- **Project status = completed is soft-close**. Books stay editable unless the `tr_lock_completed_project_payments` trigger is enabled (commented out in section 11e — uncomment to switch on). A "Close & Settle" UI flow that refunds outstanding positions and freezes the project is the next layer up.
- **`investor_profit_summary` / `investor_running_balance` views** still can't be cleanly replaced via `CREATE OR REPLACE VIEW` due to dependent-view column-type lock. Worked around by reading `profit_distributions` directly in the frontend for custom-split-aware totals. The audit's recommendation — migrate aggregations to inline TVFs or materialized views with explicit refresh triggers — is a future cleanup.
- **`process_loan_repayment` still uses name matching** when type=project_adjustment (to find contributor's counterpart on the destination project). Master Audit 2.1's recommendation to use UUID is partially addressed via `reallocate_investor_position`; doing the same for `process_loan_repayment` would require passing a per-contributor destination map.

---

## 11. Getting Started

```bash
# Clone
git clone https://github.com/nanneboina449/investtrack-pwa
cd investtrack-pwa

# Install
npm install

# Configure
cp .env.example .env
# Edit .env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# Database
# In the Supabase SQL Editor, run:
#   supabase/full_schema.sql                 (initial schema, if fresh DB)
#   supabase/investtrack_full_setup.sql      (everything else, idempotent)

# Dev
npm run dev          # http://localhost:5173

# Build
npm run build
npm run preview
```

Deploy: `vercel` (env vars in dashboard) or drop `dist/` into Netlify.

---

## 12. Glossary

| Term | Definition |
|---|---|
| **Pool** | `total_value × our_stake_percent / 100` — the slice of a project's value available for investors to share |
| **Committed** | Investor's pledged stake (= `amount_invested` column) |
| **Paid** | Cumulative cash contributed to a project, not net of internal moves |
| **Net Cash** | Paid with refunds subtracting — used at the Dashboard aggregate |
| **Outstanding / Owes** | `committed + expense_share − paid` (capped at 0 if negative paid from internal extraction) |
| **Profit** | Allocated share of `profit_records` via `profit_distributions` |
| **Expense Share** | `project_expense × share_percent / 100` |
| **Extracted** | Refunds with `destination_project_id` set — money moved/lent out of this project |
| **Move** | Same-person reallocation across projects via `reallocate_investor_position` |
| **Lend** | Different-person inter-investor loan via `transfer_funds_as_loan` |
| **Cash** chip | A top-up without `source_project_id` — fresh out-of-pocket |
| **Reinvested** chip | A top-up with `source_project_id` — capital redeployed from another project |
| **Running Balance** | `profit − expense_share + paid_net + loans_given_outstanding` |
| **Out-of-pocket Cash** | Sum of all cash contributions not from another project |
| **Wallet** | Refunds received externally that haven't been redeployed |
