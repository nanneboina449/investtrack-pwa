# InvestTrack — Calculations Reference

Every formula in the system, with definitions, worked examples, and edge cases.
This is a companion to `DESIGN.md` — that document describes the architecture;
this one gives you the math.

---

## Conventions used in examples

Symbols:
- `i.X` — column on `investors` table
- `pr.X` — column on `profit_records`
- `pd.X` — column on `profit_distributions`
- `pe.X` — column on `project_expenses`
- `p.X` — column on `projects`
- `ip.X` — column on `investor_payments`
- `ca.X` — column on `cash_adjustments`
- `lc.X` — column on `loan_contributions`
- `lr.X` — column on `loan_repayments`
- `rd.X` — column on `repayment_distributions`

All amounts are in INR (₹) unless noted. Examples use a project Mukkapati Nagar
with four investors at 25% each, total project value ₹6,00,000 (`p.total_value`),
`p.our_stake_percent = 100`.

---

## 1. Project Setup

### 1.1 Investable Pool

```
pool = p.total_value × p.our_stake_percent / 100
```

**Example.** `total_value = 6,00,000`, `our_stake_percent = 100`:
```
pool = 6,00,000 × 100 / 100 = 6,00,000
```

**When `our_stake_percent < 100`** — e.g. the user owns 30% of a venture and
investors fund only that pool:
```
pool = 50,00,000 × 30 / 100 = 15,00,000
```
Investor shares (and commitments) are slices of this pool, not the full
property value.

### 1.2 Auto-Scale Investor Commitments on Project Update

Database trigger `projects_scale_investor_commitments` fires when
`p.total_value` or `p.our_stake_percent` changes. For every investor in that
project:

```
new_amount_invested = old_amount_invested × (new_pool / old_pool)
```

**Example.** Mukkapati Nagar pool grows from ₹6L to ₹8L.
- Old pool = 6,00,000; new pool = 8,00,000; scaling factor = 8/6 = 1.333
- Each investor's commitment: 1,50,000 → 1,50,000 × 1.333 = **2,00,000**
- Their `share_percent` (25%) is unchanged — the stake stays the same, the
  cash backing it grows.

---

## 2. Investor Commitment & Share

### 2.1 Share Split mode (auto-fill amount from share)

```
amount_invested = share_percent × pool / 100
```

**Example.** Share 25% of a ₹6L pool:
```
amount_invested = 25 × 6,00,000 / 100 = 1,50,000
```

### 2.2 Custom Amount mode (auto-derive share from amount)

```
share_percent = amount / pool × 100
```

**Example.** Investor B puts in ₹3,00,000 on the same ₹6L pool:
```
share_percent = 3,00,000 / 6,00,000 × 100 = 50%
```

### 2.3 Manual mode

Both fields entered independently. No formula. Useful for sweat-equity or
agreements where share and contribution have no fixed relationship.

---

## 3. Profit Allocation

### 3.1 Default Split (proportional by share %)

Auto-created `profit_distributions` rows when `create_profit_record` is
called without `p_distributions`:

```
pd.amount = pr.amount × i.share_percent / 100
```

**Example.** Profit record of ₹1,00,000 with four investors at 25% each:
```
A: 1,00,000 × 25 / 100 = 25,000
B: 1,00,000 × 25 / 100 = 25,000
C: 1,00,000 × 25 / 100 = 25,000
D: 1,00,000 × 25 / 100 = 25,000
```

### 3.2 Custom Split

Caller passes explicit `p_distributions` JSON. RPC inserts exactly those rows.
Sum should equal `pr.amount` (validated client-side).

**Example.** ₹1,00,000 profit, custom A=50,000 B=30,000 C=15,000 D=5,000.
The four rows are stored verbatim — `total_profit_allocated` aggregates pull
the actual amounts, not the share% formula.

### 3.3 Investor's Total Profit Allocated (across all profit records in a project)

```
total_profit_allocated = SUM(pd.amount)  WHERE pd.investor_id = i.id
```

### 3.4 Profit Edit — Proportional Scaling

When `updateProfitRecord` changes the amount:
```
ratio = new_amount / old_amount
each pd.amount → pd.amount × ratio
```
Both default and custom-split rows scale proportionally so a typo correction
doesn't break the distribution shape.

**Example.** Profit was ₹1,00,000 with custom split A=50k B=30k C=15k D=5k.
Updated to ₹1,20,000 (ratio 1.2):
- A: 50,000 × 1.2 = 60,000
- B: 30,000 × 1.2 = 36,000
- C: 15,000 × 1.2 = 18,000
- D:  5,000 × 1.2 =  6,000

---

## 4. Expense Allocation

### 4.1 Per-Investor Share of an Expense

```
expense_share_for_investor = pe.amount × i.share_percent / 100
```

**Example.** Registration expense ₹50,000 in Mukkapati Nagar (four × 25%):
- Each investor absorbs: `50,000 × 25 / 100 = 12,500`

### 4.2 Total Expense Share for an Investor in a Project

```
total_expenses_allocated = SUM(pe.amount × i.share_percent / 100)
                        across all pe rows for that project
```

### 4.3 Expense Paid by an Investor

When `pe.paid_by_investor_id = X`, the trigger `expenses_to_payment` inserts:
```
investor_payments {
  investor_id  = X
  project_id   = pe.project_id
  amount       = pe.amount             -- full expense, not the share
  payment_type = 'expense_paid'
  expense_id   = pe.id
}
```

X is credited with the **full** expense amount (cash they advanced).
X's `expense_share` (12,500 in the example) is still absorbed as part of
their `total_expenses_allocated` — so net, X is up by `expense − share`.

**Example.** Investor A pays ₹50,000 registration in Mukkapati Nagar:
- A's `paid` jumps by ₹50,000 (the cash they advanced)
- Everyone's `expense_share` rises by ₹12,500 (their 25% absorption)
- A's **net contribution** from this event: `+50,000 − 12,500 = +37,500`
  (they effectively overpaid by 37,500; the other 3 investors collectively
   owe them 37,500 via the project)

---

## 5. Project-Level Investor Card

This is the per-investor card on the project's Investors tab.
Formulas reflect commitment to **this** project — internal moves to other
projects are tracked but don't pollute Paid/Owes here.

### 5.1 Paid (project-level)

```
paid = + Σ ip.amount  WHERE payment_type IN ('share_contribution','top_up','expense_paid')
       − Σ ip.amount  WHERE payment_type = 'refund' AND destination_project_id IS NULL
                                                    AND destination_investor_id IS NULL
       + 0           for refunds WITH a destination (internal moves — tracked separately)
```

Conceptually: cumulative real cash in/out for this project, excluding moves
to other projects.

**Example A.** Investor A contributes ₹1,50,000 share + ₹50,000 expense paid:
```
paid = 1,50,000 + 50,000 = 2,00,000
```

**Example B.** Investor A contributes ₹1,50,000 then moves ₹50,000 to Project Y
(refund with `destination_project_id = Y`):
```
paid = 1,50,000 + 0 (move ignored) = 1,50,000
extracted = 50,000  (shown in footer)
```

**Example C.** Project liquidates and refunds A's ₹1,50,000 externally
(refund without destination):
```
paid = 1,50,000 − 1,50,000 = 0
```

### 5.2 Owes (Outstanding to this project)

```
owes = i.amount_invested + total_expenses_allocated − paid
```

- **`owes > 0`** → investor still needs to pay (shows "Owes" in amber)
- **`owes < 0`** → project owes them back (shows "Refund" in blue)
- **`owes ≈ 0`** → "Settled" (green)

**Example.** Investor B committed 1,50,000, paid 50,000, expense share 12,500:
```
owes = 1,50,000 + 12,500 − 50,000 = 1,12,500
```

### 5.3 Extracted (footer)

```
extracted = Σ ip.amount  WHERE payment_type = 'refund'
                              AND (destination_project_id IS NOT NULL
                                   OR destination_investor_id IS NOT NULL)
```

The cash that left this project via Move or Lend. Shown as a footer line so
it's visible but doesn't pollute the headline metrics.

### 5.4 ROI on Contribution

```
roi = (total_profit_allocated / amount_invested) × 100
```

Shown only when `profit > 0` and `committed > 0`. Useful for comparing investor
returns when commitments differ but profit share is equal (custom-split case).

**Example.** Three investors split ₹1,00,000 profit equally (33% each) but
their commitments differ:
- A: committed 5,00,000, profit 33,333 → ROI = 33,333/5,00,000 × 100 = **6.67%**
- B: committed 3,00,000, profit 33,333 → ROI = **11.11%**
- C: committed 2,00,000, profit 33,333 → ROI = **16.67%**

C got the best deal per rupee.

---

## 6. Project Header — Capital Flow Strip

Three derived metrics shown in the second row of every project's header.

### 6.1 Value Generated

```
value_generated = Σ ip.amount  WHERE payment_type IN ('share_contribution','top_up','expense_paid')
                + Σ pr.amount  (all profit records)
```

The total cash + profit that this project has booked.

### 6.2 Extracted (project total)

```
extracted_total = Σ ip.amount  WHERE payment_type = 'refund'
                                    AND (destination_project_id IS NOT NULL
                                         OR destination_investor_id IS NOT NULL)
```

### 6.3 Active Capital

```
active_capital = value_generated − extracted_total − total_expenses
```

What's still working in this project.

**Example.** Project A: 3 investors put in ₹2,30,000 total, earned ₹80,000
profit, then ₹31,000 was reallocated to Project Y, ₹0 expenses:
```
value_generated = 2,30,000 + 80,000 = 3,10,000
extracted_total = 31,000
active_capital  = 3,10,000 − 31,000 − 0 = 2,79,000
```

---

## 7. Loan Math

### 7.1 Interest Amount

```
interest_amount = principal × interest_rate_percent / 100
```

Flat interest, computed once at loan recording (we don't accrue over time).

**Example.** ₹1,00,000 loan at 10%:
```
interest_amount = 1,00,000 × 10 / 100 = 10,000
```

### 7.2 Total Due With Interest

```
total_due_with_interest = principal × (1 + interest_rate_percent / 100)
```

Same as `principal + interest_amount`. Stored as a derived column on
the `loan_summary` view.

### 7.3 Loan Outstanding Balance

```
outstanding_balance = total_due_with_interest − Σ lr.amount  (repayments so far)
```

### 7.4 Auto-Settle Threshold

`process_loan_repayment` flips `ca.is_settled = true` when:
```
Σ lr.amount ≥ ca.amount × (1 + interest_rate_percent / 100)
```

### 7.5 Repayment Distribution to Contributors

For each repayment `R`, for each contributor `c`:
```
distribution_to_c = R × (lc.amount / total_principal_contributions)
```

The principal vs interest split is implicit — across the full life of the loan,
each contributor receives `lc.amount × (1 + rate/100)` total.

**Example.** ₹1,00,000 loan at 10% (₹1,10,000 total due) funded by:
- A: ₹60,000 (60%)
- B: ₹30,000 (30%)
- C: ₹10,000 (10%)

John repays ₹55,000 first:
```
A gets: 55,000 × 60 / 100 = 33,000
B gets: 55,000 × 30 / 100 = 16,500
C gets: 55,000 × 10 / 100 =  5,500
```

John repays the remaining ₹55,000 later. Final tallies:
```
A received: 33,000 + 33,000 = 66,000  (= 60,000 + 6,000 interest = principal × 1.10)
B received: 16,500 + 16,500 = 33,000  (= 30,000 + 3,000 interest)
C received:  5,500 +  5,500 = 11,000  (= 10,000 + 1,000 interest)
                              Total =  ₹1,10,000 ✓
```

### 7.6 Repayment — Principal vs Interest Display

For UI clarity on each repayment row:
```
principal_portion = R × principal / total_due
interest_portion  = R − principal_portion
```

**Example.** ₹55,000 repayment on ₹1,00,000 loan @ 10% (total due ₹1,10,000):
```
principal_portion = 55,000 × 1,00,000 / 1,10,000 = 50,000
interest_portion  = 55,000 − 50,000              =  5,000
```

### 7.7 Inter-Investor Loan (Lend)

Same as section 7.5, but the contributor is a single investor (the lender)
and the borrower is another investor whose top-up row carries
`cash_adjustment_id` pointing to the loan.

### 7.8 Borrower's Outstanding (Loans Received)

For each top-up `ip` where `ip.cash_adjustment_id` is a non-settled loan:
```
expected_back        = ip.amount × (1 + interest_rate_percent / 100)
borrower_share_repaid = (ip.amount / ca.amount) × Σ lr.amount
loan_received_outstanding = max(0, expected_back − borrower_share_repaid)
```

**Example.** A lends B ₹4,80,000 at 10% (B's top-up rows record ₹4,80,000;
total due back ₹5,28,000). B has so far had ₹2,00,000 in repayments
distributed:
```
expected_back        = 4,80,000 × 1.10                    = 5,28,000
share_of_repaid      = (4,80,000 / 4,80,000) × 2,00,000   = 2,00,000
outstanding_for_B    = 5,28,000 − 2,00,000                = 3,28,000
```

B's running balance subtracts this 3,28,000.

---

## 8. Dashboard — Cross-Project Per-Investor Totals

`useAllInvestorsSummary` groups investors by `lower(trim(name))` and sums each
metric across their investor records. The aggregation uses `paymentByInv` (net
cash with refunds subtracting) which is intentionally different from the
project-level Paid.

### 8.1 Paid (Net Cash, Dashboard-level)

```
paid_net = Σ ip.amount  WHERE payment_type IN ('share_contribution','top_up','expense_paid')
         − Σ ip.amount  WHERE payment_type = 'refund'
                       (all refunds count — internal or external)
```

For same-person internal moves (one investor's refund + top-up across their own
records), these cancel out at the aggregate level. For inter-investor lending,
the lender's refund stays as `−X` and the borrower's top-up stays as `+X` since
they're on different aggregates.

### 8.2 Out-of-Pocket Cash (Dashboard aggregate)

```
cash_contributed = Σ ip.amount  WHERE payment_type IN ('share_contribution','expense_paid')
                                 OR (payment_type = 'top_up' AND source_project_id IS NULL)
```

Genuine new money the person has put into the system, not redeployed from
another project.

### 8.3 Wallet (Cash Refunded, Not Yet Redeployed)

```
wallet = Σ ip.amount  WHERE payment_type = 'refund'
                       AND destination_project_id IS NULL
                       AND destination_investor_id IS NULL
```

External refunds the person has received (e.g., loan repayments in cash,
project liquidation payouts). When they later deploy this cash into another
project, that creates a fresh `top_up`; the system doesn't auto-match it back
to a wallet entry but the net cashContributed reflects redeployment.

### 8.4 Loans Given Outstanding

```
For each lc WHERE investor_id = inv.id AND ca.is_settled = false:
  expected   = lc.amount × (1 + ca.interest_rate_percent / 100)
  repaid     = Σ rd.amount_returned  WHERE rd.loan_contribution_id = lc.id
  per_loan   = max(0, expected − repaid)

loans_given_outstanding = Σ per_loan
```

### 8.5 Loans Received Outstanding

```
For each ip WHERE investor_id = inv.id
            AND payment_type = 'top_up'
            AND cash_adjustment_id refers to an unsettled loan:
  expected_back = ip.amount × (1 + ca.interest_rate_percent / 100)
  total_repaid  = Σ lr.amount  WHERE lr.loan_id = ip.cash_adjustment_id
  share_repaid  = (ip.amount / ca.amount) × total_repaid
  per_loan      = max(0, expected_back − share_repaid)

loans_received_outstanding = Σ per_loan
```

### 8.6 Net Gain

```
net_gain = profit_allocated − total_expenses_allocated
```

Pure economic return.

---

## 9. Dashboard — Running Balance (Per Investor)

The headline number for each investor row.

```
running_balance = profit_allocated
                − total_expenses_allocated
                + paid_net
                + loans_given_outstanding
                − loans_received_outstanding
```

Reads as: "what's my economic position right now?"

- Profit allocated — income I've earned
- Expense share — cost I've absorbed
- Paid net — net cash I've put in (positive = still deployed; negative = net out)
- Loans given — money I'm owed back (asset)
- Loans received — money I owe (liability)

**Example — Venkatesh.** Contributed ₹23,00,000 to Project A, earned ₹8,00,000
profit, moved the full ₹31L to Project B, lent ₹4,80,000 to Gayathri at 10%:
- profit_allocated: ₹8,00,000
- expense_share: 0
- paid_net across his records:
  - Project A: +23 − 31 (move) − 4.8 (lend out) = −12.8L
  - Project B: +31L (top-up from move)
  - Total: 18.2L
  
  Wait — only the lending leg is on his ledger; the move is *both* a refund
  on A and a top-up on B for the same person. Net paid for Venkatesh
  aggregate from move = 0. The lending refund is real.
  
  Actually: A: +23 − 31 = −8 ; B: +31 ; total = +23 ; then minus 4.8 lent
  out = +18.2

- loans_given_outstanding: 4,80,000 × 1.10 = 5,28,000
- loans_received_outstanding: 0

```
running_balance = 8,00,000 − 0 + 18,20,000 + 5,28,000 − 0 = 31,48,000
```

Composition check: he put in ₹23L of fresh cash + earned ₹8L profit +
expected back ₹48k interest on the loan = ₹31.48L. ✓

**Example — Gayathri (the borrower of the above 4.8L loan).**
- profit_allocated: ₹8,00,000 (from her own project profits)
- expense_share: 0
- paid_net: 0 (initial) + 4,80,000 (top-up borrow) = +4,80,000
- loans_given_outstanding: 0
- loans_received_outstanding: 5,28,000 (she owes 5.28L back to Venkatesh)

```
running_balance = 8,00,000 − 0 + 4,80,000 + 0 − 5,28,000 = 7,52,000
```

Composition check: her real position is ₹8L profit minus ₹48k interest she
owes (the principal nets out). ✓ (Down to ₹7.52L)

---

## 10. Dashboard — Aggregate Card Metrics

Sum of every investor's values into one card at the top.

```
total_committed       = Σ runs.committed
total_profit          = Σ runs.profit
total_expenses        = Σ runs.expense_share
total_net_cash        = Σ runs.paid_net
total_loans_out       = Σ runs.loans_given_outstanding
total_loans_received  = Σ runs.loans_received_outstanding
total_cash_contributed = Σ runs.cash_contributed
total_wallet          = Σ runs.wallet_deposits
total_running_balance = Σ runs.running_balance
```

All shown as line items in the aggregate strip.

---

## 11. Portfolio-Wide Metrics (Dashboard Banner)

Top-of-Dashboard portfolio summary, computed from `useDashboard` (which reads
`my_investments` for cross-project per-user view):

```
total_invested    = Σ my_investments.amount_invested
total_profit      = Σ my_investments.net_return + Σ my_investments.total_expenses_allocated
                                                 (i.e. gross profit)
total_value       = Σ my_investments.current_value
return_pct        = total_value / total_invested × 100 − 100
```

`my_investments.current_value` itself is:
```
current_value = net_cash_paid + total_profit_allocated − total_expenses_allocated
```

with `net_cash_paid` computed inside the view (audit-revised, section 11d of
the consolidated SQL).

---

## 12. Chronological Investor Ledger

`useInvestorLedger(investorIds)` builds one row per event across every project
the person is in, sorted by date. Running portfolio total walks the rows.

### 12.1 Row Sources

- **Payment rows** — one per `ip` for any of their investor_ids
  - Signed amount: `+amount` for non-refund, `−amount` for refund
- **Profit rows** — one per `pd` for any of their investor_ids
  - Date from the parent `profit_records.record_date`
  - Signed: always `+amount` (profit is income)
- **Expense share rows** — for each `pe` in any project they're in
  - Date from `pe.expense_date`
  - Signed: `−(pe.amount × share_percent / 100)`

### 12.2 Running Total

For each row in date order:
```
running += row.amount
row.running = running
```

So the ledger shows cumulative net P&L plus net cash flows at each event.

---

## 13. Cash Flow Page — Net Project Balance

The banner on `/cashflow`:

```
net = + Σ ca.amount  WHERE type IN ('deposit', 'loan_received')
      − Σ ca.amount  WHERE type IN ('withdrawal', 'loan_given')
```

Reallocation rows are zero-sum at the project level so they don't enter the
formula directly.

### 13.1 Pending Loans (loan_summary view)

```
total_repaid       = Σ lr.amount
total_due          = ca.amount × (1 + interest_rate_percent / 100)
outstanding_balance = total_due − total_repaid
```

A loan is "pending" while `is_settled = false`.

---

## 14. Project Card Aggregates

`useProjects` does a client-side recompute as a backstop against the
`my_projects` view's join fanout bug. For each project:

```
total_profit   = Σ pr.amount        WHERE pr.project_id = p.id
total_raised   = Σ i.amount_invested WHERE i.project_id = p.id
total_expenses = Σ pe.amount        WHERE pe.project_id = p.id
net_profit     = total_profit − total_expenses
investor_count = COUNT(*)            FROM investors WHERE project_id = p.id
total_value    = total_raised + total_profit            (for portfolio donut)
our_pool_value = p.total_value × p.our_stake_percent / 100
```

Subqueries (not joins) so there's no Cartesian multiplication.

---

## 15. Profit Records Display (Profit History tab)

For each profit record, the per-investor allocation shown is:
```
display_amount = COALESCE(
  pd.amount,                                  -- explicit row exists
  pr.amount × i.share_percent / 100           -- fall back to proportional
)
```

A "custom split" badge appears when any pd.amount diverges materially from
the proportional calculation.

---

## 16. Investor Balances Tab (per-project Effective Balance)

The Balances tab on a project page shows a per-investor breakdown using the
`investor_running_balance` view plus payment data:

```
effective_balance = paid_in
                  + profit_allocated
                  − total_expenses_allocated
                  − money_loaned_out
                  + money_repaid_received
                  + money_moved_to_projects
```

Where:
```
paid_in                 = Σ ip.amount (refunds subtract) for this investor's row
profit_allocated        = Σ pd.amount  for this investor in this project
total_expenses_allocated = SUM(pe.amount × share_percent / 100)
money_loaned_out        = Σ lc.amount   on unsettled loan_given where investor contributed
money_repaid_received   = Σ rd.amount_returned where lr.repayment_type = 'cash'
money_moved_to_projects = Σ rd.amount_returned where lr.repayment_type = 'project_adjustment'
```

This view emphasizes capital movement, distinct from the cleaner project-level
Investors tab (which uses sections 5.1/5.2).

---

## 17. Edge Cases and Sign Conventions

### 17.1 Negative `paid` at the Project Level

Was a confusion point — fixed by section 5.1's "ignore refunds with
destination" rule. If you ever see negative project-level paid now, it means
the project genuinely refunded the investor more than they put in (external
refund without destination).

### 17.2 Auto-clamp on Owes

`owes` is computed before the project-level paid clamp because the fix
already lives in the paid definition. `owes` should never be inflated by
internal extraction.

### 17.3 Loan Repayment That Exceeds Total Due

The auto-settle check fires once `Σ lr.amount ≥ total_due`. Subsequent
repayments aren't blocked (you could record an over-repayment by mistake);
the system records them but the loan stays `is_settled = true` and
`outstanding_balance` goes negative — a visible signal.

### 17.4 Profit Record Deleted

Cascades to `profit_distributions`. Investor totals drop on next reload.
Already-paid profits aren't reversed elsewhere — if you'd actually
distributed cash for that profit, you'd need to manually record refunds.

### 17.5 Investor Deleted

Cascades to their `investor_payments`, `profit_distributions`,
`loan_contributions`, and `repayment_distributions`. Their share %
disappears — other investors don't automatically pick up the slack (you'd
need to re-balance manually).

### 17.6 Project Total Changed Mid-Cycle

`projects_scale_investor_commitments` trigger scales `amount_invested`
proportionally. Already-recorded payments, profits, and expenses keep their
absolute amounts. So if a project's pool doubles, the commitment doubles,
but the paid-so-far stays the same → outstanding effectively doubles.

### 17.7 Name Mismatch in Reallocation Match

Both `process_loan_repayment` and `reallocate_investor_position` use
`lower(regexp_replace(trim(name), '\s+', ' ', 'g'))` for matching.
Two records with subtle spelling differences (e.g. NANNEBOINA vs NANNEBOYINA)
will not match — fix via Edit on either investor's card.

---

## 18. Quick Reference Card

| Display | Formula |
|---|---|
| Project pool | `total_value × our_stake_percent / 100` |
| Auto-commitment | `share % × pool / 100` |
| Auto-share | `amount / pool × 100` |
| Profit share (default) | `pr.amount × share % / 100` (stored as pd row) |
| Expense share | `pe.amount × share % / 100` |
| Project Paid | `Σ contributions − Σ external refunds` (excludes moves) |
| Project Owes | `committed + expense_share − paid` |
| Extracted | `Σ refunds with destination` |
| Value Generated | `Σ contributions + Σ profits` |
| Active Capital | `Value Generated − Extracted − Expenses` |
| ROI on contribution | `profit / committed × 100` |
| Interest amount | `principal × rate / 100` |
| Total due | `principal × (1 + rate/100)` |
| Loan outstanding | `total_due − Σ repayments` |
| Contributor distribution | `R × (lc.amount / total_principal)` |
| Loans Given outstanding | `Σ (lc.amount × (1+rate/100) − repaid_to_them)` |
| Loans Received outstanding | `Σ (top_up.amount × (1+rate/100) − share of repaid)` |
| Running Balance | `profit − expense + paid_net + loans_out − loans_in` |
| Net Cash (dashboard) | `Σ payments (refunds subtract, all of them)` |
| Out-of-pocket | `Σ contributions where source_project_id IS NULL` |
| Wallet | `Σ refunds where destination IS NULL` |
