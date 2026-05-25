// src/pages/PortfolioExplain.jsx
//
// "Running Balance Explained" — a transparent, line-by-line breakdown
// of how the Portfolio's Running Balance hero number is computed.
// Pulls every contributing transaction from the DB and shows the math
// step by step so the user can cross-check against what they remember
// paying / earning / owing.
//
// Visible to whoever is logged in; shows only their own data (same
// matching rules as MyPortfolio, plus a name-only fallback so the page
// works even before the user links their email in /investors).
import { Link } from 'react-router-dom'
import { useMyPortfolio } from '../hooks/useData'
import { inr } from '../lib/supabase'
import { Spinner, Empty } from '../components/ui'

const fmt = (n) => inr(Math.round(Number(n || 0)))
const sign = (n) => n >= 0 ? '+' : '−'

export default function PortfolioExplain() {
  // allowNameFallback: this page works for project owners who haven't
  // run the RLS-update SQL yet and therefore can't link their email
  // via /investors. Matches by metadata.full_name only as a last resort.
  const { data, loading, error } = useMyPortfolio({ allowNameFallback: true })

  if (loading) {
    return <div className="min-h-[50vh] flex items-center justify-center"><Spinner size="lg" /></div>
  }
  if (error) {
    return <div className="px-5 py-12"><Empty icon="⚠️" title="Failed to load" sub={error} /></div>
  }
  if (!data || data.empty) {
    return (
      <div className="px-5 py-12">
        <Empty
          icon="🌱"
          title="No investor records to explain"
          sub={data?.identity?.email
            ? `Couldn't find any records matching ${data.identity.email} or ${data.identity.name ?? '—'}.`
            : 'Sign in to see your breakdown.'}
        />
      </div>
    )
  }

  // ── Aggregate per-project line items ───────────────────────
  // useMyPortfolio already gives us per-project {invested, profit, expense,
  // currentValue} AND a per-payment-type breakdown
  // (contribIn / topUpExternal / expensePaidByMe / moveIn/moveOut /
  // refundExternal / othersShareOfMyExpenses).

  const cashByProject = data.projects
    .map(p => ({
      project_id: p.project_id,
      name: p.name,
      share_percent: p.share_percent,
      // Net cash you put in for this project, broken out by type
      contribIn:               p.contribIn               ?? 0,
      topUpExternal:           p.topUpExternal           ?? 0,
      expensePaidByMe:         p.expensePaidByMe         ?? 0,
      moveIn:                  p.moveIn                  ?? 0,
      moveOut:                 p.moveOut                 ?? 0,
      refundExternal:          p.refundExternal          ?? 0,
      othersShareOfMyExpenses: p.othersShareOfMyExpenses ?? 0,
      amount: p.invested,
    }))
    .filter(p => p.amount !== 0 || p.expensePaidByMe > 0)
  const totalPaid = cashByProject.reduce((s, p) => s + p.amount, 0)
  const totalExpensesPaidByMe = cashByProject.reduce((s, p) => s + p.expensePaidByMe, 0)
  const totalOthersShareReceivable = cashByProject.reduce((s, p) => s + p.othersShareOfMyExpenses, 0)

  const profitByProject = data.projects.map(p => ({
    project_id: p.project_id,
    name: p.name,
    share_percent: p.share_percent,
    amount: p.profit,
  })).filter(p => p.amount !== 0)
  const totalProfit = profitByProject.reduce((s, p) => s + p.amount, 0)

  const expenseByProject = data.projects.map(p => ({
    project_id: p.project_id,
    name: p.name,
    share_percent: p.share_percent,
    amount: p.expense,
  })).filter(p => p.amount > 0)
  const totalExpense = expenseByProject.reduce((s, p) => s + p.amount, 0)

  const totalLoansGiven    = data.loansGiven.reduce((s, l) => s + l.outstanding, 0)
  const totalLoansReceived = data.loansReceived.reduce((s, l) => s + l.outstanding, 0)

  // Running balance — recomputed here so the page is self-contained
  const running = totalProfit - totalExpense + totalPaid + totalLoansGiven - totalLoansReceived

  return (
    <div className="page-enter">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-5 pt-14 pb-4 lg:pt-8">
        <Link to="/" className="text-xs text-brand-700 mb-2 inline-block">← Back to Portfolio</Link>
        <h1 className="text-2xl font-bold text-gray-900">Running Balance Explained</h1>
        <p className="text-sm text-gray-500 mt-1">
          Every transaction that contributes to your Portfolio number, broken down so you can cross-check.
        </p>
        {data.identity?.name && (
          <p className="text-[11px] text-gray-400 mt-2 font-mono">
            Showing breakdown for: <strong>{data.identity.name}</strong>
            {data.identity.email && <> · {data.identity.email}</>}
            {data.matchMode === 'loose-name-only' && (
              <span className="ml-2 text-amber-700">(matched by name — email not linked yet)</span>
            )}
          </p>
        )}
      </div>

      <div className="px-5 py-5 space-y-5 max-w-3xl mx-auto">

        {/* The Formula */}
        <div className="bg-brand-50 border border-brand-100 rounded-2xl p-4">
          <p className="text-[11px] font-semibold text-brand-900 uppercase tracking-wider mb-2">Formula</p>
          <pre className="text-[12px] text-brand-900 font-mono leading-relaxed whitespace-pre-wrap">
{`Running Balance = Cash you paid in
                + Profits credited to you
                − Your share of project expenses
                + Loans you GAVE (still owed back to you)
                − Loans you RECEIVED (still owed by you)`}
          </pre>
        </div>

        {/* Section: Cash Paid In — broken down by payment type per project */}
        <Section
          title="1. Cash you paid in (per project, by type)"
          subtotal={totalPaid}
          op="+"
          help="Every payment out of your wallet, separated by type so you can see exactly what each contribution was. Expenses you paid personally show in full here — your share of those is then subtracted in section 3, leaving the other investors' share as an implicit receivable."
        >
          {cashByProject.length === 0 && <RowEmpty text="No payments recorded." />}
          {cashByProject.map(p => (
            <ProjectCashCard key={p.project_id} p={p} />
          ))}
        </Section>

        {/* Callout: explain expense-paid → expense-share relationship */}
        {totalExpensesPaidByMe > 0 && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-[12px] text-emerald-900">
            <p className="font-semibold mb-2">💡 You paid project expenses out of your pocket</p>
            <p className="leading-relaxed">
              You paid <strong className="font-mono">{fmt(totalExpensesPaidByMe)}</strong> of project
              expenses personally. The full amount is counted in section 1 above (cash that left
              your wallet). Section 3 below subtracts only <strong>your share</strong> of those
              expenses — the rest (
              <strong className="font-mono text-fintech-green">{fmt(totalOthersShareReceivable)}</strong>
              ) is effectively owed back to you by the other investors via the project's books.
              Your Running Balance already credits you for it because:
            </p>
            <pre className="mt-2 font-mono text-[11px] bg-white/70 rounded-lg p-2 leading-snug whitespace-pre-wrap">
{`  Full expense you paid:                + ${fmt(totalExpensesPaidByMe)}  (in section 1)
  Less: your share of project expense:  − ${fmt(totalExpensesPaidByMe - totalOthersShareReceivable)}  (in section 3)
  ────────────────────────────────────────
  Net credit to your portfolio:         + ${fmt(totalOthersShareReceivable)}  (others' share, receivable)`}
            </pre>
          </div>
        )}

        {/* Section: Profits */}
        <Section
          title="2. Profits credited to you"
          subtotal={totalProfit}
          op="+"
          help="Your slice of every profit record on each project. Default split uses your share %; custom splits use the explicit per-investor amounts."
        >
          {profitByProject.length === 0 && <RowEmpty text="No profits credited yet." />}
          {profitByProject.map(p => (
            <Row key={p.project_id} primary={p.name} sub={`${p.share_percent}% share`} amount={p.amount} link={`/projects/${p.project_id}`} />
          ))}
        </Section>

        {/* Section: Expense Share */}
        <Section
          title="3. Your share of project expenses"
          subtotal={totalExpense}
          op="−"
          help="For each project expense, your absorbed share = expense × your share %. Whoever paid the expense from their pocket has it counted in section 1 already — this section subtracts what's truly your cost burden."
        >
          {expenseByProject.length === 0 && <RowEmpty text="No expenses to absorb." />}
          {expenseByProject.map(p => (
            <Row key={p.project_id} primary={p.name} sub={`${p.share_percent}% of project expenses`} amount={-p.amount} link={`/projects/${p.project_id}`} />
          ))}
        </Section>

        {/* Section: Loans Given (assets) */}
        <Section
          title="4. Loans you gave (receivables — assets)"
          subtotal={totalLoansGiven}
          op="+"
          help="Outstanding loans where you contributed money. The remaining balance = principal × (1 + interest %/100) minus what's already been repaid to you."
        >
          {data.loansGiven.length === 0 && <RowEmpty text="No outstanding loans given." />}
          {data.loansGiven.map(l => (
            <Row key={l.id} primary={`Loan to ${l.counterparty}`}
              sub={l.interest_pct > 0 ? `principal ${fmt(l.principal)} · ${l.interest_pct}% interest` : `principal ${fmt(l.principal)}`}
              amount={l.outstanding} />
          ))}
        </Section>

        {/* Section: Loans Received (liabilities) */}
        <Section
          title="5. Loans you received (payables — liabilities)"
          subtotal={totalLoansReceived}
          op="−"
          help="Outstanding loans where you borrowed money. Same formula as section 4 but works against you — money you still owe back."
        >
          {data.loansReceived.length === 0 && <RowEmpty text="No outstanding loans received." />}
          {data.loansReceived.map(l => (
            <Row key={l.id} primary={`Loan from ${l.counterparty}`}
              sub={l.interest_pct > 0 ? `principal ${fmt(l.principal)} · ${l.interest_pct}% interest` : `principal ${fmt(l.principal)}`}
              amount={-l.outstanding} />
          ))}
        </Section>

        {/* Final Running Balance */}
        <div className="bg-gray-900 text-white rounded-2xl p-5">
          <p className="text-xs uppercase tracking-wider text-gray-400 mb-2">Final Calculation</p>
          <table className="w-full text-sm">
            <tbody>
              <CalcRow label="Cash paid in"            value={totalPaid}              op="+" />
              <CalcRow label="Profits credited"        value={totalProfit}            op="+" />
              <CalcRow label="Your expense share"      value={totalExpense}           op="−" />
              <CalcRow label="Loans given outstanding" value={totalLoansGiven}        op="+" />
              <CalcRow label="Loans received outstanding" value={totalLoansReceived}  op="−" />
              <tr className="border-t border-gray-700">
                <td className="pt-3 font-bold">Running Balance</td>
                <td className="pt-3 text-right font-mono font-bold text-2xl text-fintech-green">
                  {fmt(running)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Cross-check helper */}
        <CrossCheck
          totalPaid={totalPaid}
          totalProfit={totalProfit}
          totalExpense={totalExpense}
          totalLoansReceived={totalLoansReceived}
          totalLoansGiven={totalLoansGiven}
          running={running}
        />

      </div>
    </div>
  )
}

// ── Section ───────────────────────────────────────────────
function Section({ title, subtotal, op, help, children }) {
  const colorClass = op === '+' ? 'text-fintech-green' : 'text-fintech-red'
  return (
    <section>
      <div className="flex items-baseline justify-between mb-2 px-1">
        <h2 className="text-sm font-bold text-gray-900">{title}</h2>
        <p className={`font-mono font-bold text-sm ${colorClass}`}>
          {op} {fmt(Math.abs(subtotal))}
        </p>
      </div>
      <p className="text-[11px] text-gray-500 mb-2 px-1">{help}</p>
      <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100 overflow-hidden">
        {children}
      </div>
    </section>
  )
}

// ── Project cash breakdown card (used in section 1) ──────
// Renders each project's payments grouped by type so the user can see
// "this came from a share contribution, this from paying an expense,
// this from a reallocation, etc." Header shows the project + net total;
// inner rows show only the non-zero buckets.
function ProjectCashCard({ p }) {
  const items = [
    { key: 'contrib',  label: 'Share contributions',           amount:  p.contribIn,        note: null },
    { key: 'topup',    label: 'Top-ups (external)',            amount:  p.topUpExternal,    note: null },
    { key: 'expense',  label: 'Expenses you paid personally',  amount:  p.expensePaidByMe,
      note: p.expensePaidByMe > 0
        ? `Of which ${fmt(p.expensePaidByMe * p.share_percent / 100)} is your fair share; ${fmt(p.othersShareOfMyExpenses)} is the others' share (a receivable).`
        : null },
    { key: 'movein',   label: 'Reallocations in (from another project)', amount:  p.moveIn,  note: null },
    { key: 'moveout',  label: 'Reallocations out (to another project)',  amount: -p.moveOut, note: null },
    { key: 'refund',   label: 'External refunds received',     amount: -p.refundExternal,   note: null },
  ].filter(it => Math.abs(it.amount) > 0.5)

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <Link to={`/projects/${p.project_id}`} className="font-semibold text-gray-900 text-sm hover:text-brand-700">
          {p.name}
          <span className="ml-2 text-[10px] font-medium text-gray-500">({p.share_percent}% share)</span>
        </Link>
        <span className={`font-mono font-bold text-sm ${p.amount >= 0 ? 'text-fintech-green' : 'text-fintech-red'}`}>
          {p.amount < 0 ? '− ' : '+ '}{fmt(Math.abs(p.amount))}
        </span>
      </div>
      <div className="space-y-1 pl-2 border-l-2 border-gray-100">
        {items.map(it => (
          <div key={it.key}>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-gray-600">{it.label}</span>
              <span className={`font-mono ${it.amount >= 0 ? 'text-gray-700' : 'text-fintech-red'}`}>
                {it.amount < 0 ? '− ' : '+ '}{fmt(Math.abs(it.amount))}
              </span>
            </div>
            {it.note && (
              <p className="text-[10px] text-emerald-700 bg-emerald-50/60 rounded px-2 py-1 mt-1 leading-snug">
                {it.note}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function Row({ primary, sub, amount, link }) {
  const colorClass = amount > 0 ? 'text-fintech-green' : amount < 0 ? 'text-fintech-red' : 'text-gray-500'
  const body = (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 truncate">{primary}</p>
        {sub && <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p>}
      </div>
      <p className={`font-mono font-semibold text-sm whitespace-nowrap ml-3 ${colorClass}`}>
        {amount < 0 ? '− ' : ''}{fmt(Math.abs(amount))}
      </p>
    </div>
  )
  if (link) return <Link to={link} className="block hover:bg-gray-50 transition-colors">{body}</Link>
  return body
}

function RowEmpty({ text }) {
  return <p className="px-4 py-3 text-[12px] text-gray-400 italic">{text}</p>
}

function CalcRow({ label, value, op }) {
  return (
    <tr>
      <td className="py-1 text-gray-300">
        <span className="inline-block w-4 text-center font-mono">{op}</span> {label}
      </td>
      <td className="py-1 text-right font-mono">{fmt(value)}</td>
    </tr>
  )
}

// ── Cross-check helper — checks user's mental model vs computed ──
//
// Lets the user paste in what they remember and the page diffs each
// line. Hard-coded with the values from the latest user query so
// Venkatesh can confirm immediately; anyone else gets a generic note.
function CrossCheck({ totalPaid, totalProfit, totalExpense, totalLoansReceived, totalLoansGiven, running }) {
  // User-provided figures from the question:
  //   Investment 23,80,000 + Kanchikacherla 8,00,000
  //   + Registration/house expense 2,85,000 + House 98,000 = 35,63,000
  //   Profits 10,50,000, Loan taken 4,80,000
  const claimed = {
    paid:     2380000 + 800000 + 285000 + 98000,    // = 35,63,000
    profit:   1050000,
    loanRecv: 480000,
  }
  const claimedRunningSimple = claimed.paid + claimed.profit - claimed.loanRecv  // = 41,33,000
  const claimedRunningWithExpense = claimedRunningSimple - totalExpense

  return (
    <section>
      <h2 className="text-sm font-bold text-gray-900 mb-2 px-1">Cross-check against your numbers</h2>
      <p className="text-[11px] text-gray-500 mb-3 px-1">
        Quick diff between what you said you paid / earned / owe and what's actually in the database.
      </p>
      <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100 overflow-hidden">
        <CheckRow
          label="Cash paid in (Investment + Kanchikacherla + Registration + House)"
          claimed={claimed.paid}
          actual={totalPaid}
          breakdown="2380000 + 800000 + 285000 + 98000 = 3563000"
        />
        <CheckRow
          label="Profits credited"
          claimed={claimed.profit}
          actual={totalProfit}
        />
        <CheckRow
          label="Loans received (outstanding)"
          claimed={claimed.loanRecv}
          actual={totalLoansReceived}
        />
        <CheckRow
          label="Your share of expenses absorbed (not in your figures)"
          claimed={null}
          actual={totalExpense}
          note="You didn't include this in your math, but the formula subtracts it. If you paid the full 2,85,000 Registration expense personally, your absorbed share is 2,85,000 × (your share %)/100."
        />
        <CheckRow
          label="Loans given (outstanding)"
          claimed={null}
          actual={totalLoansGiven}
          note="You didn't mention any loans you've given out. If this is 0, nothing changes."
        />
      </div>

      {/* Calculated using YOUR numbers */}
      <div className="mt-4 bg-amber-50 border border-amber-200 rounded-2xl p-4 text-[12px] text-amber-900">
        <p className="font-semibold mb-2">Using YOUR figures (ignoring expense share):</p>
        <p className="font-mono leading-relaxed whitespace-pre-wrap">
{`  ₹35,63,000  cash you paid in
+ ₹10,50,000  profits
− ₹ 4,80,000  loan you owe back
─────────────
= ${fmt(claimedRunningSimple)}  expected running balance`}
        </p>
        <p className="mt-3">
          Then if your expense share absorbed is <strong>{fmt(totalExpense)}</strong>, the correctly-computed running balance is{' '}
          <strong className="font-mono">{fmt(claimedRunningWithExpense)}</strong>.
        </p>
        <p className="mt-2">
          The DB-computed value above is <strong className="font-mono text-fintech-green">{fmt(running)}</strong>.
          {Math.abs(running - claimedRunningWithExpense) < 1
            ? ' ✓ matches your math exactly.'
            : Math.abs(running - claimedRunningSimple) < 1
              ? ' ✓ matches if expense share is ignored.'
              : ` Difference is ${fmt(running - claimedRunningWithExpense)} — check the per-line totals above to find the source.`}
        </p>
      </div>
    </section>
  )
}

function CheckRow({ label, claimed, actual, breakdown, note }) {
  const hasClaimed = claimed !== null && claimed !== undefined
  const diff = hasClaimed ? actual - claimed : 0
  const match = hasClaimed && Math.abs(diff) < 1
  return (
    <div className="px-4 py-3">
      <p className="text-sm font-medium text-gray-900">{label}</p>
      {breakdown && (
        <p className="text-[10px] text-gray-400 font-mono mt-0.5">{breakdown}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        {hasClaimed && (
          <span className="text-gray-600">
            You said: <span className="font-mono font-semibold">{fmt(claimed)}</span>
          </span>
        )}
        <span className="text-gray-600">
          DB actual: <span className="font-mono font-semibold">{fmt(actual)}</span>
        </span>
        {hasClaimed && (
          <span className={match ? 'text-fintech-green font-semibold' : 'text-fintech-red font-semibold'}>
            {match ? '✓ match' : `${diff >= 0 ? '+' : '−'} ${fmt(Math.abs(diff))} diff`}
          </span>
        )}
      </div>
      {note && <p className="text-[11px] text-amber-700 bg-amber-50 rounded-md px-2 py-1 mt-2">{note}</p>}
    </div>
  )
}
