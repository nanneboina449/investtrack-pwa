// src/pages/CashFlow.jsx
import { useState } from 'react'
import { useCashFlow, useLoans, useProjects, useInvestors, useAllInvestors, createLoan, recordRepayment, markSettled, reallocateInvestorPosition, updateLoan, updateCashAdjustment, deleteCashAdjustment } from '../hooks/useData'
import { supabase } from '../lib/supabase'
import { inr, isoDate } from '../lib/supabase'
import { Sheet, Field, SegControl, Spinner, Empty, ProgressBar, useToast } from '../components/ui'

const TYPES = [
  { value: 'loan_given',     label: 'Loan Given',     icon: '↗', debit: true },
  { value: 'loan_received',  label: 'Loan Received',  icon: '↙', debit: false },
  { value: 'deposit',        label: 'Deposit',        icon: '+', debit: false },
  { value: 'withdrawal',     label: 'Withdrawal',     icon: '−', debit: true },
  { value: 'reallocation',   label: 'Reallocation',   icon: '⇄', debit: false },
]

export default function CashFlow() {
  const cashflow  = useCashFlow()
  const loans     = useLoans()
  const projects  = useProjects()
  const { show, Toast } = useToast()

  const [tab, setTab]           = useState('all')
  const [showAdd, setShowAdd]   = useState(false)
  const [activeLoan, setActiveLoan] = useState(null)
  const [editingTx, setEditingTx]   = useState(null)

  // Compute net balance
  const net = cashflow.data.reduce((sum, a) => {
    if (a.type === 'deposit' || a.type === 'loan_received') return sum + a.amount
    if (a.type === 'withdrawal' || a.type === 'loan_given') return sum - a.amount
    return sum
  }, 0)

  const pending = cashflow.data.filter(a => ['loan_given','loan_received'].includes(a.type) && !a.is_settled)

  const filtered = tab === 'all'
    ? cashflow.data
    : tab === 'loans'
    ? cashflow.data.filter(a => ['loan_given','loan_received'].includes(a.type))
    : cashflow.data.filter(a => a.type === tab)

  const handleSettle = async (id) => {
    try { await markSettled(id); cashflow.reload(); loans.reload(); show('Marked as settled!') }
    catch (e) { show(e.message, 'error') }
  }

  return (
    <div className="page-enter">
      <Toast />

      {/* Balance banner */}
      <div className="bg-gradient-to-br from-purple-900 to-purple-700 text-white px-5 pt-14 pb-6">
        <p className="text-purple-200 text-sm mb-1">Net Cash Balance</p>
        <p className={`text-4xl font-bold mono mb-5 ${net < 0 ? 'text-red-300' : ''}`}>{inr(net)}</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/10 rounded-xl p-3">
            <p className="text-purple-200 text-xs mb-1">Loans Given (pending)</p>
            <p className="font-bold mono text-amber-300">{inr(pending.filter(p=>p.type==='loan_given').reduce((s,a)=>s+a.amount,0))}</p>
          </div>
          <div className="bg-white/10 rounded-xl p-3">
            <p className="text-purple-200 text-xs mb-1">Loans Received (pending)</p>
            <p className="font-bold mono text-emerald-300">{inr(pending.filter(p=>p.type==='loan_received').reduce((s,a)=>s+a.amount,0))}</p>
          </div>
        </div>
      </div>

      {/* Pending loans alert */}
      {pending.length > 0 && (
        <div className="px-4 mt-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Pending Loans</p>
          <div className="space-y-2">
            {pending.map(a => {
              const loanDetail = loans.data.find(l => l.id === a.id)
              return (
                <div key={a.id} className="card p-3 border-l-4 border-l-amber-400">
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm truncate">{a.counterparty || a.description}</p>
                      <p className="text-xs text-gray-400">{a.type === 'loan_given' ? 'Loan Given' : 'Loan Received'} · {new Date(a.adjustment_date).toLocaleDateString('en-IN')}
                        {loanDetail?.interest_rate_percent > 0 && (
                          <span className="ml-1 text-amber-700 font-semibold">· {loanDetail.interest_rate_percent}% int</span>
                        )}
                      </p>
                    </div>
                    <div className="text-right ml-3 flex-shrink-0">
                      <p className="font-bold mono text-sm">{inr(a.amount)}</p>
                      {loanDetail?.interest_rate_percent > 0 && (
                        <p className="text-[10px] text-amber-700">+ {inr(loanDetail.interest_amount ?? 0)} int</p>
                      )}
                      {loanDetail && loanDetail.total_repaid > 0 && (
                        <p className="text-xs text-emerald-600">{inr(loanDetail.total_repaid)} repaid</p>
                      )}
                    </div>
                  </div>
                  {loanDetail && loanDetail.total_repaid > 0 && (
                    <ProgressBar value={loanDetail.total_repaid} max={loanDetail.total_due_with_interest ?? loanDetail.total_loan_amount} color="bg-emerald-400" height="h-1.5" />
                  )}
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => setActiveLoan(a)} className="text-xs bg-blue-50 text-blue-700 font-semibold px-3 py-1.5 rounded-lg flex-1">
                      Record Repayment
                    </button>
                    <button onClick={() => setEditingTx(a)} className="text-xs bg-gray-100 text-gray-700 font-semibold px-3 py-1.5 rounded-lg">
                      ✎ Edit
                    </button>
                    <button onClick={() => handleSettle(a.id)} className="text-xs bg-emerald-50 text-emerald-700 font-semibold px-3 py-1.5 rounded-lg">
                      Settle ✓
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Filter + list */}
      <div className="px-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex gap-1.5 flex-wrap">
            {[{v:'all',l:'All'},{v:'loans',l:'Loans'},{v:'deposit',l:'Deposits'},{v:'reallocation',l:'Moves'}].map(({v,l}) => (
              <button key={v} onClick={() => setTab(v)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${tab===v ? 'bg-brand-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
                {l}
              </button>
            ))}
          </div>
          <button onClick={() => setShowAdd(true)} className="btn-primary text-xs px-3 py-2 flex-shrink-0">
            + Add
          </button>
        </div>

        {cashflow.loading ? <div className="flex justify-center py-10"><Spinner size="lg" /></div>
          : filtered.length === 0 ? <Empty icon="💸" title="No transactions" sub="Tap + Add to record one" />
          : (
            <div className="space-y-2 pb-4">
              {filtered.map(a => {
                const meta = TYPES.find(t => t.value === a.type)
                const loanDetail = loans.data.find(l => l.id === a.id)
                return (
                  <div key={a.id} className="card p-3.5">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0
                        ${meta?.debit ? 'bg-red-50 text-red-600' : a.type==='reallocation' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}>
                        {meta?.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-gray-900 truncate">{a.description}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-xs text-gray-400">{meta?.label}</p>
                          {a.counterparty && <p className="text-xs text-gray-400">· {a.counterparty}</p>}
                          {a.is_settled && <span className="text-xs bg-emerald-50 text-emerald-700 font-semibold px-1.5 py-0.5 rounded">settled</span>}
                        </div>
                        <p className="text-[10px] text-gray-300 mt-0.5">{new Date(a.adjustment_date).toLocaleDateString('en-IN')}</p>
                      </div>
                      <p className={`font-bold mono text-sm flex-shrink-0 ${meta?.debit ? 'text-red-600' : a.type==='reallocation' ? 'text-blue-600' : 'text-emerald-600'}`}>
                        {meta?.debit ? '−' : a.type==='reallocation' ? '±' : '+'}{inr(a.amount)}
                      </p>
                      <button onClick={() => setEditingTx(a)} className="text-gray-300 hover:text-gray-600 text-xs ml-2 flex-shrink-0">✎</button>
                    </div>
                    {/* Loan contributions summary */}
                    {loanDetail?.contributions && loanDetail.contributions.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-50">
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Funded by</p>
                        <div className="flex flex-wrap gap-1.5">
                          {loanDetail.contributions.map((c, i) => (
                            <span key={i} className="text-xs bg-gray-50 text-gray-600 px-2 py-0.5 rounded-lg">
                              {c.investor_name} · {inr(c.amount)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
      </div>

      {/* Add transaction sheet */}
      <AddTransactionSheet
        open={showAdd}
        onClose={() => setShowAdd(false)}
        projects={projects.data}
        onSaved={() => { setShowAdd(false); cashflow.reload(); loans.reload(); show('Transaction recorded!') }}
      />

      {/* Edit transaction sheet */}
      {editingTx && (
        <EditTransactionSheet
          tx={editingTx}
          onClose={() => setEditingTx(null)}
          onSaved={() => { setEditingTx(null); cashflow.reload(); loans.reload(); show('Transaction updated') }}
        />
      )}

      {/* Record repayment sheet */}
      {activeLoan && (
        <RepaymentSheet
          loan={activeLoan}
          loanDetail={loans.data.find(l => l.id === activeLoan.id)}
          projects={projects.data}
          onClose={() => setActiveLoan(null)}
          onSaved={() => { setActiveLoan(null); cashflow.reload(); loans.reload(); show('Repayment recorded!') }}
        />
      )}
    </div>
  )
}

// ── Add Transaction Sheet ──────────────────────────────────────
function AddTransactionSheet({ open, onClose, projects, onSaved }) {
  const [type, setType]   = useState('loan_given')
  const [form, setForm]   = useState({ description: '', amount: '', counterparty: '', adjustment_date: isoDate(), from_project_id: '', to_project_id: '', interest_rate_percent: '', from_investor_id: '' })
  const [contributions, setContributions] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  // Hook must always be called at top level — pass projectId (may be empty string → hook returns [])
  const investors = useInvestors(form.from_project_id || null)
  const allInvestorsHook = useAllInvestors()

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const isLoan = type === 'loan_given'
  const isAnyLoan = type === 'loan_given' || type === 'loan_received'
  const isReallocation = type === 'reallocation'
  const principal = parseFloat(form.amount) || 0
  const interestPct = parseFloat(form.interest_rate_percent) || 0
  const interestAmt = principal * interestPct / 100
  const totalDue = principal + interestAmt

  // Auto-fill contributions proportionally when amount or project changes
  const autoFillContributions = (amount, invs) => {
    const total = parseFloat(amount) || 0
    setContributions(invs.map(inv => ({
      investor_id:   inv.investor_id,
      investor_name: inv.investor_name,
      project_id:    form.from_project_id,
      amount:        Math.round(total * inv.share_percent / 100)
    })))
  }

  const updateContrib = (idx, val) => {
    setContributions(prev => prev.map((c, i) => i === idx ? { ...c, amount: parseFloat(val) || 0 } : c))
  }

  const totalContrib = contributions.reduce((s, c) => s + (c.amount || 0), 0)
  const loanAmount   = parseFloat(form.amount) || 0
  const contribMatch = Math.abs(totalContrib - loanAmount) < 1

  const submit = async (e) => {
    e.preventDefault()
    if (isLoan && form.from_project_id && !contribMatch) { setError('Contributions must sum to loan amount'); return }
    if (isReallocation) {
      if (!form.from_investor_id) { setError('Pick the investor whose money is being reallocated'); return }
      if (!form.to_project_id)    { setError('Pick the destination project'); return }
      if (loanAmount <= 0)        { setError('Amount must be positive'); return }
    }
    setSaving(true); setError(null)
    try {
      if (isReallocation) {
        // Master Audit Phase C — Item 3: the RPC no longer accepts a
        // null destination investor (no name-string fallback). Resolve
        // the destination investor UUID up front by matching the
        // source investor's name to one on the destination project.
        // The destination dropdown above is already filtered to projects
        // where this person exists, so the match should always succeed —
        // but we hard-error here too if it doesn't.
        const normalize = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')
        const srcInvestorName = investors.data.find(i => i.investor_id === form.from_investor_id)?.investor_name
        const srcKey  = normalize(srcInvestorName)
        const destInvestor = (allInvestorsHook.data ?? []).find(
          i => i.project_id === form.to_project_id && normalize(i.name) === srcKey
        )
        if (!destInvestor) {
          throw new Error(`No investor named "${srcInvestorName}" on the destination project. Add them there first.`)
        }
        // Run the atomic linked refund + top-up; also drop a marker row
        // on cash_adjustments so the reallocation appears in the timeline.
        await reallocateInvestorPosition({
          sourceInvestorId: form.from_investor_id,
          destProjectId:    form.to_project_id,
          destInvestorId:   destInvestor.id,
          amount:           loanAmount,
          date:             form.adjustment_date,
          notes:            form.description || null,
        })
        const { supabase } = await import('../lib/supabase')
        const { data: { user } } = await supabase.auth.getUser()
        const invName = investors.data.find(i => i.investor_id === form.from_investor_id)?.investor_name
        const destName = projects.find(p => p.id === form.to_project_id)?.name
        const srcName  = projects.find(p => p.id === form.from_project_id)?.name
        const auto = `Reallocation: ${invName ?? 'Investor'} · ${srcName ?? 'source'} → ${destName ?? 'destination'}`
        const { error } = await supabase.from('cash_adjustments').insert({
          user_id:         user.id,
          type:            'reallocation',
          description:     form.description || auto,
          amount:          loanAmount,
          counterparty:    invName ?? null,
          adjustment_date: form.adjustment_date,
          from_project_id: form.from_project_id || null,
          to_project_id:   form.to_project_id  || null,
        })
        if (error) throw error
      } else {
        const adj = {
          type,
          description:           form.description,
          amount:                loanAmount,
          counterparty:          form.counterparty || null,
          adjustment_date:       form.adjustment_date,
          from_project_id:       form.from_project_id || null,
          to_project_id:         form.to_project_id || null,
          interest_rate_percent: isAnyLoan ? interestPct : 0,
        }
        if (isLoan && contributions.length > 0) {
          await createLoan({ adjustment: adj, contributions })
        } else {
          const { supabase } = await import('../lib/supabase')
          const { data: { user } } = await supabase.auth.getUser()
          const { error } = await supabase.from('cash_adjustments').insert({ ...adj, user_id: user.id })
          if (error) throw error
        }
      }
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add Transaction">
      <form onSubmit={submit} className="space-y-4">
        {/* Type selector */}
        <div>
          <label className="label">Transaction Type</label>
          <div className="grid grid-cols-2 gap-2">
            {TYPES.map(t => (
              <button key={t.value} type="button" onClick={() => setType(t.value)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all
                  ${type === t.value ? 'border-brand-900 bg-brand-50 text-brand-900' : 'border-gray-200 text-gray-600'}`}>
                <span>{t.icon}</span>{t.label}
              </button>
            ))}
          </div>
        </div>

        {isReallocation ? (
          <>
            <Field label="From Project *">
              <select className="input" value={form.from_project_id} onChange={e => { set('from_project_id', e.target.value); set('from_investor_id', '') }}>
                <option value="">Pick source project</option>
                {projects.filter(p => p.status !== 'completed' || true).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            {form.from_project_id && (
              <Field label="From Investor *">
                <select className="input" value={form.from_investor_id} onChange={e => set('from_investor_id', e.target.value)}>
                  <option value="">Pick investor</option>
                  {investors.data.map(i => (
                    <option key={i.investor_id} value={i.investor_id}>
                      {i.investor_name} ({i.share_percent}%)
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="To Project *">
              {(() => {
                const normalize = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')
                const fromInv = investors.data.find(i => i.investor_id === form.from_investor_id)
                const fromKey = normalize(fromInv?.investor_name)
                const validDests = form.from_investor_id
                  ? projects.filter(p =>
                      p.id !== form.from_project_id &&
                      (allInvestorsHook.data ?? []).some(i =>
                        i.project_id === p.id && normalize(i.name) === fromKey
                      ))
                  : []
                return (
                  <>
                    <select className="input" value={form.to_project_id}
                      onChange={e => set('to_project_id', e.target.value)}
                      disabled={!form.from_investor_id || validDests.length === 0}>
                      <option value="">
                        {!form.from_investor_id
                          ? 'Pick the investor first'
                          : validDests.length === 0
                          ? `No other project has ${fromInv?.investor_name ?? 'this investor'}`
                          : 'Pick destination project'}
                      </option>
                      {validDests.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    {form.from_investor_id && validDests.length === 0 && (
                      <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5 mt-2">
                        Only projects where {fromInv?.investor_name} already exists are listed. Add them as an investor on the destination project first.
                      </p>
                    )}
                  </>
                )
              })()}
            </Field>
            <Field label="Notes">
              <input className="input" placeholder="e.g. Profit + capital from Project A" value={form.description}
                onChange={e => set('description', e.target.value)} />
              <p className="text-[10px] text-gray-400 mt-1">
                Creates a refund on the source project and a top-up on the destination — both linked.
              </p>
            </Field>
          </>
        ) : (
          <Field label={
            type === 'loan_given'    ? 'Borrower Name'
            : type === 'loan_received' ? 'Lender Name'
            : 'Description *'
          }>
            <input className="input"
              placeholder={isAnyLoan ? "Person or organization's name" : 'Description'}
              value={isAnyLoan ? form.counterparty : form.description}
              onChange={e => {
                if (type === 'loan_given')    { set('counterparty', e.target.value); set('description', `Loan to ${e.target.value}`) }
                else if (type === 'loan_received') { set('counterparty', e.target.value); set('description', `Loan from ${e.target.value}`) }
                else                          { set('description', e.target.value) }
              }} required />
          </Field>
        )}

        <Field label="Amount (₹) *">
          <input className="input" type="number" placeholder="0" value={form.amount}
            onChange={e => { set('amount', e.target.value); if (isLoan && investors.data.length) autoFillContributions(e.target.value, investors.data) }} required />
        </Field>

        {isAnyLoan && (
          <Field label="Interest Rate (flat %)">
            <input className="input" type="number" step="0.01" min="0" max="100" placeholder="0"
              value={form.interest_rate_percent}
              onChange={e => set('interest_rate_percent', e.target.value)} />
            {principal > 0 && interestPct > 0 && (
              <p className="text-[10px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5 mt-1">
                {type === 'loan_given' ? 'Total due back' : 'Total to repay'}: {inr(totalDue)} ({inr(principal)} principal + {inr(interestAmt)} interest)
              </p>
            )}
          </Field>
        )}

        {isLoan && (
          <Field label="Funding Source Project">
            <select className="input" value={form.from_project_id}
              onChange={e => { set('from_project_id', e.target.value); if (e.target.value && form.amount) setTimeout(() => autoFillContributions(form.amount, investors.data), 300) }}>
              <option value="">Personal funds</option>
              {projects.filter(p=>p.status==='active').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}

        {/* Investor contributions */}
        {isLoan && form.from_project_id && investors.data.length > 0 && (
          <div>
            <label className="label">Investor Contributions</label>
            <div className="space-y-2">
              {contributions.map((c, i) => (
                <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                  <span className="text-sm text-gray-700 flex-1">{c.investor_name}</span>
                  <span className="text-gray-400 text-sm">₹</span>
                  <input type="number" className="w-28 bg-white border border-gray-200 rounded-lg px-2 py-1 text-sm text-right font-mono"
                    value={c.amount} onChange={e => updateContrib(i, e.target.value)} />
                </div>
              ))}
              <div className={`flex justify-between text-xs px-1 font-semibold ${contribMatch ? 'text-emerald-600' : 'text-red-500'}`}>
                <span>Total contributed</span>
                <span>{inr(totalContrib)} / {inr(loanAmount)} {contribMatch ? '✓' : '✗'}</span>
              </div>
            </div>
          </div>
        )}

        <Field label="Date">
          <input className="input" type="date" value={form.adjustment_date} onChange={e => set('adjustment_date', e.target.value)} />
        </Field>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save Transaction'}</button>
      </form>
    </Sheet>
  )
}

// ── Edit Transaction Sheet ────────────────────────────────────
function EditTransactionSheet({ tx, onClose, onSaved }) {
  const isLoan = tx.type === 'loan_given' || tx.type === 'loan_received'
  const [form, setForm] = useState({
    description:           tx.description ?? '',
    counterparty:          tx.counterparty ?? '',
    amount:                tx.amount ?? '',
    interest_rate_percent: tx.interest_rate_percent ?? '',
    adjustment_date:       tx.adjustment_date ?? isoDate(),
  })
  const [saving, setSaving]     = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError]       = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    setSaving(true); setError(null)
    try {
      const payload = {
        description:     form.description,
        counterparty:    form.counterparty || null,
        amount:          parseFloat(form.amount),
        adjustment_date: form.adjustment_date,
      }
      if (isLoan) {
        payload.interest_rate_percent = parseFloat(form.interest_rate_percent) || 0
        await updateLoan(tx.id, payload)
      } else {
        await updateCashAdjustment(tx.id, payload)
      }
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const handleDelete = async () => {
    const label = tx.type === 'loan_given' ? 'loan'
      : tx.type === 'loan_received' ? 'loan'
      : tx.type === 'reallocation' ? 'reallocation'
      : 'transaction'
    if (!confirm(
      `Delete this ${label}?` +
      (isLoan ? '\n\nAll contributions and repayments cascade. For inter-investor loans, the paired refund + top-up payment rows will also be removed.' : '')
    )) return
    setDeleting(true); setError(null)
    try {
      await deleteCashAdjustment(tx.id)
      onSaved()
    } catch (e) { setError(e.message); setDeleting(false) }
  }

  return (
    <Sheet open={true} onClose={onClose}
      title={`Edit ${tx.type === 'loan_given' ? 'Loan Given' : tx.type === 'loan_received' ? 'Loan Received' : tx.type === 'reallocation' ? 'Reallocation' : 'Transaction'}`}
      footer={
        <div className="space-y-2">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <button type="button" onClick={submit} className="btn-primary w-full" disabled={saving || deleting}>{saving ? 'Saving…' : 'Save Changes'}</button>
          <button type="button" onClick={handleDelete}
            className="w-full text-sm font-semibold text-red-600 bg-red-50 rounded-xl py-2.5 active:scale-95 transition-transform disabled:opacity-50"
            disabled={saving || deleting}>
            {deleting ? 'Deleting…' : '🗑 Delete'}
          </button>
        </div>
      }>
      <div className="space-y-4">
        {isLoan && (
          <Field label={tx.type === 'loan_given' ? 'Borrower Name' : 'Lender Name'}>
            <input className="input" value={form.counterparty} onChange={e => set('counterparty', e.target.value)} />
          </Field>
        )}
        <Field label="Description">
          <input className="input" value={form.description} onChange={e => set('description', e.target.value)} />
        </Field>
        <Field label="Amount (₹) *">
          <input className="input" type="number" value={form.amount} onChange={e => set('amount', e.target.value)} />
          {isLoan && <p className="text-[10px] text-amber-600 mt-1">Editing principal does NOT redistribute existing contributions or repayments.</p>}
        </Field>
        {isLoan && (
          <Field label="Interest Rate (flat %)">
            <input className="input" type="number" step="0.01" value={form.interest_rate_percent} onChange={e => set('interest_rate_percent', e.target.value)} />
          </Field>
        )}
        <Field label="Date">
          <input className="input" type="date" value={form.adjustment_date} onChange={e => set('adjustment_date', e.target.value)} />
        </Field>
        {tx.type === 'reallocation' && (
          <p className="text-[10px] text-amber-600 bg-amber-50 rounded-lg p-2">
            This edits the cash-flow summary row only. The linked refund/top-up on the investor payment ledger is edited separately — open the source project&apos;s Payments tab.
          </p>
        )}
      </div>
    </Sheet>
  )
}

// ── Repayment Sheet ───────────────────────────────────────────
function RepaymentSheet({ loan, loanDetail, projects, onClose, onSaved }) {
  const [repType, setRepType] = useState('cash')
  const [amount, setAmount]   = useState('')
  const [toProject, setToProject] = useState('')
  const [date, setDate]       = useState(isoDate())
  const [notes, setNotes]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)

  const outstanding   = loanDetail?.outstanding_balance ?? loan.amount
  const interestRate  = loanDetail?.interest_rate_percent ?? 0
  const interestAmt   = loanDetail?.interest_amount ?? 0
  const totalDue      = loanDetail?.total_due_with_interest ?? loan.amount
  const repaidNow     = parseFloat(amount) || 0
  // Pro-rata split of this repayment into principal vs interest
  const principalPart = totalDue > 0 ? repaidNow * loan.amount / totalDue : repaidNow
  const interestPart  = repaidNow - principalPart
  const isReceived    = loan.type === 'loan_received'
  const headerVerb    = isReceived ? 'Loan from' : 'Loan to'

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      // Audit Phase B: for project_adjustment repayments, pre-resolve
      // the contributor → destination-investor UUID map so the RPC
      // doesn't fall back to name matching. loanDetail.contributions
      // (from loan_summary view) carries names but not ids, so refetch
      // loan_contributions directly to get the contributor UUIDs.
      let destInvestorMap = null
      if (repType === 'project_adjustment' && toProject) {
        const [{ data: contribs }, { data: destInvs }] = await Promise.all([
          supabase.from('loan_contributions').select('investor_id, investor_name').eq('loan_id', loan.id),
          supabase.from('investors').select('id, name').eq('project_id', toProject),
        ])
        const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')
        if (contribs && destInvs) {
          destInvestorMap = contribs.map(c => {
            const match = destInvs.find(d => norm(d.name) === norm(c.investor_name))
            return match
              ? { contributor_id: c.investor_id, dest_investor_id: match.id }
              : null
          }).filter(Boolean)
        }
      }
      await recordRepayment({
        loanId: loan.id, amount: parseFloat(amount), type: repType,
        toProjectId: toProject || null, date, notes: notes || null,
        destInvestorMap,
      })
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet open={true} onClose={onClose} title={isReceived ? 'Record Payment to Lender' : 'Record Repayment'}>
      <div className="bg-amber-50 rounded-xl p-3 mb-4">
        <p className="text-xs text-amber-700 font-semibold">{headerVerb} {loan.counterparty || loan.description}</p>
        <div className="flex justify-between mt-1">
          <p className="text-sm text-amber-900 font-bold mono">
            {inr(loan.amount)}
            {interestRate > 0 && <span className="text-amber-700 font-normal text-xs"> + {inr(interestAmt)} int = {inr(totalDue)}</span>}
          </p>
          <p className="text-sm text-amber-700 mono">Outstanding: {inr(outstanding)}</p>
        </div>
        {loanDetail && <ProgressBar value={loanDetail.total_repaid ?? 0} max={totalDue} color="bg-amber-400" height="h-1.5" />}
        {repaidNow > 0 && interestRate > 0 && (
          <p className="text-[10px] text-amber-600 mt-2">
            This {isReceived ? 'payment' : 'repayment'} covers ≈ {inr(principalPart)} principal + {inr(interestPart)} interest
          </p>
        )}
        {!isReceived && loanDetail?.contributions?.length > 0 && (
          <div className="mt-2 pt-2 border-t border-amber-200">
            <p className="text-[10px] text-amber-600 font-semibold mb-1">
              {repType === 'project_adjustment' && toProject
                ? 'Will credit these contributors on the destination project:'
                : 'Will be distributed back to:'}
            </p>
            {loanDetail.contributions.map((c, i) => {
              const share  = loanDetail.contributions.reduce((s,x)=>s+x.amount,0)
              const back   = share > 0 ? Math.round(repaidNow * c.amount / share) : 0
              const finalReturn = share > 0 ? Math.round(c.amount * (1 + interestRate / 100)) : c.amount
              return (
                <div key={i} className="flex justify-between text-xs text-amber-700">
                  <span>
                    {c.investor_name} (contrib {inr(c.amount)}{interestRate > 0 ? ` → expects ${inr(finalReturn)}` : ''})
                  </span>
                  <span className="font-semibold mono">{back > 0 ? `+${inr(back)}` : '—'}</span>
                </div>
              )
            })}
            {repType === 'project_adjustment' && toProject && (
              <p className="text-[10px] text-amber-600 mt-2 italic">
                A top-up payment is auto-created per contributor on the destination project (matched by name). Contributors who aren&apos;t investors there are skipped — add them first if needed.
              </p>
            )}
          </div>
        )}
        {isReceived && (
          <div className="mt-2 pt-2 border-t border-amber-200">
            <p className="text-[10px] text-amber-600 font-semibold mb-1">Lender receives this from project funds</p>
            {interestRate > 0 && (
              <p className="text-[10px] text-amber-700">
                Over the life of the loan: pay back {inr(loan.amount)} principal + {inr(interestAmt)} interest = {inr(totalDue)} total
              </p>
            )}
          </div>
        )}
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">{isReceived ? 'Payment Source' : 'Repayment Type'}</label>
          <div className="grid grid-cols-2 gap-2">
            {(isReceived
              ? [{v:'cash',l:'Cash Paid'},{v:'project_adjustment',l:'From a Project'}]
              : [{v:'cash',l:'Cash Received'},{v:'project_adjustment',l:'Into a Project'}]
            ).map(({v,l}) => (
              <button key={v} type="button" onClick={() => setRepType(v)}
                className={`px-3 py-2.5 rounded-xl border text-sm font-medium transition-all
                  ${repType===v ? 'border-brand-900 bg-brand-50 text-brand-900' : 'border-gray-200 text-gray-600'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <Field label={`Amount (₹) · max ${inr(outstanding)}`}>
          <input className="input" type="number" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)} required />
          {repaidNow > outstanding + 0.5 && (
            <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5 mt-1.5">
              ⚠ Repayment exceeds outstanding by {inr(repaidNow - outstanding)}. The loan will auto-settle but the
              outstanding balance will go negative. Use Edit on the loan card if this was a typo.
            </p>
          )}
        </Field>

        {repType === 'project_adjustment' && (
          <Field label="Move into Project">
            <select className="input" value={toProject} onChange={e => setToProject(e.target.value)} required>
              <option value="">Select project</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}

        <Field label="Date">
          <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
        </Field>

        <Field label="Notes">
          <input className="input" placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} />
        </Field>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Recording…' : 'Record Repayment'}</button>
      </form>
    </Sheet>
  )
}
