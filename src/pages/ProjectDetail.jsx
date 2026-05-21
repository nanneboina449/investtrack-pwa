// src/pages/ProjectDetail.jsx
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  useInvestors, useInvestorBalances, useProfitRecords, useExpenses, useInvestorPayments,
  createInvestor, deleteInvestor, createProfitRecord, deleteProfitRecord,
  createExpense, deleteExpense, createPayment, deletePayment,
  updateProject, deleteProject
} from '../hooks/useData'
import { useMyRole } from '../hooks/useSharing'
import { inr, pct, isoDate, supabase } from '../lib/supabase'
import { Sheet, Field, ShareBar, ProgressBar, SegControl, Spinner, Empty, useToast, Collapsible } from '../components/ui'
import ShareModal from '../components/ShareModal'

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState('investors')
  const { show, Toast } = useToast()
  const [showShare, setShowShare] = useState(false)
  const [showMenu, setShowMenu]   = useState(false)
  const [showEdit, setShowEdit]   = useState(false)

  const investors = useInvestors(id)
  const balances  = useInvestorBalances(id)
  const profits   = useProfitRecords(id)
  const expenses  = useExpenses(id)
  const payments  = useInvestorPayments(id)

  const [showAddInv, setShowAddInv]         = useState(false)
  const [showAddProfit, setShowAddProfit]   = useState(false)
  const [showAddExpense, setShowAddExpense] = useState(false)
  const [showAddPayment, setShowAddPayment] = useState(false)

  // Determine current user's role
  const [project, setProject] = useState(null)
  useState(() => {
    supabase.from('my_projects').select('*').eq('id', id).single()
      .then(({ data }) => setProject(data))
  })
  const { isOwner, canEdit } = useMyRole(id, project?.is_owner)

  const totalShare  = investors.data.reduce((s, i) => s + (i.share_percent ?? 0), 0)
  const totalProfit   = profits.data.reduce((s, p) => s + (p.amount ?? 0), 0)
  const totalExpenses = expenses.data.reduce((s, e) => s + (e.amount ?? 0), 0)
  const netReturn     = totalProfit - totalExpenses
  const projectName  = project?.name ?? investors.data[0]?.project_name ?? 'Project'
  const projectTotalValue = project?.total_value ?? investors.data[0]?.total_value ?? 0
  const stakePercent = project?.our_stake_percent ?? 100
  const projectValue = Math.round(projectTotalValue * stakePercent / 100)

  const handleDeleteInvestor = async (invId) => {
    if (!confirm('Remove this investor?')) return
    try { await deleteInvestor(invId); investors.reload(); show('Investor removed') }
    catch (e) { show(e.message, 'error') }
  }

  const handleDeleteExpense = async (eid) => {
    if (!confirm('Delete this expense?')) return
    try { await deleteExpense(eid); expenses.reload(); investors.reload(); show('Expense deleted') }
    catch (e) { show(e.message, 'error') }
  }

  const handleDeleteProfit = async (pid) => {
    if (!confirm('Delete this profit record?')) return
    try { await deleteProfitRecord(pid); profits.reload(); show('Profit record deleted') }
    catch (e) { show(e.message, 'error') }
  }

  const handleDeletePayment = async (pid) => {
    if (!confirm('Delete this payment? This will not delete any linked expense.')) return
    try { await deletePayment(pid); payments.reload(); investors.reload(); balances.reload(); show('Payment deleted') }
    catch (e) { show(e.message, 'error') }
  }

  return (
    <div className="page-enter">
      <Toast />

      {/* Header */}
      <div className="bg-brand-900 text-white px-5 pt-12 pb-5">
        <div className="flex justify-between items-center mb-3">
          <button onClick={() => navigate(-1)} className="text-brand-100 text-sm flex items-center gap-1">← Back</button>
          {isOwner && (
            <div className="relative">
              <button onClick={() => setShowMenu(!showMenu)}
                className="flex items-center gap-1 text-sm font-semibold bg-white/15 px-3 py-1.5 rounded-xl active:scale-95 transition-transform">
                ⋯ More
              </button>
              {showMenu && (
                <div className="absolute right-0 top-10 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 min-w-[160px] overflow-hidden">
                  <button onClick={() => { setShowEdit(true); setShowMenu(false) }}
                    className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                    ✏️ Edit Project
                  </button>
                  <button onClick={() => { setShowShare(true); setShowMenu(false) }}
                    className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                    👥 Share
                  </button>
                  <button onClick={async () => {
                    setShowMenu(false)
                    if (!confirm('Delete this project? This cannot be undone.')) return
                    try { await deleteProject(id); navigate('/projects') }
                    catch (e) { show(e.message, 'error') }
                  }} className="w-full text-left px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-gray-100">
                    🗑️ Delete Project
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <h1 className="text-xl font-bold mb-4">{projectName}</h1>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white/10 rounded-xl p-2.5 text-center">
            <p className="text-brand-100 text-[10px] mb-0.5">Property Value</p>
            <p className="font-bold mono text-xs">{inr(projectValue)}</p>
          </div>
          <div className="bg-white/10 rounded-xl p-2.5 text-center">
            <p className="text-brand-100 text-[10px] mb-0.5">Net Return</p>
            <p className={`font-bold mono text-xs ${netReturn >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{inr(netReturn)}</p>
            {totalExpenses > 0 && <p className='text-[9px] text-white/60 mt-0.5'>-{inr(totalExpenses)} exp</p>}
          </div>
          <div className="bg-white/10 rounded-xl p-2.5 text-center">
            <p className="text-brand-100 text-[10px] mb-0.5">Share Filled</p>
            <p className={`font-bold text-xs ${totalShare >= 100 ? 'text-emerald-300' : 'text-amber-300'}`}>{totalShare.toFixed(1)}%</p>
          </div>
        </div>
      </div>

      {/* Role badge for non-owners */}
      {!isOwner && project && (
        <div className="mx-4 mt-3">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-50 text-purple-700">
            Your role: {project.my_role}
          </span>
        </div>
      )}

      {/* Share bar */}
      {investors.data.length > 0 && (
        <div className="mx-4 mt-4 card p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Share Allocation</p>
          <ShareBar investors={investors.data} />
        </div>
      )}

      {/* Tabs */}
      <div className="px-4 mt-4">
        <SegControl value={tab} onChange={setTab} options={[
          { value: 'investors', label: `Investors (${investors.data.length})` },
          { value: 'payments',  label: `Payments (${payments.data.length})` },
          { value: 'profits',   label: 'Profit History' },
          { value: 'expenses',  label: `Expenses (${expenses.data.length})` },
          { value: 'balances',  label: 'Balances' },
        ]} />
      </div>

      <div className="px-4 py-4 space-y-3">

        {/* INVESTORS TAB */}
        {tab === 'investors' && (
          <>
            <div className="flex justify-between items-center">
              <p className="text-sm text-gray-500">{totalShare < 100 ? `${(100-totalShare).toFixed(1)}% unallocated` : 'Fully allocated'}</p>
              {canEdit && totalShare < 100 && (
                <button onClick={() => setShowAddInv(true)} className="btn-primary text-xs px-3 py-2">+ Investor</button>
              )}
            </div>
            {investors.loading ? <Spinner /> : investors.data.length === 0 ? (
              <Empty icon="👥" title="No investors yet"
                action={canEdit && <button onClick={() => setShowAddInv(true)} className="btn-primary text-sm px-5 py-2.5">Add First Investor</button>} />
            ) : (
              investors.data.map(inv => {
                const invPayments = payments.data.filter(p => p.investor_id === inv.investor_id)
                const paid = invPayments.reduce(
                  (s, p) => s + (p.payment_type === 'refund' ? -p.amount : p.amount), 0
                )
                const committed   = inv.amount_invested ?? 0
                const expShare    = inv.total_expenses_allocated ?? 0
                const outstanding = committed + expShare - paid
                const owesProject = outstanding > 0.5
                const projectOwes = outstanding < -0.5
                return (
                  <div key={inv.investor_id} className="card p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="font-semibold text-gray-900">{inv.investor_name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{inv.share_percent}% share</p>
                      </div>
                      {isOwner && (
                        <button onClick={() => handleDeleteInvestor(inv.investor_id)} className="text-gray-300 hover:text-red-400 text-lg leading-none">×</button>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-center border-t border-gray-50 pt-3">
                      <div>
                        <p className="text-xs font-bold mono text-gray-800">{inr(committed)}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">Committed</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold mono text-emerald-600">{inr(paid)}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">Paid</p>
                      </div>
                      <div>
                        <p className={`text-xs font-bold mono ${owesProject ? 'text-amber-600' : projectOwes ? 'text-blue-600' : 'text-emerald-600'}`}>
                          {inr(Math.abs(outstanding))}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {owesProject ? 'Owes' : projectOwes ? 'Refund due' : 'Settled'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-bold mono text-emerald-600">{inr(inv.total_profit_allocated ?? 0)}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">Profit</p>
                      </div>
                    </div>
                    {expShare > 0 && (
                      <p className="text-[10px] text-gray-400 mt-2 pt-2 border-t border-gray-50">
                        Owes = committed {inr(committed)} + expense share {inr(expShare)} − paid {inr(paid)}
                      </p>
                    )}
                  </div>
                )
              })
            )}
          </>
        )}

        {/* PAYMENTS TAB */}
        {tab === 'payments' && (
          <>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-semibold text-gray-700">
                  Total paid: <span className="text-brand-700 mono">{inr(payments.data.reduce((s, p) => s + (p.payment_type === 'refund' ? -p.amount : p.amount), 0))}</span>
                </p>
                <p className="text-xs text-gray-400">Per-investor payment ledger</p>
              </div>
              {canEdit && investors.data.length > 0 && (
                <button onClick={() => setShowAddPayment(true)} className="btn-primary text-xs px-3 py-2">+ Payment</button>
              )}
            </div>
            {payments.loading ? <Spinner /> : investors.data.length === 0 ? (
              <Empty icon="💳" title="Add investors first" sub="Payments are tied to specific investors" />
            ) : payments.data.length === 0 ? (
              <Empty icon="💳" title="No payments recorded"
                action={canEdit && <button onClick={() => setShowAddPayment(true)} className="btn-primary text-sm px-5 py-2.5">Record First Payment</button>} />
            ) : (
              investors.data.map(inv => {
                const invPayments = payments.data.filter(p => p.investor_id === inv.investor_id)
                if (invPayments.length === 0) return null
                const total = invPayments.reduce((s, p) => s + (p.payment_type === 'refund' ? -p.amount : p.amount), 0)
                return (
                  <div key={inv.investor_id} className="card p-4">
                    <div className="flex justify-between items-center mb-3 pb-3 border-b border-gray-50">
                      <div>
                        <p className="font-semibold text-gray-900">{inv.investor_name}</p>
                        <p className="text-xs text-gray-400">{inv.share_percent}% share · {invPayments.length} payment{invPayments.length === 1 ? '' : 's'}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold mono text-brand-700">{inr(total)}</p>
                        <p className="text-[10px] text-gray-400">total paid in</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {invPayments.map(p => (
                        <div key={p.id} className="flex justify-between items-start text-xs">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${PAYMENT_TYPE_STYLE[p.payment_type]}`}>
                                {PAYMENT_TYPE_LABEL[p.payment_type]}
                              </span>
                              <span className="text-gray-400">{new Date(p.payment_date).toLocaleDateString('en-IN')}</span>
                            </div>
                            {p.expense_description && (
                              <p className="text-gray-600 mt-0.5 truncate">{p.expense_description}</p>
                            )}
                            {p.notes && !p.expense_description && (
                              <p className="text-gray-500 mt-0.5 truncate">{p.notes}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                            <span className={`font-bold mono ${p.payment_type === 'refund' ? 'text-red-500' : 'text-emerald-600'}`}>
                              {p.payment_type === 'refund' ? '-' : '+'}{inr(p.amount)}
                            </span>
                            {isOwner && (
                              <button onClick={() => handleDeletePayment(p.id)} className="text-gray-300 hover:text-red-400 text-base leading-none">×</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              }).filter(Boolean)
            )}
          </>
        )}

        {/* PROFIT HISTORY TAB */}
        {tab === 'profits' && (
          <>
            {canEdit && (
              <div className="flex justify-end">
                <button onClick={() => setShowAddProfit(true)} className="btn-primary text-xs px-3 py-2">+ Record Profit</button>
              </div>
            )}
            {profits.loading ? <Spinner /> : profits.data.length === 0 ? (
              <Empty icon="💰" title="No profit records"
                action={canEdit && <button onClick={() => setShowAddProfit(true)} className="btn-primary text-sm px-5 py-2.5">Add First Record</button>} />
            ) : (
              profits.data.map(rec => (
                <div key={rec.id} className="card p-4">
                  <div className="flex justify-between items-center mb-3">
                    <div>
                      <p className="font-bold text-emerald-600 mono">{inr(rec.amount)}</p>
                      {rec.notes && <p className="text-xs text-gray-400 mt-0.5">{rec.notes}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">{new Date(rec.record_date).toLocaleDateString('en-IN')}</p>
                      {isOwner && <button onClick={() => handleDeleteProfit(rec.id)} className="text-xs text-red-400 mt-1">delete</button>}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Distributed to</p>
                    {investors.data.map(inv => (
                      <div key={inv.investor_id} className="flex justify-between text-xs">
                        <span className="text-gray-500">{inv.investor_name} ({inv.share_percent}%)</span>
                        <span className="font-semibold text-emerald-600 mono">{inr(rec.amount * inv.share_percent / 100)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </>
        )}


        {/* EXPENSES TAB */}
        {tab === 'expenses' && (
          <>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-semibold text-gray-700">Total: <span className="text-red-500 mono">{inr(totalExpenses)}</span></p>
                <p className="text-xs text-gray-400">Split by each investor's share %</p>
              </div>
              {canEdit && (
                <button onClick={() => setShowAddExpense(true)} className="btn-primary text-xs px-3 py-2">+ Add Expense</button>
              )}
            </div>
            {expenses.loading ? <Spinner /> : expenses.data.length === 0 ? (
              <Empty icon="🧾" title="No expenses yet"
                action={canEdit && <button onClick={() => setShowAddExpense(true)} className="btn-primary text-sm px-5 py-2.5">Add First Expense</button>} />
            ) : (
              expenses.data.map(exp => {
                const paidBy = exp.paid_by_investor_id
                  ? investors.data.find(i => i.investor_id === exp.paid_by_investor_id)?.investor_name
                  : null
                return (
                <div key={exp.id} className="card p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{EXPENSE_ICONS[exp.category] || '🧾'}</span>
                      <div>
                        <p className="font-semibold text-red-600 mono">{inr(exp.amount)}</p>
                        <p className="text-xs text-gray-600 mt-0.5">{exp.description}</p>
                        {paidBy && (
                          <p className="text-[10px] text-blue-700 mt-1">
                            <span className="font-semibold">Paid by {paidBy}</span>
                            <span className="text-blue-500"> (credited as payment)</span>
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="badge bg-red-50 text-red-700">{exp.category}</span>
                      <p className="text-xs text-gray-400 mt-1">{new Date(exp.expense_date).toLocaleDateString('en-IN')}</p>
                      {isOwner && <button onClick={() => handleDeleteExpense(exp.id)} className="text-xs text-red-400 mt-1 block">delete</button>}
                    </div>
                  </div>
                  {exp.notes && <p className="text-xs text-gray-400 mb-2">{exp.notes}</p>}
                  <div className="bg-red-50 rounded-xl p-3 space-y-1.5">
                    <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wide mb-2">Charged to each investor</p>
                    {investors.data.map(inv => (
                      <div key={inv.investor_id} className="flex justify-between text-xs">
                        <span className="text-gray-500">{inv.investor_name} ({inv.share_percent}%)</span>
                        <span className="font-semibold text-red-500 mono">−{inr(exp.amount * inv.share_percent / 100)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                )
              })
            )}
          </>
        )}

        {/* BALANCES TAB */}
        {tab === 'balances' && (
          <>
            <p className="text-xs text-gray-400">Running totals: invested + profit − loaned out + repaid</p>
            {balances.loading ? <Spinner /> : balances.data.length === 0 ? (
              <Empty icon="⚖️" title="No balance data" sub="Add investors first" />
            ) : (
              balances.data.map(b => {
                const effective = b.amount_invested + b.profit_allocated - b.money_loaned_out + b.money_repaid_received + b.money_moved_to_projects
                return (
                  <div key={b.investor_id} className="card p-4">
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <p className="font-semibold text-gray-900">{b.investor_name}</p>
                        <p className="text-xs text-gray-400">{b.share_percent}% share</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-emerald-600 mono">{inr(effective)}</p>
                        <p className="text-[10px] text-gray-400">effective balance</p>
                      </div>
                    </div>
                    <div className="space-y-1.5 text-xs border-t border-gray-50 pt-3">
                      {[
                        { l: 'Amount invested',     v: inr(b.amount_invested),              c: 'text-gray-700' },
                        { l: '+ Profit allocated',  v: `+${inr(b.profit_allocated)}`,        c: 'text-emerald-600' },
                        { l: '− Expenses charged',  v: `-${inr(b.total_expenses_allocated ?? 0)}`, c: 'text-red-500' },
                        { l: '− Loaned out',         v: `-${inr(b.money_loaned_out)}`,        c: 'text-red-500' },
                        { l: '+ Repaid received',   v: `+${inr(b.money_repaid_received)}`,   c: 'text-emerald-600' },
                        { l: '+ Moved to projects', v: `+${inr(b.money_moved_to_projects)}`, c: 'text-blue-600' },
                      ].map(({ l, v, c }) => (
                        <div key={l} className="flex justify-between">
                          <span className="text-gray-400">{l}</span>
                          <span className={`font-semibold mono ${c}`}>{v}</span>
                        </div>
                      ))}
                      <div className="flex justify-between border-t border-gray-100 pt-1.5 mt-1">
                        <span className="font-semibold text-gray-600">= Effective balance</span>
                        <span className="font-bold mono text-emerald-600">{inr(effective)}</span>
                      </div>
                    </div>
                    {b.money_loaned_out > 0 && (
                      <div className="mt-3">
                        <p className="text-[10px] text-gray-400 mb-1">Capital deployed in loans</p>
                        <ProgressBar value={b.money_loaned_out} max={b.amount_invested} color="bg-red-400" />
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </>
        )}
      </div>

      {/* Add Investor Sheet */}
      {canEdit && (
        <AddInvestorSheet open={showAddInv} onClose={() => setShowAddInv(false)}
          projectId={id} projectValue={projectValue} projectTotalValue={projectTotalValue} stakePercent={stakePercent} remainingShare={100 - totalShare}
          onSaved={() => { setShowAddInv(false); investors.reload(); balances.reload(); show('Investor added!') }} />
      )}

      {/* Add Profit Sheet */}
      {canEdit && (
        <AddProfitSheet open={showAddProfit} onClose={() => setShowAddProfit(false)}
          projectId={id}
          onSaved={() => { setShowAddProfit(false); profits.reload(); investors.reload(); show('Profit recorded!') }} />
      )}

      {/* Add Expense Sheet */}
      {canEdit && (
        <AddExpenseSheet open={showAddExpense} onClose={() => setShowAddExpense(false)}
          projectId={id} investors={investors.data}
          onSaved={() => { setShowAddExpense(false); expenses.reload(); investors.reload(); payments.reload(); balances.reload(); show('Expense recorded!') }} />
      )}

      {/* Add Payment Sheet */}
      {canEdit && (
        <AddPaymentSheet open={showAddPayment} onClose={() => setShowAddPayment(false)}
          projectId={id} investors={investors.data}
          onSaved={() => { setShowAddPayment(false); payments.reload(); investors.reload(); balances.reload(); show('Payment recorded!') }} />
      )}

      {/* Edit Project Sheet */}
      {isOwner && project && (
        <EditProjectSheet open={showEdit} onClose={() => setShowEdit(false)}
          project={project}
          onSaved={() => { setShowEdit(false); show('Project updated!') }} />
      )}

      {/* Share Modal */}
      {isOwner && project && (
        <ShareModal open={showShare} onClose={() => setShowShare(false)} project={project} />
      )}
    </div>
  )
}

function AddInvestorSheet({ open, onClose, projectId, projectValue, projectTotalValue, stakePercent, remainingShare, onSaved }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', share_percent: '', amount_invested: '', notes: '' })
  const [autoAmt, setAutoAmt] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleShare = (v) => {
    set('share_percent', v)
    if (autoAmt && projectValue) set('amount_invested', ((parseFloat(v)||0) * projectValue / 100).toFixed(0))
  }

  const submit = async () => {
    const p = parseFloat(form.share_percent)
    if (!form.name)              { setError('Name is required'); return }
    if (!p || p > remainingShare){ setError(`Share must be between 0 and ${remainingShare.toFixed(1)}%`); return }
    if (!form.amount_invested)   { setError('Amount is required'); return }
    setSaving(true); setError(null)
    try {
      await createInvestor({
        project_id:     projectId,
        name:           form.name,
        email:          form.email || null,
        phone:          form.phone || null,
        share_percent:  p,
        amount_invested:parseFloat(form.amount_invested),
        notes:          form.notes || null,
      })
      if (form.email) {
        try {
          const { inviteUser } = await import('../hooks/useSharing')
          await inviteUser({ projectId, email: form.email, role: 'viewer' })
        } catch (_) {}
      }
      setForm({ name: '', email: '', phone: '', share_percent: '', amount_invested: '', notes: '' })
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const computedAmt = ((parseFloat(form.share_percent)||0) * projectValue / 100)

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add Investor"
      footer={
        <div className="space-y-2">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          {form.share_percent && (
            <div className="flex items-center justify-between text-xs text-brand-700 bg-brand-50 rounded-xl px-3 py-2">
              <span>Amount from pool</span>
              <span className="font-bold mono">{inr(computedAmt)}</span>
            </div>
          )}
          <button type="button" onClick={submit} className="btn-primary w-full" disabled={saving}>
            {saving ? 'Adding…' : 'Add Investor'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Pool info */}
        <div className="bg-blue-50 rounded-xl px-3 py-2.5 text-xs text-blue-800">
          <p className="font-semibold">Pool = {inr(projectValue)}
            <span className="font-normal text-blue-500 ml-1">({stakePercent}% of {inr(projectTotalValue)})</span>
          </p>
          <p className="text-blue-500 mt-0.5">Share % splits this pool · {remainingShare.toFixed(1)}% still available</p>
        </div>

        {/* Required fields */}
        <Field label="Full Name *">
          <input className="input" placeholder="e.g. Ravi Kumar" value={form.name}
            onChange={e => set('name', e.target.value)} autoFocus />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={`Share % *`}>
            <input className="input" type="number" step="0.01" min="0.01"
              max={remainingShare} placeholder="25"
              value={form.share_percent} onChange={e => handleShare(e.target.value)} />
          </Field>
          <Field label="Committed Amount (₹) *">
            <input className="input" type="number" placeholder="0"
              value={form.amount_invested}
              onChange={e => { setAutoAmt(false); set('amount_invested', e.target.value) }} />
            <p className="text-[10px] text-gray-400 mt-1">Their stake / what they owe — record actual payments later via + Payment.</p>
          </Field>
        </div>

        {/* Optional fields */}
        <Collapsible label="Optional details" icon="📋">
          <Field label="Email (sends app invite)">
            <input className="input" type="email" placeholder="investor@email.com"
              value={form.email} onChange={e => set('email', e.target.value)} />
            {form.email && <p className="text-xs text-blue-500 mt-1">✉️ They'll get a Viewer invite to this project</p>}
          </Field>
          <Field label="Phone">
            <input className="input" type="tel" placeholder="+91 98765 43210"
              value={form.phone} onChange={e => set('phone', e.target.value)} />
          </Field>
          <Field label="Notes">
            <textarea className="input resize-none" rows={2} placeholder="Optional…"
              value={form.notes} onChange={e => set('notes', e.target.value)} />
          </Field>
        </Collapsible>
      </div>
    </Sheet>
  )
}

function AddProfitSheet({ open, onClose, projectId, onSaved }) {
  const [form, setForm] = useState({ amount: '', record_date: isoDate(), notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      await createProfitRecord({ project_id: projectId, amount: parseFloat(form.amount), record_date: form.record_date, notes: form.notes || null })
      setForm({ amount: '', record_date: isoDate(), notes: '' })
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Record Profit"
      footer={
        <div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2">{error}</p>}
          <button type="button" onClick={submit} className="btn-primary w-full" disabled={saving}>
            {saving ? 'Saving…' : 'Record Profit'}
          </button>
        </div>
      }>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Profit Amount (₹) *">
          <input className="input" type="number" placeholder="0" value={form.amount} onChange={e => set('amount', e.target.value)} required autoFocus />
        </Field>
        <Field label="Date">
          <input className="input" type="date" value={form.record_date} onChange={e => set('record_date', e.target.value)} />
        </Field>
        <Field label="Notes">
          <textarea className="input resize-none" rows={2} placeholder="e.g. Q1 rental income" value={form.notes} onChange={e => set('notes', e.target.value)} />
        </Field>
      </form>
    </Sheet>
  )
}

// ── Payment type styling ──────────────────────────────────────
const PAYMENT_TYPE_LABEL = {
  share_contribution: 'share',
  expense_paid:       'expense',
  top_up:             'top-up',
  refund:             'refund',
}
const PAYMENT_TYPE_STYLE = {
  share_contribution: 'bg-blue-50 text-blue-700',
  expense_paid:       'bg-red-50 text-red-700',
  top_up:             'bg-emerald-50 text-emerald-700',
  refund:             'bg-amber-50 text-amber-700',
}

// ── Expense category icons ────────────────────────────────────
const EXPENSE_ICONS = {
  registration:  '📋',
  travel:        '✈️',
  legal:         '⚖️',
  maintenance:   '🔧',
  tax:           '🏛️',
  construction:  '🏗️',
  other:         '🧾',
}

// ── Add Expense Sheet ─────────────────────────────────────────
function AddExpenseSheet({ open, onClose, projectId, investors = [], onSaved }) {
  const [form, setForm] = useState({
    amount: '', category: 'other', description: '', expense_date: isoDate(), notes: '',
    paid_by_investor_id: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const CATEGORIES = [
    { value: 'registration', label: '📋 Registration' },
    { value: 'travel',       label: '✈️ Travel' },
    { value: 'legal',        label: '⚖️ Legal' },
    { value: 'maintenance',  label: '🔧 Maintenance' },
    { value: 'tax',          label: '🏛️ Tax' },
    { value: 'construction', label: '🏗️ Construction' },
    { value: 'other',        label: '🧾 Other' },
  ]

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      await createExpense({
        project_id:          projectId,
        amount:              parseFloat(form.amount),
        category:            form.category,
        description:         form.description,
        expense_date:        form.expense_date,
        notes:               form.notes || null,
        paid_by_investor_id: form.paid_by_investor_id || null,
      })
      setForm({ amount: '', category: 'other', description: '', expense_date: isoDate(), notes: '', paid_by_investor_id: '' })
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add Expense"
      footer={
        <div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2">{error}</p>}
          <button type="button" onClick={submit}
            className="btn-primary w-full" disabled={saving}
            style={{ background: '#dc2626' }}>
            {saving ? 'Saving…' : 'Record Expense'}
          </button>
        </div>
      }>
      <form onSubmit={submit} className="space-y-4">

        <Field label="Category">
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map(c => (
              <button key={c.value} type="button"
                onClick={() => set('category', c.value)}
                className={`text-sm py-2 px-3 rounded-xl border text-left transition-all
                  ${form.category === c.value
                    ? 'border-red-400 bg-red-50 text-red-800 font-semibold'
                    : 'border-gray-200 text-gray-600'}`}>
                {c.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Description *">
          <input className="input" placeholder="e.g. Property registration fee" value={form.description}
            onChange={e => set('description', e.target.value)} required />
        </Field>

        <Field label="Amount (₹) *">
          <input className="input" type="number" placeholder="0" value={form.amount}
            onChange={e => set('amount', e.target.value)} required />
        </Field>

        <Field label="Date">
          <input className="input" type="date" value={form.expense_date}
            onChange={e => set('expense_date', e.target.value)} />
        </Field>

        <Field label="Paid by">
          <select className="input" value={form.paid_by_investor_id}
            onChange={e => set('paid_by_investor_id', e.target.value)}>
            <option value="">Project funds (default)</option>
            {investors.map(inv => (
              <option key={inv.investor_id} value={inv.investor_id}>
                {inv.investor_name} ({inv.share_percent}%)
              </option>
            ))}
          </select>
          {form.paid_by_investor_id && (
            <p className="text-[10px] text-blue-700 mt-1.5 bg-blue-50 rounded-lg px-2 py-1.5">
              ✓ Will credit this investor with the full amount, and still split the expense by share %
            </p>
          )}
        </Field>

        <Field label="Notes">
          <textarea className="input resize-none" rows={2} placeholder="Optional details…"
            value={form.notes} onChange={e => set('notes', e.target.value)} />
        </Field>

      </form>
    </Sheet>
  )
}

// ── Add Payment Sheet ─────────────────────────────────────────
function AddPaymentSheet({ open, onClose, projectId, investors = [], onSaved }) {
  const [form, setForm] = useState({
    investor_id: '', amount: '', payment_type: 'share_contribution',
    payment_date: isoDate(), notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const TYPES = [
    { value: 'share_contribution', label: '💼 Share contribution', hint: 'Investor paying their committed share' },
    { value: 'top_up',             label: '➕ Top-up',              hint: 'Additional capital beyond their share' },
    { value: 'refund',             label: '↩ Refund to investor',  hint: 'Project paying capital back to investor' },
  ]

  const submit = async () => {
    if (!form.investor_id) { setError('Pick an investor'); return }
    if (!form.amount)      { setError('Amount is required'); return }
    setSaving(true); setError(null)
    try {
      await createPayment({
        investor_id:  form.investor_id,
        project_id:   projectId,
        amount:       parseFloat(form.amount),
        payment_type: form.payment_type,
        payment_date: form.payment_date,
        notes:        form.notes || null,
      })
      setForm({ investor_id: '', amount: '', payment_type: 'share_contribution', payment_date: isoDate(), notes: '' })
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Record Payment"
      footer={
        <div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2">{error}</p>}
          <button type="button" onClick={submit} className="btn-primary w-full" disabled={saving}>
            {saving ? 'Saving…' : 'Record Payment'}
          </button>
        </div>
      }>
      <div className="space-y-4">
        <div className="bg-blue-50 rounded-xl px-3 py-2.5 text-xs text-blue-800">
          For expenses paid by an investor, use the Add Expense form and set "Paid by" — it auto-records the payment too.
        </div>

        <Field label="Investor *">
          <select className="input" value={form.investor_id}
            onChange={e => set('investor_id', e.target.value)} autoFocus>
            <option value="">Choose investor</option>
            {investors.map(inv => (
              <option key={inv.investor_id} value={inv.investor_id}>
                {inv.investor_name} ({inv.share_percent}%)
              </option>
            ))}
          </select>
        </Field>

        <Field label="Payment Type">
          <div className="space-y-2">
            {TYPES.map(t => (
              <button key={t.value} type="button" onClick={() => set('payment_type', t.value)}
                className={`w-full text-left px-3 py-2.5 rounded-xl border text-sm transition-all
                  ${form.payment_type === t.value
                    ? 'border-brand-900 bg-brand-50'
                    : 'border-gray-200'}`}>
                <p className={`font-semibold ${form.payment_type === t.value ? 'text-brand-900' : 'text-gray-700'}`}>{t.label}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{t.hint}</p>
              </button>
            ))}
          </div>
        </Field>

        <Field label="Amount (₹) *">
          <input className="input" type="number" placeholder="0" value={form.amount}
            onChange={e => set('amount', e.target.value)} />
        </Field>

        <Field label="Date">
          <input className="input" type="date" value={form.payment_date}
            onChange={e => set('payment_date', e.target.value)} />
        </Field>

        <Field label="Notes">
          <textarea className="input resize-none" rows={2} placeholder="Optional…"
            value={form.notes} onChange={e => set('notes', e.target.value)} />
        </Field>
      </div>
    </Sheet>
  )
}

// ── Edit Project Sheet ────────────────────────────────────────
function EditProjectSheet({ open, onClose, project, onSaved }) {
  const [form, setForm] = useState({
    name:              project?.name              ?? '',
    description:       project?.description       ?? '',
    total_value:       project?.total_value       ?? '',
    our_stake_percent: project?.our_stake_percent ?? 100,
    status:            project?.status            ?? 'active',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    setSaving(true); setError(null)
    try {
      await updateProject(project.id, {
        name:              form.name,
        description:       form.description || null,
        total_value:       parseFloat(form.total_value),
        our_stake_percent: parseFloat(form.our_stake_percent),
        status:            form.status,
      })
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Edit Project"
      footer={
        <div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2">{error}</p>}
          <button type="button" onClick={submit} className="btn-primary w-full" disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      }>
      <div className="space-y-4">
        <Field label="Project Name *">
          <input className="input" value={form.name} onChange={e => set('name', e.target.value)} />
        </Field>
        <Field label="Description">
          <textarea className="input resize-none" rows={2} value={form.description}
            onChange={e => set('description', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Total Value (₹)">
            <input className="input" type="number" value={form.total_value}
              onChange={e => set('total_value', e.target.value)} />
          </Field>
          <Field label="Our Stake %">
            <input className="input" type="number" min="1" max="100" value={form.our_stake_percent}
              onChange={e => set('our_stake_percent', e.target.value)} />
          </Field>
        </div>
        <Field label="Status">
          <select className="input" value={form.status} onChange={e => set('status', e.target.value)}>
            <option value="upcoming">Upcoming</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
        </Field>
      </div>
    </Sheet>
  )
}
