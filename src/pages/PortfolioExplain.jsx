// src/pages/PortfolioExplain.jsx
//
// "Running Balance Explained" — uses the user's mental model:
//
//   For each project:
//     project_total = property_value × our_stake% + total_expenses_to_date
//     scaled_commitment = your_share% × project_total
//     paid_in = your share contributions + top-ups + expenses you paid − refunds
//     refund_due = max(0, paid_in − scaled_commitment)   (cash owed back to you)
//     owes       = max(0, scaled_commitment − paid_in)   (cash you still owe)
//     profit_credited = your profit distributions on this project
//
//     net_from_project = paid_in + profit_credited
//                       (already includes the over-paid amount as a refund)
//
//   Running Balance
//     = sum across projects of (paid_in + profit_credited)
//       + loans you gave (outstanding)
//       − loans you received (outstanding)
//
// This matches the cleaner accounting: expenses inflate the pool, the
// scaled commitment rises proportionally, and any overpayment is
// automatically refund-due (no separate "expense share absorbed" cost).
import { Link } from 'react-router-dom'
import { useMyPortfolio } from '../hooks/useData'
import { inr } from '../lib/supabase'
import { Spinner, Empty } from '../components/ui'

const fmt = (n) => inr(Math.round(Number(n || 0)))

export default function PortfolioExplain() {
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

  // ── Per-project totals
  const projects = data.projects.filter(p =>
    (p.invested ?? 0) !== 0 || (p.profit ?? 0) !== 0 || (p.scaledCommitment ?? 0) > 0
  )

  const totalPaid              = projects.reduce((s, p) => s + (p.invested ?? 0), 0)
  const totalProfit            = projects.reduce((s, p) => s + (p.profit ?? 0), 0)
  const totalScaledCommitment  = projects.reduce((s, p) => s + (p.scaledCommitment ?? 0), 0)
  const totalRefundDue         = projects.reduce((s, p) => s + (p.refundDue ?? 0), 0)
  const totalOwes              = projects.reduce((s, p) => s + (p.owes ?? 0), 0)

  const totalLoansGiven        = data.loansGiven.reduce((s, l) => s + l.outstanding, 0)
  const totalLoansReceived     = data.loansReceived.reduce((s, l) => s + l.outstanding, 0)

  // User's-model running balance — paid + profit, with loans on top
  const running = totalPaid + totalProfit + totalLoansGiven - totalLoansReceived

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

        {/* The Formula in user's mental model */}
        <div className="bg-brand-50 border border-brand-100 rounded-2xl p-4">
          <p className="text-[11px] font-semibold text-brand-900 uppercase tracking-wider mb-2">How this works</p>
          <pre className="text-[12px] text-brand-900 font-mono leading-relaxed whitespace-pre-wrap">
{`For each project:
  project_total      = property value + total expenses
  your commitment    = your share% × project_total
  you paid           = share contributions + top-ups + expenses you paid
                       − refunds received
  refund due / owes  = you_paid − your_commitment
                       (positive = refund coming, negative = still to pay)

Running Balance
  = sum across projects of (you_paid + your_profit_credited)
  + outstanding loans you GAVE (receivables)
  − outstanding loans you RECEIVED (payables)`}
          </pre>
        </div>

        {/* Section 1: Per-project breakdown */}
        <section>
          <div className="flex items-baseline justify-between mb-2 px-1">
            <h2 className="text-sm font-bold text-gray-900">1. Project-by-project breakdown</h2>
            <p className="text-[11px] text-gray-500">
              {projects.length} project{projects.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="space-y-3">
            {projects.length === 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-4 text-[12px] text-gray-400 italic">
                No project positions found.
              </div>
            )}
            {projects.map(p => <ProjectBreakdown key={p.project_id} p={p} />)}
          </div>
        </section>

        {/* Section 2: Loans given */}
        <Section
          title="2. Loans you gave (receivables — assets)"
          subtotal={totalLoansGiven}
          op="+"
          help="Outstanding loans where you contributed money. Remaining balance = principal × (1 + interest %/100) − repaid so far."
        >
          {data.loansGiven.length === 0 && <RowEmpty text="No outstanding loans given." />}
          {data.loansGiven.map(l => (
            <Row key={l.id}
              primary={`Loan to ${l.counterparty}`}
              sub={l.interest_pct > 0
                ? `principal ${fmt(l.principal)} · ${l.interest_pct}% interest`
                : `principal ${fmt(l.principal)}`}
              amount={l.outstanding} />
          ))}
        </Section>

        {/* Section 3: Loans received */}
        <Section
          title="3. Loans you received (payables — liabilities)"
          subtotal={totalLoansReceived}
          op="−"
          help="Outstanding loans where you borrowed money. Same formula but works against you."
        >
          {data.loansReceived.length === 0 && <RowEmpty text="No outstanding loans received." />}
          {data.loansReceived.map(l => (
            <Row key={l.id}
              primary={`Loan from ${l.counterparty}`}
              sub={l.interest_pct > 0
                ? `principal ${fmt(l.principal)} · ${l.interest_pct}% interest`
                : `principal ${fmt(l.principal)}`}
              amount={-l.outstanding} />
          ))}
        </Section>

        {/* Final Calculation */}
        <div className="bg-gray-900 text-white rounded-2xl p-5">
          <p className="text-xs uppercase tracking-wider text-gray-400 mb-2">Final Calculation</p>
          <table className="w-full text-sm">
            <tbody>
              <CalcRow label="Total cash you paid in (across all projects)" value={totalPaid}          op="+" />
              <CalcRow label="Total profits credited"                       value={totalProfit}        op="+" />
              <CalcRow label="Loans you gave (outstanding)"                 value={totalLoansGiven}    op="+" />
              <CalcRow label="Loans you received (outstanding)"             value={totalLoansReceived} op="−" />
              <tr className="border-t border-gray-700">
                <td className="pt-3 font-bold">Running Balance</td>
                <td className="pt-3 text-right font-mono font-bold text-2xl text-fintech-green">
                  {fmt(running)}
                </td>
              </tr>
            </tbody>
          </table>

          {(totalRefundDue > 0 || totalOwes > 0) && (
            <div className="mt-4 pt-4 border-t border-gray-700 text-[12px]">
              <p className="text-gray-400 mb-2">Settlement position across projects:</p>
              {totalRefundDue > 0 && (
                <p>
                  <span className="text-fintech-green font-mono font-semibold">+ {fmt(totalRefundDue)}</span>
                  <span className="text-gray-300 ml-2">refund due to you (you overpaid — already counted in "cash paid in" above; will come back as cash)</span>
                </p>
              )}
              {totalOwes > 0 && (
                <p className="mt-1">
                  <span className="text-fintech-red font-mono font-semibold">− {fmt(totalOwes)}</span>
                  <span className="text-gray-300 ml-2">you still owe to projects (future obligation — not yet subtracted from running balance)</span>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Cross-check helper using user's numbers */}
        <CrossCheck
          totalPaid={totalPaid}
          totalProfit={totalProfit}
          totalLoansGiven={totalLoansGiven}
          totalLoansReceived={totalLoansReceived}
          running={running}
        />

      </div>
    </div>
  )
}

// ── Per-project breakdown card ───────────────────────────
function ProjectBreakdown({ p }) {
  const paid           = p.invested ?? 0
  const profit         = p.profit ?? 0
  const projectTotal   = p.projectTotal ?? 0
  const scaledCommit   = p.scaledCommitment ?? 0
  const refundDue      = p.refundDue ?? 0
  const owes           = p.owes ?? 0
  const ourPool        = p.ourPool ?? 0
  const projExpenses   = p.projectExpenses ?? 0
  const sharePct       = p.share_percent ?? 0

  const items = [
    { key: 'contrib',  label: 'Share contributions',           amount:  p.contribIn        ?? 0 },
    { key: 'topup',    label: 'Top-ups (external)',            amount:  p.topUpExternal    ?? 0 },
    { key: 'expense',  label: 'Expenses you paid personally',  amount:  p.expensePaidByMe  ?? 0 },
    { key: 'movein',   label: 'Reallocations in',              amount:  p.moveIn           ?? 0 },
    { key: 'moveout',  label: 'Reallocations out',             amount: -(p.moveOut ?? 0) },
    { key: 'refund',   label: 'External refunds received',     amount: -(p.refundExternal ?? 0) },
  ].filter(it => Math.abs(it.amount) > 0.5)

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <Link to={`/projects/${p.project_id}`} className="font-semibold text-gray-900 text-sm hover:text-brand-700">
          {p.name}
          <span className="ml-2 text-[10px] font-medium text-gray-500">({sharePct}% share)</span>
        </Link>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
          refundDue > 0 ? 'bg-emerald-50 text-fintech-green' :
          owes > 0     ? 'bg-red-50 text-fintech-red' :
                         'bg-gray-100 text-gray-600'
        }`}>
          {refundDue > 0.5 ? `Refund due ${fmt(refundDue)}` :
           owes > 0.5     ? `You owe ${fmt(owes)}` :
                            'Settled'}
        </span>
      </div>

      {/* Project total math */}
      <div className="px-4 py-3 bg-blue-50/50 text-[12px] space-y-1.5 border-b border-gray-100">
        <p className="text-[10px] font-semibold text-blue-900 uppercase tracking-wider mb-1">Project total</p>
        <Line label="Property value (your pool)" value={ourPool} />
        <Line label="Total expenses to date"     value={projExpenses} prefix="+" />
        <Line label="Project total (revised pool)" value={projectTotal} bold prefix="=" />
        <div className="border-t border-blue-100 my-1" />
        <Line label={`Your scaled commitment (${sharePct}% × project total)`} value={scaledCommit} bold />
      </div>

      {/* Your payments */}
      <div className="px-4 py-3 text-[12px] space-y-1.5">
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">You paid (cash out of pocket)</p>
        {items.length === 0 && <p className="text-gray-400 italic">No payments recorded.</p>}
        {items.map(it => (
          <Line key={it.key} label={it.label} value={it.amount} prefix={it.amount >= 0 ? '+' : '−'} />
        ))}
        <div className="border-t border-gray-100 my-1" />
        <Line label="Total paid by you" value={paid} bold prefix="=" />
        {profit !== 0 && (
          <>
            <div className="border-t border-gray-100 my-1" />
            <Line label="Profit credited to you" value={profit} bold prefix="+" tone="green" />
          </>
        )}
      </div>

      {/* Settlement explanation */}
      <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 text-[11px] text-gray-600">
        <p>
          You paid <strong className="font-mono">{fmt(paid)}</strong> · Your commitment is
          {' '}<strong className="font-mono">{fmt(scaledCommit)}</strong>.
          {refundDue > 0.5 && (
            <> You overpaid by <strong className="font-mono text-fintech-green">{fmt(refundDue)}</strong> — that's coming back to you (the other investors' share of expenses you fronted).</>
          )}
          {owes > 0.5 && (
            <> You still owe <strong className="font-mono text-fintech-red">{fmt(owes)}</strong> to be fully funded.</>
          )}
          {refundDue < 0.5 && owes < 0.5 && (
            <> You're fully settled on this project.</>
          )}
        </p>
      </div>
    </div>
  )
}

// ── Generic line item with optional prefix and bold ──────
function Line({ label, value, prefix = '', bold = false, tone = 'gray' }) {
  const toneClass = tone === 'green' ? 'text-fintech-green'
                  : tone === 'red'   ? 'text-fintech-red'
                  : 'text-gray-900'
  return (
    <div className="flex items-baseline justify-between">
      <span className={`${bold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
        {prefix && <span className="mr-1 text-gray-400 font-mono w-3 inline-block">{prefix}</span>}
        {label}
      </span>
      <span className={`font-mono ${bold ? `font-bold ${toneClass}` : toneClass}`}>
        {fmt(value)}
      </span>
    </div>
  )
}

// ── Section (loans) ──────────────────────────────────────
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

function Row({ primary, sub, amount }) {
  const colorClass = amount > 0 ? 'text-fintech-green' : amount < 0 ? 'text-fintech-red' : 'text-gray-500'
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 truncate">{primary}</p>
        {sub && <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p>}
      </div>
      <p className={`font-mono font-semibold text-sm whitespace-nowrap ml-3 ${colorClass}`}>
        {amount < 0 ? '− ' : '+ '}{fmt(Math.abs(amount))}
      </p>
    </div>
  )
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

// ── Cross-check helper ─────────────────────────────────────
function CrossCheck({ totalPaid, totalProfit, totalLoansGiven, totalLoansReceived, running }) {
  // User-provided figures from the question of 2026-05-23:
  //   Investment 23,80,000 + Kanchikacherla 8,00,000
  //   + Registration/house expense 2,85,000 + House 98,000 = 35,63,000
  //   Profits 10,50,000, Loan taken 4,80,000
  const claimed = {
    paid:     2380000 + 800000 + 285000 + 98000,
    profit:   1050000,
    loanRecv: 480000,
  }
  const claimedRunning = claimed.paid + claimed.profit - claimed.loanRecv  // = 41,33,000

  return (
    <section>
      <h2 className="text-sm font-bold text-gray-900 mb-2 px-1">Cross-check against your stated figures</h2>
      <p className="text-[11px] text-gray-500 mb-3 px-1">
        Side-by-side diff between what you said you paid / earned / owe and what's actually in the database.
      </p>
      <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100 overflow-hidden">
        <CheckRow
          label="Cash paid in (across all projects)"
          claimed={claimed.paid}
          actual={totalPaid}
          breakdown="Investment 2380000 + Kanchikacherla 800000 + Registration 285000 + House 98000 = 3563000"
        />
        <CheckRow
          label="Profits credited"
          claimed={claimed.profit}
          actual={totalProfit}
        />
        <CheckRow
          label="Loans you received (outstanding)"
          claimed={claimed.loanRecv}
          actual={totalLoansReceived}
        />
        <CheckRow
          label="Loans you gave (outstanding)"
          claimed={null}
          actual={totalLoansGiven}
          note="Not in your figures — assumed zero unless data says otherwise."
        />
      </div>

      <div className="mt-4 bg-amber-50 border border-amber-200 rounded-2xl p-4 text-[12px] text-amber-900">
        <p className="font-semibold mb-2">Your math:</p>
        <pre className="font-mono leading-relaxed whitespace-pre-wrap">
{`+ ${fmt(claimed.paid)}  cash you paid in
+ ${fmt(claimed.profit)}  profits credited
− ${fmt(claimed.loanRecv)}  loan you owe back
─────────────────
= ${fmt(claimedRunning)}  expected running balance`}
        </pre>
        <p className="mt-3">
          DB-computed running balance: <strong className="font-mono text-fintech-green">{fmt(running)}</strong>
          {Math.abs(running - claimedRunning) < 1
            ? ' ✓ matches your math exactly.'
            : ` — diff of ${fmt(running - claimedRunning)}. Check the per-project breakdown above to find the source.`}
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
