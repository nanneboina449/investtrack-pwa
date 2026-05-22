# InvestTrack — Design & Implementation Guide

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

### `process_loan_repayment(p_loan_id, p_amount, p_type, p_to_project_id, p_date, p_notes)`

Records a repayment and distributes proportionally to contributors. When `p_type='project_adjustment'`, also creates `top_up` payments on the destination project for each contributor (matched by case + whitespace-insensitive name). Auto-settles when total repaid ≥ principal × (1 + interest%/100).

### `reallocate_investor_position(p_source_investor_id, p_dest_project_id, p_amount, p_date, p_notes)`

Atomic refund + top-up. Matches the destination investor by name. Used by both the Investors tab "⇄ Move" and the Cash Flow Reallocation form.

### `transfer_funds_as_loan(p_source_investor_id, p_dest_investor_id, p_amount, p_interest_pct, p_date, p_notes)`

Inter-investor loan. Creates `cash_adjustments.loan_given` with the borrower as counterparty + `loan_contributions` row crediting the lender + the paired refund/top-up payment rows.

---

## 5. Triggers (dependency auto-sync)

| Trigger | When | What it does |
|---|---|---|
| `expenses_to_payment` | AFTER INSERT on `project_expenses` | If `paid_by_investor_id` is set, auto-creates an `expense_paid` payment on the investor's ledger |
| `projects_scale_investor_commitments` | AFTER UPDATE OF total_value / our_stake_percent on `projects` | Scales every investor's `amount_invested` proportionally to keep their share % consistent |
| `investors_name_sync` | AFTER UPDATE OF name on `investors` | Propagates the new name to `loan_contributions.investor_name` and `repayment_distributions.investor_name` (denormalized text fields) |

### Auto-cascade via FK ON DELETE

- Delete an investor → cascades to `investor_payments`, `loan_contributions`, `profit_distributions`, `repayment_distributions`
- Delete a profit_record → cascades to `profit_distributions`
- Delete a project_expense → `paid_by_investor_id` set null on dependent ledger rows
- Delete a cash_adjustment → cascades to `loan_contributions` and `loan_repayments`; for inter-investor loans, the JS layer also cleans up the paired investor_payments via best-effort match

---

## 6. Dashboard Math

### Per-investor Running Balance

```
running_balance = profit_allocated
                − expense_share_absorbed
                + paid_net           (refunds subtract; aggregate across all their records)
                + loans_given_outstanding
```

Where `loans_given_outstanding` = sum over each unsettled loan they contributed to of `contribution × (1 + interest%/100) − repaid_to_them_so_far`.

### Aggregate row metrics

| Metric | Formula |
|---|---|
| Profit | sum of `profit_distributions` |
| Expenses | sum of `project_expenses × share_percent / 100` |
| Net cash | sum of payments with refunds subtracting |
| Loans out | sum of unsettled `loan_contributions × (1 + interest%/100) − repaid` |
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

1. Column additions: `interest_rate_percent`, `paid_by_investor_id`
2. New tables: `investor_payments` (+ link columns), `profit_distributions`
3. Drop legacy auto-payment triggers that conflated commitment with paid
4a. Trigger: expense paid by investor → auto-payment row
4b. Trigger: scale investor commitments when project pool changes
4c. Trigger: keep `investor_name` text columns in sync when investors are renamed
5. RLS policies (select / insert / update / delete) + grants
6. Data hygiene: trim + collapse whitespace on names; case-insensitive index
7. Backfills:
   - 7a. profit_distributions for pre-existing profit records (proportional)
   - 7b. expense_paid payment rows for expenses with `paid_by_investor_id` set but missing linked payment
8. View replacements:
   - `my_projects` (subquery-based to avoid Cartesian fanout)
   - `project_summary` (same fix)
   - `loan_summary` (with interest fields)
9. RPC: `process_loan_repayment` (interest + project_adjustment + case-insensitive match)
10. RPC: `create_profit_record` (custom distributions)
11. RPC: `reallocate_investor_position` (atomic linked refund + top_up)
11b. RPC: `transfer_funds_as_loan` (inter-investor lending)
12. Helper view: `investor_payment_history`

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

- **Loans-received outstanding** (a borrower's payable side of an inter-investor loan) is not yet subtracted from their Running Balance — the borrower's `paid_net` includes the borrowed amount but no offsetting liability. Workaround: add a `cash_adjustment_id` link column on `investor_payments` so we can join back from the borrower's top-up to the loan and compute their outstanding share.
- **No explicit Wallet table**. Wallet balance is currently derived (refunds-without-destination minus the implied next contribution). For a long-running app this should become a stored `investor_wallets` table with explicit "deposit to wallet" / "withdraw from wallet to project" transactions.
- **Inter-investor loan cleanup on delete** uses a best-effort match by `(amount, date, contributor)`. Two identical inter-investor loans on the same day would be ambiguous. Add `cash_adjustment_id` to investor_payments to make this airtight.
- **Project-level view replacement** for `investor_profit_summary` and `investor_running_balance` is blocked by Postgres's "cannot drop columns from view" check (a dependent view, likely `my_investments`, holds the column types). Worked around by reading `profit_distributions` directly in the frontend for custom-split-aware totals.
- **No explicit "exit investor" flow**. To exit an investor cleanly, currently you record a refund + delete the investor. A dedicated "Exit Investor" sheet would do this atomically with a settlement preview.
- **Project status = completed** is a soft close. Books stay editable. A "Close & Settle" action that refunds outstanding positions and freezes the project is a future addition.
- **`my_investments` view definition** isn't tracked in this repo — it was created via a migration file referenced in commit `9bb79fc` but not committed. Pulling that view's `pg_get_viewdef` and pasting it into the consolidated setup would close the gap.

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
