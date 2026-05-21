// src/pages/CashFlow.jsx
import { useState } from 'react'
import { useCashFlow, useLoans, useProjects, useInvestors, createLoan, recordRepayment, markSettled } from '../hooks/useData'
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
  const [form, setForm]   = useState({ description: '', amount: '', counterparty: '', adjustment_date: isoDate(), from_project_id: '', to_project_id: '', interest_rate_percent: '' })
  const [contributions, setContributions] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  // Hook must always be called at top level — pass projectId (may be empty string → hook returns [])
  const investors = useInvestors(form.from_project_id || null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const isLoan = type === 'loan_given'
  const isAnyLoan = type === 'loan_given' || type === 'loan_received'
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
    setSaving(true); setError(null)
    try {
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

        <Field label={isLoan ? "Borrower Name" : "Description *"}>
          <input className="input" placeholder={isLoan ? "Person's name" : "Description"} value={form.counterparty || form.description}
            onChange={e => isLoan ? (set('counterparty', e.target.value), set('description', `Loan to ${e.target.value}`)) : set('description', e.target.value)} required />
        </Field>

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

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      await recordRepayment({ loanId: loan.id, amount: parseFloat(amount), type: repType, toProjectId: toProject || null, date, notes: notes || null })
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet open={true} onClose={onClose} title="Record Repayment">
      <div className="bg-amber-50 rounded-xl p-3 mb-4">
        <p className="text-xs text-amber-700 font-semibold">Loan to {loan.counterparty || loan.description}</p>
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
            This repayment covers ≈ {inr(principalPart)} principal + {inr(interestPart)} interest
          </p>
        )}
        {loanDetail?.contributions?.length > 0 && (
          <div className="mt-2 pt-2 border-t border-amber-200">
            <p className="text-[10px] text-amber-600 font-semibold mb-1">Will be distributed back to:</p>
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
          </div>
        )}
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Repayment Type</label>
          <div className="grid grid-cols-2 gap-2">
            {[{v:'cash',l:'Cash Received'},{v:'project_adjustment',l:'Into a Project'}].map(({v,l}) => (
              <button key={v} type="button" onClick={() => setRepType(v)}
                className={`px-3 py-2.5 rounded-xl border text-sm font-medium transition-all
                  ${repType===v ? 'border-brand-900 bg-brand-50 text-brand-900' : 'border-gray-200 text-gray-600'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <Field label={`Amount (₹) · max ${inr(outstanding)}`}>
          <input className="input" type="number" max={outstanding} placeholder="0" value={amount} onChange={e => setAmount(e.target.value)} required />
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
