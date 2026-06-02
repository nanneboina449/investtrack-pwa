// src/pages/ProjectDetail.jsx
import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  useInvestors, useInvestorBalances, useProfitRecords, useExpenses, useInvestorPayments, useProfitDistributions, useProjects, useAllInvestors,
  useProjectSettlement, payoutSettlementRefund, collectSettlementOwes,
  createInvestor, deleteInvestor, updateInvestor,
  createProfitRecord, deleteProfitRecord, updateProfitRecord,
  createExpense, deleteExpense, updateExpense,
  createPayment, deletePayment, updatePayment, updateMove,
  reallocateInvestorPosition, transferFundsAsLoan,
  updateProject, deleteProject
} from '../hooks/useData'
import { useMyRole } from '../hooks/useSharing'
import { inr, inrCompact, pct, isoDate, supabase } from '../lib/supabase'
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
  const [showSettle, setShowSettle] = useState(false)

  const investors      = useInvestors(id)
  const balances       = useInvestorBalances(id)
  const profits        = useProfitRecords(id)
  const expenses       = useExpenses(id)
  const payments       = useInvestorPayments(id)
  const distributions  = useProfitDistributions(id)
  const allProjects    = useProjects()
  const projectNameById = useMemo(() => {
    const m = {}
    for (const p of (allProjects.data ?? [])) m[p.id] = p.name
    return m
  }, [allProjects.data])

  const [moveFromInv, setMoveFromInv]   = useState(null)
  const [lendFromInv, setLendFromInv]   = useState(null)
  const [editInvestor, setEditInvestor] = useState(null)
  const [editProfit, setEditProfit]     = useState(null)
  const [editExpense, setEditExpense]   = useState(null)
  const [editPayment, setEditPayment]   = useState(null)
  const [editMove,    setEditMove]      = useState(null)

  const allInvestors = useAllInvestors()

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

  const totalShare    = investors.data.reduce((s, i) => s + (i.share_percent ?? 0), 0)
  const totalProfit   = profits.data.reduce((s, p) => s + (p.amount ?? 0), 0)
  const totalExpenses = expenses.data.reduce((s, e) => s + (e.amount ?? 0), 0)
  const netReturn     = totalProfit - totalExpenses
  // Capital flow at the project level — for the "Value Generated / Extracted /
  // Active Capital" strip in the header.
  const totalPaidIn   = payments.data
    .filter(p => p.payment_type !== 'refund')
    .reduce((s, p) => s + Number(p.amount || 0), 0)
  const totalExtracted = payments.data
    .filter(p => p.payment_type === 'refund' && (p.destination_project_id || p.destination_investor_id))
    .reduce((s, p) => s + Number(p.amount || 0), 0)
  const valueGenerated = totalPaidIn + totalProfit
  const activeCapital  = valueGenerated - totalExtracted - totalExpenses
  const projectName  = project?.name ?? investors.data[0]?.project_name ?? 'Project'
  const projectTotalValue = project?.total_value ?? investors.data[0]?.total_value ?? 0
  const stakePercent = project?.our_stake_percent ?? 100
  const projectValue = Math.round(projectTotalValue * stakePercent / 100)

  const handleDeleteInvestor = async (invId) => {
    if (!confirm('Remove this investor?')) return
    try {
      const result = await deleteInvestor(invId)
      investors.reload()
      // Phase C: if the investor has ledger history, deleteInvestor falls
      // back to a soft delete (is_deleted=true) so the FK isn't violated.
      // Tell the user so they know the rows are still queryable.
      if (result?.mode === 'soft') {
        show('Investor archived — ledger history preserved')
      } else {
        show('Investor removed')
      }
    } catch (e) { show(e.message, 'error') }
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

      {/* Header — full-bleed bar, content padded */}
      <div className="bg-brand-900 text-white px-4 sm:px-6 lg:px-8 pt-12 lg:pt-8 pb-5">
        <div className="flex justify-between items-center mb-3 gap-3">
          <button onClick={() => navigate(-1)} className="text-brand-100 text-sm flex items-center gap-1 flex-shrink-0">← Back</button>
          {isOwner && (
            <div className="relative flex-shrink-0">
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
                  {project?.status !== 'completed' && (
                    <button onClick={() => { setShowSettle(true); setShowMenu(false) }}
                      className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2 border-t border-gray-100">
                      🔒 Close & Settle
                    </button>
                  )}
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
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold mb-4 break-words leading-tight pr-2">
          {projectName}
        </h1>
        <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-2">
          <HeaderMetric label="Property Value" value={projectValue} fullValue={inr(projectValue)} />
          <HeaderMetric
            label="Net Return"
            value={netReturn}
            fullValue={inr(netReturn)}
            tone={netReturn >= 0 ? 'good' : 'bad'}
            sub={totalExpenses > 0 ? `−${inrCompact(totalExpenses)} exp` : null}
            subTitle={totalExpenses > 0 ? `Expenses ${inr(totalExpenses)}` : null}
          />
          <div className="bg-white/10 rounded-xl p-2.5 sm:p-3 text-center min-w-0">
            <p className="text-brand-100 text-[10px] sm:text-xs mb-0.5 truncate">Share Filled</p>
            <p className={`font-bold leading-tight tabular-nums text-xs sm:text-sm lg:text-base ${totalShare >= 100 ? 'text-emerald-300' : 'text-amber-300'}`}>{totalShare.toFixed(1)}%</p>
          </div>
        </div>
        {/* Capital flow strip — paid + profit, what's been extracted, what's still working */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <HeaderMetric label="Value Generated" value={valueGenerated} fullValue={inr(valueGenerated)} sub="paid + profit" />
          <HeaderMetric label="Extracted" value={totalExtracted} fullValue={inr(totalExtracted)} prefix="−" tone={totalExtracted > 0 ? 'extracted' : 'muted'} sub="moved or lent out" />
          <HeaderMetric label="Active Capital" value={activeCapital} fullValue={inr(activeCapital)} tone={activeCapital >= 0 ? 'good' : 'bad'} sub="still in this project" />
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
                // PROJECT-LEVEL paid: cumulative cash contributions to THIS
                // project. Internal extractions (reallocations to another
                // project / lending to another investor) are tracked under
                // "Extracted" and on the Dashboard running balance — they
                // don't reduce the project-level Paid because the original
                // contribution is a historical fact.
                //
                //   + share_contribution / top_up / expense_paid           → adds
                //   − refund WITHOUT destination (project really paid back) → subtracts
                //   = refund WITH destination (move / lend)                → IGNORED at project level
                const paid = invPayments.reduce((s, p) => {
                  if (p.payment_type === 'refund') {
                    return (p.destination_project_id || p.destination_investor_id)
                      ? s
                      : s - Number(p.amount || 0)
                  }
                  return s + Number(p.amount || 0)
                }, 0)
                const extracted = invPayments
                  .filter(p => p.payment_type === 'refund' && (p.destination_project_id || p.destination_investor_id))
                  .reduce((s, p) => s + Number(p.amount || 0), 0)

                // Profit MUST come from profit_distributions (respects custom splits).
                const invDists = distributions.data.filter(d => d.investor_id === inv.investor_id)
                const ledgerActive = distributions.data.length > 0 || profits.data.length === 0
                const profit = ledgerActive
                  ? invDists.reduce((s, d) => s + Number(d.amount || 0), 0)
                  : (inv.total_profit_allocated ?? 0)
                const committed   = inv.amount_invested ?? 0
                const expShare    = inv.total_expenses_allocated ?? 0
                const outstanding = committed + expShare - paid
                const owesProject = outstanding > 0.5
                const projectOwes = outstanding < -0.5
                const loanedOut   = extracted
                const roi         = committed > 0 ? (profit / committed) * 100 : 0
                return (
                  <div key={inv.investor_id} className="card p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="font-semibold text-gray-900">{inv.investor_name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{inv.share_percent}% share</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {canEdit && (
                          <button onClick={() => setEditInvestor(inv)}
                            className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-gray-100 text-gray-700">
                            ✎ Edit
                          </button>
                        )}
                        {canEdit && (
                          <button onClick={() => setMoveFromInv(inv)}
                            className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-blue-50 text-blue-700">
                            ⇄ Move
                          </button>
                        )}
                        {canEdit && (
                          <button onClick={() => setLendFromInv(inv)}
                            className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-amber-50 text-amber-700">
                            ↗ Lend
                          </button>
                        )}
                        {isOwner && (
                          <button onClick={() => handleDeleteInvestor(inv.investor_id)} className="text-gray-300 hover:text-red-400 text-lg leading-none">×</button>
                        )}
                      </div>
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
                        <p className="text-xs font-bold mono text-emerald-600">{inr(profit)}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">Profit</p>
                      </div>
                    </div>
                    {(expShare > 0 || profit > 0 || loanedOut > 0) && (
                      <div className="mt-2 pt-2 border-t border-gray-50 space-y-1">
                        {loanedOut > 0 && (() => {
                          // Distinguish reallocations (refunds with destination_investor_id
                          // pointing to the SAME person on another project) from loans
                          // (refunds with destination_investor_id pointing to a DIFFERENT person)
                          const refunds = invPayments.filter(p => p.payment_type === 'refund' && p.destination_investor_id)
                          const reallocAmt = refunds
                            .filter(r => r.destination_investor_id /* will be the same person via name match elsewhere */
                              && investors.data.some(i => i.investor_id === inv.investor_id))
                            // crude: classify by checking if there's a matching cash_adjustments loan record
                            // (we don't have that data here, so just show one combined line)
                            .reduce((s, r) => s + r.amount, 0)
                          return (
                            <p className="text-[10px] text-blue-700 font-medium">
                              Extracted from this project: −{inr(loanedOut)} (moved or lent out — tracked elsewhere as receivable / position on another project)
                            </p>
                          )
                        })()}
                        {expShare > 0 && (
                          <p className="text-[10px] text-gray-400">
                            Owes = committed {inr(committed)} + expense share {inr(expShare)} − paid {inr(Math.max(paid, 0))}
                          </p>
                        )}
                        {profit > 0 && committed > 0 && (
                          <p className="text-[10px] text-emerald-700 font-medium">
                            ROI on contribution: {roi.toFixed(2)}% ({inr(profit)} on {inr(committed)})
                          </p>
                        )}
                      </div>
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
                      {invPayments.map(p => {
                        const fromName = p.source_project_id ? projectNameById[p.source_project_id] : null
                        const toName   = p.destination_project_id ? projectNameById[p.destination_project_id] : null
                        // Top-ups with a source are "Reinvested from X" — paper profit / capital
                        // redeployed from another project. Without a source, fresh external cash.
                        const cashOrReinvested = p.payment_type === 'top_up'
                          ? (fromName ? 'reinvested' : 'cash')
                          : null
                        return (
                          <div key={p.id} className="flex justify-between items-start text-xs">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${PAYMENT_TYPE_STYLE[p.payment_type]}`}>
                                  {PAYMENT_TYPE_LABEL[p.payment_type]}
                                </span>
                                {cashOrReinvested === 'cash' && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                                    💵 cash
                                  </span>
                                )}
                                {cashOrReinvested === 'reinvested' && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">
                                    ♻ reinvested
                                  </span>
                                )}
                                {fromName && (
                                  <button type="button"
                                    onClick={(e) => { e.stopPropagation(); navigate(`/projects/${p.source_project_id}`) }}
                                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 hover:bg-blue-100">
                                    ← from {fromName}
                                  </button>
                                )}
                                {toName && (
                                  <button type="button"
                                    onClick={(e) => { e.stopPropagation(); navigate(`/projects/${p.destination_project_id}`) }}
                                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 hover:bg-amber-100">
                                    → to {toName}
                                  </button>
                                )}
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
                              {canEdit && (
                                <button
                                  onClick={() => {
                                    // If this is part of a linked move (refund with destination), open the move editor
                                    if (p.payment_type === 'refund' && p.destination_project_id) setEditMove(p)
                                    else setEditPayment(p)
                                  }}
                                  className="text-gray-400 hover:text-gray-600 text-xs">
                                  ✎
                                </button>
                              )}
                              {isOwner && (
                                <button onClick={() => handleDeletePayment(p.id)} className="text-gray-300 hover:text-red-400 text-base leading-none">×</button>
                              )}
                            </div>
                          </div>
                        )
                      })}
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
              profits.data.map(rec => {
                const recDists = distributions.data.filter(d => d.profit_id === rec.id)
                // Detect "custom" split: any distribution diverges materially from proportional
                const isCustom = recDists.some(d => {
                  const inv = investors.data.find(i => i.investor_id === d.investor_id)
                  if (!inv) return false
                  const proportional = rec.amount * inv.share_percent / 100
                  return Math.abs(d.amount - proportional) > 0.5
                })
                return (
                  <div key={rec.id} className="card p-4">
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-emerald-600 mono">{inr(rec.amount)}</p>
                          {isCustom && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">custom split</span>}
                        </div>
                        {rec.notes && <p className="text-xs text-gray-400 mt-0.5">{rec.notes}</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-400">{new Date(rec.record_date).toLocaleDateString('en-IN')}</p>
                        <div className="flex gap-2 mt-1 justify-end">
                          {canEdit && <button onClick={() => setEditProfit(rec)} className="text-xs text-gray-500">edit</button>}
                          {isOwner && <button onClick={() => handleDeleteProfit(rec.id)} className="text-xs text-red-400">delete</button>}
                        </div>
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Distributed to</p>
                      {investors.data.map(inv => {
                        const dist = recDists.find(d => d.investor_id === inv.investor_id)
                        const amount = dist ? dist.amount : rec.amount * inv.share_percent / 100
                        return (
                          <div key={inv.investor_id} className="flex justify-between text-xs">
                            <span className="text-gray-500">{inv.investor_name} ({inv.share_percent}%)</span>
                            <span className="font-semibold text-emerald-600 mono">{inr(amount)}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })
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
                      <div className="flex gap-2 mt-1 justify-end">
                        {canEdit && <button onClick={() => setEditExpense(exp)} className="text-xs text-gray-500">edit</button>}
                        {isOwner && <button onClick={() => handleDeleteExpense(exp.id)} className="text-xs text-red-400">delete</button>}
                      </div>
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
                // Resolve from actual ledger data — view's amount_invested is
                // commitment, not real cash. Sum payments (refunds subtract)
                // and distributions (custom-aware).
                const invPayments = payments.data.filter(p => p.investor_id === b.investor_id)
                const paidIn = invPayments.reduce(
                  (s, p) => s + (p.payment_type === 'refund' ? -p.amount : p.amount), 0
                )
                const bDists = distributions.data.filter(d => d.investor_id === b.investor_id)
                const ledgerActive = distributions.data.length > 0 || profits.data.length === 0
                const profitAllocated = ledgerActive
                  ? bDists.reduce((s, d) => s + Number(d.amount || 0), 0)
                  : (b.profit_allocated ?? 0)
                const committed   = b.amount_invested ?? 0
                const expShare    = b.total_expenses_allocated ?? 0
                const outstanding = committed + expShare - paidIn
                // Effective: real cash position in this project after all flows
                const effective = paidIn + profitAllocated - expShare
                  - (b.money_loaned_out ?? 0)
                  + (b.money_repaid_received ?? 0)
                  + (b.money_moved_to_projects ?? 0)
                return (
                  <div key={b.investor_id} className="card p-4">
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <p className="font-semibold text-gray-900">{b.investor_name}</p>
                        <p className="text-xs text-gray-400">{b.share_percent}% share</p>
                      </div>
                      <div className="text-right">
                        <p className={`font-bold mono ${effective >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{inr(effective)}</p>
                        <p className="text-[10px] text-gray-400">effective balance</p>
                      </div>
                    </div>
                    <div className="space-y-1.5 text-xs border-t border-gray-50 pt-3">
                      {[
                        { l: 'Committed',           v: inr(committed),                       c: 'text-gray-700' },
                        { l: 'Paid in (ledger)',    v: inr(paidIn),                          c: 'text-emerald-700' },
                        { l: '+ Profit allocated',  v: `+${inr(profitAllocated)}`,           c: 'text-emerald-600' },
                        { l: '− Expenses charged',  v: `-${inr(expShare)}`,                  c: 'text-red-500' },
                        { l: '− Loaned out',         v: `-${inr(b.money_loaned_out)}`,        c: 'text-red-500' },
                        { l: '+ Repaid received',   v: `+${inr(b.money_repaid_received)}`,   c: 'text-emerald-600' },
                        { l: '+ Moved to projects', v: `+${inr(b.money_moved_to_projects)}`, c: 'text-blue-600' },
                        { l: outstanding > 0.5 ? 'Still owes' : outstanding < -0.5 ? 'Refund due' : 'Settled',
                          v: inr(Math.abs(outstanding)),
                          c: outstanding > 0.5 ? 'text-amber-600' : outstanding < -0.5 ? 'text-blue-600' : 'text-emerald-600' },
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
          projectId={id} investors={investors.data}
          onSaved={() => { setShowAddProfit(false); profits.reload(); investors.reload(); distributions.reload(); balances.reload(); show('Profit recorded!') }} />
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

      {/* Move Position Sheet */}
      {canEdit && moveFromInv && (
        <MoveInvestorPositionSheet
          investor={moveFromInv}
          projects={allProjects.data}
          currentProjectId={id}
          onClose={() => setMoveFromInv(null)}
          onSaved={() => {
            setMoveFromInv(null)
            payments.reload(); investors.reload(); balances.reload()
            show('Position moved successfully')
          }}
        />
      )}

      {/* Lend to another Investor Sheet */}
      {canEdit && lendFromInv && (
        <LendToInvestorSheet
          source={lendFromInv}
          allInvestors={allInvestors.data}
          projectNameById={projectNameById}
          onClose={() => setLendFromInv(null)}
          onSaved={() => {
            setLendFromInv(null)
            payments.reload(); investors.reload(); balances.reload()
            show('Loan recorded')
          }}
        />
      )}

      {/* Edit sheets */}
      {canEdit && editInvestor && (
        <EditInvestorSheet investor={editInvestor}
          onClose={() => setEditInvestor(null)}
          onSaved={() => { setEditInvestor(null); investors.reload(); balances.reload(); payments.reload(); show('Investor updated') }} />
      )}
      {canEdit && editProfit && (
        <EditProfitSheet record={editProfit}
          onClose={() => setEditProfit(null)}
          onSaved={() => { setEditProfit(null); profits.reload(); investors.reload(); distributions.reload(); balances.reload(); show('Profit updated') }} />
      )}
      {canEdit && editExpense && (
        <EditExpenseSheet expense={editExpense} investors={investors.data}
          onClose={() => setEditExpense(null)}
          onSaved={() => { setEditExpense(null); expenses.reload(); investors.reload(); payments.reload(); balances.reload(); show('Expense updated') }} />
      )}
      {canEdit && editPayment && (
        <EditPaymentSheet payment={editPayment}
          onClose={() => setEditPayment(null)}
          onSaved={() => { setEditPayment(null); payments.reload(); investors.reload(); balances.reload(); show('Payment updated') }} />
      )}
      {canEdit && editMove && (
        <EditMoveSheet refund={editMove} projectNameById={projectNameById}
          onClose={() => setEditMove(null)}
          onSaved={() => { setEditMove(null); payments.reload(); investors.reload(); balances.reload(); show('Move updated') }} />
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

      {/* Close & Settle Wizard */}
      {isOwner && showSettle && (
        <CloseSettleSheet
          projectId={id}
          onClose={() => setShowSettle(false)}
          onCompleted={() => {
            setShowSettle(false)
            investors.reload(); payments.reload(); balances.reload()
            allProjects.reload?.()
            show('Project closed & settled')
          }}
        />
      )}
    </div>
  )
}

function AddInvestorSheet({ open, onClose, projectId, projectValue, projectTotalValue, stakePercent, remainingShare, onSaved }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', share_percent: '', amount_invested: '', notes: '' })
  const [mode, setMode] = useState('share_split') // 'share_split' | 'custom_amount' | 'fully_manual'
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleShare = (v) => {
    set('share_percent', v)
    if (mode === 'share_split' && projectValue) {
      set('amount_invested', ((parseFloat(v)||0) * projectValue / 100).toFixed(0))
    }
  }

  const handleAmount = (v) => {
    set('amount_invested', v)
    if (mode === 'custom_amount' && projectValue > 0) {
      const derivedShare = ((parseFloat(v)||0) / projectValue) * 100
      set('share_percent', derivedShare ? derivedShare.toFixed(2) : '')
    }
  }

  const submit = async () => {
    const p = parseFloat(form.share_percent)
    if (!form.name)              { setError('Name is required'); return }
    if (!form.email || !form.email.includes('@')) { setError('A valid email is required'); return }
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

  const computedAmt   = ((parseFloat(form.share_percent)||0) * projectValue / 100)
  const enteredAmt    = parseFloat(form.amount_invested) || 0
  const sharePct      = parseFloat(form.share_percent) || 0
  const isCustomMode  = mode === 'custom_amount'
  const isManualMode  = mode === 'fully_manual'
  const hasAutoFill   = mode === 'share_split' || mode === 'custom_amount'

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add Investor"
      footer={
        <div className="space-y-2">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          {mode === 'share_split' && form.share_percent && (
            <div className="flex items-center justify-between text-xs text-brand-700 bg-brand-50 rounded-xl px-3 py-2">
              <span>Auto-filled from pool</span>
              <span className="font-bold mono">{inr(computedAmt)}</span>
            </div>
          )}
          {mode !== 'share_split' && enteredAmt > 0 && sharePct > 0 && (
            <div className="flex items-center justify-between text-xs text-purple-700 bg-purple-50 rounded-xl px-3 py-2">
              <span>{sharePct}% profit on ₹{(enteredAmt/1000).toFixed(0)}k contribution</span>
              <span className="font-bold mono">{isManualMode ? 'manual' : 'custom split'}</span>
            </div>
          )}
          <button type="button" onClick={submit} className="btn-primary w-full" disabled={saving}>
            {saving ? 'Adding…' : 'Add Investor'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Investment mode toggle */}
        <div>
          <SegControl
            value={mode}
            onChange={setMode}
            options={[
              { value: 'share_split',   label: 'Share Split' },
              { value: 'custom_amount', label: 'Custom Amount' },
              { value: 'fully_manual',  label: 'Manual' },
            ]}
          />
          <p className="text-[11px] text-gray-500 mt-2 px-1">
            {isManualMode
              ? 'Type both fields independently. No auto-fill — use this when amount and profit share have no fixed relationship.'
              : isCustomMode
              ? 'Enter the actual amount; share % auto-derives from amount / pool. Override the share to make profit splits unequal (e.g., equal share despite different amounts).'
              : 'Share % auto-fills the committed amount from the project pool. Everyone\'s commitment scales with their share.'}
          </p>
        </div>

        {/* Pool info */}
        <div className="bg-blue-50 rounded-xl px-3 py-2.5 text-xs text-blue-800">
          <p className="font-semibold">Pool = {inr(projectValue)}
            <span className="font-normal text-blue-500 ml-1">({stakePercent}% of {inr(projectTotalValue)})</span>
          </p>
          <p className="text-blue-500 mt-0.5">
            {isCustomMode
              ? `Informational only in Custom mode · ${remainingShare.toFixed(1)}% profit share still available`
              : `Share % splits this pool · ${remainingShare.toFixed(1)}% still available`}
          </p>
        </div>

        {/* Required fields */}
        <Field label="Full Name *">
          <input className="input" placeholder="e.g. Ravi Kumar" value={form.name}
            onChange={e => set('name', e.target.value)} autoFocus required />
        </Field>

        <Field label="Email *">
          <input
            className="input"
            type="email"
            placeholder="investor@email.com"
            value={form.email}
            onChange={e => set('email', e.target.value)}
            required
          />
          <p className="text-[10px] text-gray-400 mt-1">
            Required — used to link this investor to their portfolio when they log in. They also get a Viewer invite to this project.
          </p>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          {mode === 'share_split' ? (
            <>
              <Field label="Share % *">
                <input className="input" type="number" step="0.01" min="0.01"
                  max={remainingShare} placeholder="25"
                  value={form.share_percent} onChange={e => handleShare(e.target.value)} />
              </Field>
              <Field label="Committed Amount (₹) *">
                <input className="input" type="number" placeholder="0"
                  value={form.amount_invested}
                  onChange={e => set('amount_invested', e.target.value)} />
                <p className="text-[10px] text-gray-400 mt-1">Auto-filled from share. Editable.</p>
              </Field>
            </>
          ) : (
            <>
              <Field label="Committed Amount (₹) *">
                <input className="input" type="number" placeholder="0"
                  value={form.amount_invested}
                  onChange={e => handleAmount(e.target.value)} autoFocus />
                <p className="text-[10px] text-gray-400 mt-1">
                  {isManualMode ? 'Their contribution. No auto-fill.' : 'Their actual contribution. Share % derives from amount / pool.'}
                </p>
              </Field>
              <Field label="Profit Share % *">
                <input className="input" type="number" step="0.01" min="0.01"
                  max={remainingShare}
                  placeholder={isManualMode ? '33.33' : 'auto'}
                  value={form.share_percent} onChange={e => set('share_percent', e.target.value)} />
                <p className="text-[10px] text-gray-400 mt-1">
                  {isManualMode ? 'Type manually. Drives profit / expense split.' : 'Auto from amount. Override for unequal splits.'}
                </p>
              </Field>
            </>
          )}
        </div>

        {/* Optional fields */}
        <Collapsible label="Optional details" icon="📋">
          <Field label="Phone">
            <input className="input" type="tel" placeholder="+91 98765 43210"
              value={form.phone} onChange={e => set('phone', e.target.value)} />
            <p className="text-[10px] text-gray-400 mt-1">
              Shared with all this person's records in the Investors tab.
            </p>
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

function AddProfitSheet({ open, onClose, projectId, investors = [], onSaved }) {
  const [form, setForm]     = useState({ amount: '', record_date: isoDate(), notes: '' })
  const [splitMode, setSplitMode] = useState('default') // 'default' or 'custom'
  const [customDist, setCustomDist] = useState({}) // { [investor_id]: amount }
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const amount = parseFloat(form.amount) || 0
  const isCustom = splitMode === 'custom'

  // When switching to custom or amount changes, seed proportional defaults so user can tweak from there
  const seedCustomFromProportional = (amt) => {
    const seeded = {}
    for (const inv of investors) {
      seeded[inv.investor_id] = Math.round(amt * (inv.share_percent || 0) / 100)
    }
    setCustomDist(seeded)
  }

  const setCustomAmount = (investorId, v) => {
    setCustomDist(prev => ({ ...prev, [investorId]: parseFloat(v) || 0 }))
  }

  const customTotal = Object.values(customDist).reduce((s, v) => s + (Number(v) || 0), 0)
  const customMatch = Math.abs(customTotal - amount) < 1

  const submit = async () => {
    if (!amount) { setError('Amount required'); return }
    if (isCustom && !customMatch) { setError(`Custom amounts must sum to ${form.amount}`); return }
    setSaving(true); setError(null)
    try {
      const distributions = isCustom
        ? investors.map(inv => ({ investor_id: inv.investor_id, amount: customDist[inv.investor_id] || 0 }))
        : null
      await createProfitRecord({
        project_id:    projectId,
        amount,
        record_date:   form.record_date,
        notes:         form.notes || null,
        distributions,
      })
      setForm({ amount: '', record_date: isoDate(), notes: '' })
      setCustomDist({})
      setSplitMode('default')
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
      <div className="space-y-4">
        <Field label="Profit Amount (₹) *">
          <input className="input" type="number" placeholder="0" value={form.amount}
            onChange={e => {
              set('amount', e.target.value)
              if (isCustom) seedCustomFromProportional(parseFloat(e.target.value) || 0)
            }} autoFocus />
        </Field>

        <div>
          <label className="label">Split</label>
          <SegControl
            value={splitMode}
            onChange={(v) => {
              setSplitMode(v)
              if (v === 'custom') seedCustomFromProportional(amount)
            }}
            options={[
              { value: 'default', label: 'By share %' },
              { value: 'custom',  label: 'Custom' },
            ]}
          />
          <p className="text-[11px] text-gray-500 mt-2 px-1">
            {isCustom
              ? 'Type each investor\'s portion. Amounts must sum to the total.'
              : 'Splits proportionally by each investor\'s share %.'}
          </p>
        </div>

        {isCustom && investors.length > 0 && (
          <div>
            <label className="label">Per-Investor Amount</label>
            <div className="space-y-2">
              {investors.map(inv => (
                <div key={inv.investor_id} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                  <span className="text-sm text-gray-700 flex-1">{inv.investor_name}
                    <span className="text-xs text-gray-400 ml-1">({inv.share_percent}%)</span>
                  </span>
                  <span className="text-gray-400 text-sm">₹</span>
                  <input type="number"
                    className="w-28 bg-white border border-gray-200 rounded-lg px-2 py-1 text-sm text-right font-mono"
                    value={customDist[inv.investor_id] ?? ''}
                    onChange={e => setCustomAmount(inv.investor_id, e.target.value)} />
                </div>
              ))}
              <div className={`flex justify-between text-xs px-1 font-semibold ${customMatch ? 'text-emerald-600' : 'text-red-500'}`}>
                <span>Total distributed</span>
                <span>{inr(customTotal)} / {inr(amount)} {customMatch ? '✓' : '✗'}</span>
              </div>
            </div>
          </div>
        )}

        <Field label="Date">
          <input className="input" type="date" value={form.record_date} onChange={e => set('record_date', e.target.value)} />
        </Field>
        <Field label="Notes">
          <textarea className="input resize-none" rows={2} placeholder="e.g. Q1 rental income" value={form.notes} onChange={e => set('notes', e.target.value)} />
        </Field>
      </div>
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

        {/* PAID BY — moved to the top so it's not missed. Quick-pick buttons
            cover the typical case (one of the investors paid). Selecting an
            investor here auto-credits them with the full amount in their
            payment ledger; the expense itself still splits by share %.       */}
        <Field label="Paid by *">
          <div className="grid grid-cols-2 gap-2">
            <button type="button"
              onClick={() => set('paid_by_investor_id', '')}
              className={`text-xs py-2 px-3 rounded-xl border text-left transition-all
                ${!form.paid_by_investor_id
                  ? 'border-brand-900 bg-brand-50 text-brand-900 font-semibold'
                  : 'border-gray-200 text-gray-600'}`}>
              🏛️ Project funds
            </button>
            {investors.map(inv => (
              <button key={inv.investor_id} type="button"
                onClick={() => set('paid_by_investor_id', inv.investor_id)}
                className={`text-xs py-2 px-3 rounded-xl border text-left transition-all
                  ${form.paid_by_investor_id === inv.investor_id
                    ? 'border-blue-500 bg-blue-50 text-blue-800 font-semibold'
                    : 'border-gray-200 text-gray-600'}`}>
                <span className="truncate block">{inv.investor_name}</span>
                <span className="text-[10px] text-gray-400">{inv.share_percent}% share</span>
              </button>
            ))}
          </div>
          {form.paid_by_investor_id ? (
            <p className="text-[10px] text-blue-700 mt-2 bg-blue-50 rounded-lg px-2 py-1.5">
              ✓ The selected investor is credited with the full amount in their payment ledger. The expense itself still splits by share %, so other investors absorb their share.
            </p>
          ) : (
            <p className="text-[10px] text-gray-500 mt-1.5">No investor is credited — the expense reduces the project's net profit and everyone absorbs their share.</p>
          )}
        </Field>

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

// ── Move Investor Position Sheet ──────────────────────────────
function MoveInvestorPositionSheet({ investor, projects = [], currentProjectId, onClose, onSaved }) {
  const [destProjectId, setDestProjectId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate]     = useState(isoDate())
  const [notes, setNotes]   = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  // Only allow destinations where this investor already exists (matched
  // case + whitespace insensitive). If they need to move to a new project,
  // they add the investor on that project first via Add Investor.
  const allInvestorsHook = useAllInvestors()
  const normalize = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const sourceNameKey = normalize(investor.investor_name)
  const validDestProjects = projects.filter(p =>
    p.id !== currentProjectId &&
    (allInvestorsHook.data ?? []).some(i =>
      i.project_id === p.id && normalize(i.name) === sourceNameKey
    )
  )
  const destProject = validDestProjects.find(p => p.id === destProjectId)

  const submit = async () => {
    if (!destProjectId) { setError('Pick a destination project'); return }
    if (!amount || parseFloat(amount) <= 0) { setError('Amount must be positive'); return }
    setSaving(true); setError(null)
    try {
      // Master Audit Phase C — Item 3: the RPC no longer accepts a null
      // destination investor. The dropdown is already filtered to valid
      // destinations so we can look up the UUID locally — but if it
      // somehow comes up empty, fail loudly here rather than hitting the
      // RPC's hard-abort message.
      const destInv = (allInvestorsHook.data ?? []).find(i =>
        i.project_id === destProjectId && sourceNameKey === normalize(i.name)
      )
      if (!destInv) {
        throw new Error(`No investor named "${investor.investor_name}" on the destination project. Add them there first.`)
      }
      await reallocateInvestorPosition({
        sourceInvestorId: investor.investor_id,
        destProjectId,
        destInvestorId:   destInv.id,
        amount: parseFloat(amount),
        date,
        notes: notes || null,
      })
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet open={true} onClose={onClose} title="Move Investor Position"
      footer={
        <div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2">{error}</p>}
          <button type="button" onClick={submit} className="btn-primary w-full" disabled={saving}>
            {saving ? 'Moving…' : 'Move Position'}
          </button>
        </div>
      }>
      <div className="space-y-4">
        <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-800">
          <p className="font-semibold mb-1">From {investor.investor_name} ({investor.share_percent}% share)</p>
          <p className="text-blue-600">on this project → destination project</p>
          <p className="text-[11px] text-blue-500 mt-1">
            Creates a refund here and a top-up there. Destination must already have an investor with the same name — add them there first if not.
          </p>
        </div>

        <Field label="Destination Project *">
          <select className="input" value={destProjectId}
            onChange={e => setDestProjectId(e.target.value)}
            disabled={validDestProjects.length === 0}
            autoFocus>
            <option value="">
              {validDestProjects.length === 0
                ? `No other project has ${investor.investor_name} as an investor`
                : 'Pick a project'}
            </option>
            {validDestProjects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {validDestProjects.length === 0 && (
            <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5 mt-2">
              Only projects where {investor.investor_name} already exists are listed. Add them as an investor on the destination project first, then try again.
            </p>
          )}
        </Field>

        <Field label="Amount (₹) *">
          <input className="input" type="number" placeholder="0" value={amount}
            onChange={e => setAmount(e.target.value)} />
        </Field>

        <Field label="Date">
          <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
        </Field>

        <Field label="Notes">
          <textarea className="input resize-none" rows={2}
            placeholder={destProject ? `e.g. Profit + capital from completed project → ${destProject.name}` : 'Optional…'}
            value={notes} onChange={e => setNotes(e.target.value)} />
        </Field>

        {destProject && amount > 0 && (
          <div className="bg-gray-50 rounded-xl p-3 text-xs space-y-1.5">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Preview</p>
            <div className="flex justify-between"><span className="text-red-500">− Refund here</span><span className="font-mono font-semibold">{inr(parseFloat(amount))}</span></div>
            <div className="flex justify-between"><span className="text-emerald-600">+ Top-up on {destProject.name}</span><span className="font-mono font-semibold">{inr(parseFloat(amount))}</span></div>
            <p className="text-[10px] text-gray-400 pt-1 border-t border-gray-200">Both rows are linked so the move is traceable from either side.</p>
          </div>
        )}
      </div>
    </Sheet>
  )
}

// ── Lend to another Investor Sheet (inter-investor loan) ─────
function LendToInvestorSheet({ source, allInvestors = [], projectNameById = {}, onClose, onSaved }) {
  const [destInvestorId, setDestInvestorId] = useState('')
  const [amount, setAmount]                 = useState('')
  const [interestPct, setInterestPct]       = useState('')
  const [date, setDate]                     = useState(isoDate())
  const [notes, setNotes]                   = useState('')
  const [saving, setSaving]                 = useState(false)
  const [error, setError]                   = useState(null)

  const dest = allInvestors.find(i => i.id === destInvestorId)
  const principal = parseFloat(amount) || 0
  const interest  = parseFloat(interestPct) || 0
  const totalDue  = principal + (principal * interest / 100)

  // Pickable destinations: everyone except the source
  const options = allInvestors.filter(i => i.id !== source.investor_id)

  const submit = async () => {
    if (!destInvestorId) { setError('Pick a destination investor'); return }
    if (principal <= 0)  { setError('Amount must be positive'); return }
    setSaving(true); setError(null)
    try {
      await transferFundsAsLoan({
        sourceInvestorId: source.investor_id,
        destInvestorId,
        amount: principal,
        interestPct: interest,
        date,
        notes: notes || null,
      })
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet open={true} onClose={onClose} title="Lend to Another Investor"
      footer={
        <div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2">{error}</p>}
          <button type="button" onClick={submit} className="btn-primary w-full" disabled={saving}>
            {saving ? 'Recording…' : 'Record Loan'}
          </button>
        </div>
      }>
      <div className="space-y-4">
        <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-800">
          <p className="font-semibold mb-1">{source.investor_name} → ?</p>
          <p>A refund lands on {source.investor_name}&apos;s ledger, a top-up on the destination investor&apos;s. A loan record is created so the destination owes the source.</p>
        </div>

        <Field label="Destination Investor *">
          <select className="input" value={destInvestorId} onChange={e => setDestInvestorId(e.target.value)} autoFocus>
            <option value="">Pick a person</option>
            {options.map(i => (
              <option key={i.id} value={i.id}>
                {i.name} · {projectNameById[i.project_id] ?? 'project'}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₹) *">
            <input className="input" type="number" placeholder="0" value={amount}
              onChange={e => setAmount(e.target.value)} />
          </Field>
          <Field label="Interest (flat %)">
            <input className="input" type="number" step="0.01" placeholder="0" value={interestPct}
              onChange={e => setInterestPct(e.target.value)} />
          </Field>
        </div>

        {principal > 0 && interest > 0 && (
          <div className="bg-blue-50 rounded-xl px-3 py-2 text-xs text-blue-800 flex justify-between">
            <span>Total due back from borrower</span>
            <span className="font-bold mono">{inr(totalDue)}</span>
          </div>
        )}

        <Field label="Date">
          <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
        </Field>

        <Field label="Notes">
          <textarea className="input resize-none" rows={2}
            placeholder="e.g. Profit redeployed from House to fund KCL share"
            value={notes} onChange={e => setNotes(e.target.value)} />
        </Field>

        {dest && principal > 0 && (
          <div className="bg-gray-50 rounded-xl p-3 text-xs space-y-1.5">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Preview</p>
            <div className="flex justify-between">
              <span className="text-red-500">− Refund on {source.investor_name} ({projectNameById[source.project_id] ?? 'source'})</span>
              <span className="font-mono font-semibold">{inr(principal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-emerald-600">+ Top-up on {dest.name} ({projectNameById[dest.project_id] ?? 'dest'})</span>
              <span className="font-mono font-semibold">{inr(principal)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-200 pt-1">
              <span className="text-amber-700">+ Loan record (Cash Flow): {dest.name} owes {source.investor_name}</span>
              <span className="font-mono font-semibold">{inr(totalDue)}</span>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}

// ── Edit Investor Sheet ───────────────────────────────────────
function EditInvestorSheet({ investor, onClose, onSaved }) {
  const [form, setForm]   = useState({
    name:            investor.investor_name ?? '',
    share_percent:   investor.share_percent ?? '',
    amount_invested: investor.amount_invested ?? '',
    notes:           investor.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    setSaving(true); setError(null)
    try {
      await updateInvestor(investor.investor_id, {
        name:            form.name,
        share_percent:   parseFloat(form.share_percent),
        amount_invested: parseFloat(form.amount_invested),
        notes:           form.notes || null,
      })
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet open={true} onClose={onClose} title="Edit Investor"
      footer={
        <div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2">{error}</p>}
          <button type="button" onClick={submit} className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      }>
      <div className="space-y-4">
        <Field label="Full Name *">
          <input className="input" value={form.name} onChange={e => set('name', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Share % *">
            <input className="input" type="number" step="0.01" value={form.share_percent} onChange={e => set('share_percent', e.target.value)} />
          </Field>
          <Field label="Committed Amount (₹) *">
            <input className="input" type="number" value={form.amount_invested} onChange={e => set('amount_invested', e.target.value)} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea className="input resize-none" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
        </Field>
        <p className="text-[10px] text-gray-400">Editing commitment doesn&apos;t change the payment ledger. Add or refund payments separately via + Payment.</p>
      </div>
    </Sheet>
  )
}

// ── Edit Profit Sheet ─────────────────────────────────────────
function EditProfitSheet({ record, onClose, onSaved }) {
  const [form, setForm]   = useState({
    amount:      record.amount ?? '',
    record_date: record.record_date ?? isoDate(),
    notes:       record.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    setSaving(true); setError(null)
    try {
      await updateProfitRecord(record.id, {
        amount:      parseFloat(form.amount),
        record_date: form.record_date,
        notes:       form.notes || null,
      })
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet open={true} onClose={onClose} title="Edit Profit Record"
      footer={
        <div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2">{error}</p>}
          <button type="button" onClick={submit} className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      }>
      <div className="space-y-4">
        <Field label="Profit Amount (₹) *">
          <input className="input" type="number" value={form.amount} onChange={e => set('amount', e.target.value)} />
          <p className="text-[10px] text-gray-400 mt-1">If amount changes, existing per-investor distributions scale proportionally.</p>
        </Field>
        <Field label="Date">
          <input className="input" type="date" value={form.record_date} onChange={e => set('record_date', e.target.value)} />
        </Field>
        <Field label="Notes">
          <textarea className="input resize-none" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
        </Field>
      </div>
    </Sheet>
  )
}

// ── Edit Expense Sheet ────────────────────────────────────────
function EditExpenseSheet({ expense, investors = [], onClose, onSaved }) {
  const [form, setForm]   = useState({
    amount:              expense.amount ?? '',
    category:            expense.category ?? 'other',
    description:         expense.description ?? '',
    expense_date:        expense.expense_date ?? isoDate(),
    notes:               expense.notes ?? '',
    paid_by_investor_id: expense.paid_by_investor_id ?? '',
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

  const submit = async () => {
    setSaving(true); setError(null)
    try {
      await updateExpense(expense.id, {
        amount:              parseFloat(form.amount),
        category:            form.category,
        description:         form.description,
        expense_date:        form.expense_date,
        notes:               form.notes || null,
        paid_by_investor_id: form.paid_by_investor_id || null,
      })
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet open={true} onClose={onClose} title="Edit Expense"
      footer={
        <div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2">{error}</p>}
          <button type="button" onClick={submit} className="btn-primary w-full" disabled={saving} style={{ background: '#dc2626' }}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      }>
      <div className="space-y-4">
        <Field label="Category">
          <select className="input" value={form.category} onChange={e => set('category', e.target.value)}>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Description *">
          <input className="input" value={form.description} onChange={e => set('description', e.target.value)} />
        </Field>
        <Field label="Amount (₹) *">
          <input className="input" type="number" value={form.amount} onChange={e => set('amount', e.target.value)} />
        </Field>
        <Field label="Date">
          <input className="input" type="date" value={form.expense_date} onChange={e => set('expense_date', e.target.value)} />
        </Field>
        <Field label="Paid by">
          <select className="input" value={form.paid_by_investor_id} onChange={e => set('paid_by_investor_id', e.target.value)}>
            <option value="">Project funds</option>
            {investors.map(inv => <option key={inv.investor_id} value={inv.investor_id}>{inv.investor_name} ({inv.share_percent}%)</option>)}
          </select>
          <p className="text-[10px] text-gray-400 mt-1">Changes here update the linked investor_payment too.</p>
        </Field>
        <Field label="Notes">
          <textarea className="input resize-none" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
        </Field>
      </div>
    </Sheet>
  )
}

// ── Edit Payment Sheet ────────────────────────────────────────
function EditPaymentSheet({ payment, onClose, onSaved }) {
  const [form, setForm]   = useState({
    amount:       payment.amount ?? '',
    payment_date: payment.payment_date ?? isoDate(),
    notes:        payment.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    setSaving(true); setError(null)
    try {
      await updatePayment(payment.id, {
        amount:       parseFloat(form.amount),
        payment_date: form.payment_date,
        notes:        form.notes || null,
      })
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet open={true} onClose={onClose} title={`Edit ${PAYMENT_TYPE_LABEL[payment.payment_type] || 'Payment'}`}
      footer={
        <div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2">{error}</p>}
          <button type="button" onClick={submit} className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      }>
      <div className="space-y-4">
        <p className="text-xs text-gray-400">Payment type is fixed at <strong>{payment.payment_type}</strong>. To change the type, delete and re-create.</p>
        <Field label="Amount (₹) *">
          <input className="input" type="number" value={form.amount} onChange={e => set('amount', e.target.value)} />
        </Field>
        <Field label="Date">
          <input className="input" type="date" value={form.payment_date} onChange={e => set('payment_date', e.target.value)} />
        </Field>
        <Field label="Notes">
          <textarea className="input resize-none" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
        </Field>
      </div>
    </Sheet>
  )
}

// ── Edit Move Sheet (paired refund + top_up) ──────────────────
function EditMoveSheet({ refund, projectNameById, onClose, onSaved }) {
  const [form, setForm]   = useState({
    amount:       refund.amount ?? '',
    payment_date: refund.payment_date ?? isoDate(),
    notes:        refund.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const destName = projectNameById?.[refund.destination_project_id] ?? '?'

  const submit = async () => {
    setSaving(true); setError(null)
    try {
      await updateMove({
        refundId: refund.id,
        amount:   parseFloat(form.amount),
        date:     form.payment_date,
        notes:    form.notes || null,
      })
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet open={true} onClose={onClose} title="Edit Move"
      footer={
        <div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2">{error}</p>}
          <button type="button" onClick={submit} className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      }>
      <div className="space-y-4">
        <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-800">
          <p className="font-semibold">Linked move</p>
          <p>This edits both the refund here and the top-up on <strong>{destName}</strong> together.</p>
        </div>
        <Field label="Amount (₹) *">
          <input className="input" type="number" value={form.amount} onChange={e => set('amount', e.target.value)} />
        </Field>
        <Field label="Date">
          <input className="input" type="date" value={form.payment_date} onChange={e => set('payment_date', e.target.value)} />
        </Field>
        <Field label="Notes">
          <textarea className="input resize-none" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
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
  // Audit 2.2: scaling is now opt-in. The trigger has been dropped at the
  // DB level so silent overwrites can't happen. If the user wants
  // commitments to follow the new pool, this checkbox kicks in a frontend
  // batch update of each investor's amount_invested.
  const [scaleInvestors, setScaleInvestors] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const oldPool = (project?.total_value ?? 0) * (project?.our_stake_percent ?? 100) / 100
  const newPool = (parseFloat(form.total_value) || 0) * (parseFloat(form.our_stake_percent) || 100) / 100
  const poolChanged = Math.abs(newPool - oldPool) >= 0.5

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
      // Explicit scaling — only if pool actually shifted AND user opted in.
      if (poolChanged && scaleInvestors && oldPool > 0) {
        const ratio = newPool / oldPool
        const { data: invs, error: invErr } = await supabase
          .from('investors').select('id, amount_invested').eq('project_id', project.id)
        if (invErr) throw invErr
        for (const inv of (invs ?? [])) {
          const newAmt = Math.round(Number(inv.amount_invested || 0) * ratio * 100) / 100
          await updateInvestor(inv.id, { amount_invested: newAmt })
        }
      }
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
        {poolChanged && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs space-y-2">
            <p className="text-amber-800 font-semibold">
              Pool is changing from {inr(oldPool)} to {inr(newPool)} ({newPool > oldPool ? '+' : ''}{inr(newPool - oldPool)}).
            </p>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={scaleInvestors}
                onChange={e => setScaleInvestors(e.target.checked)}
                className="mt-0.5" />
              <span className="text-amber-700">
                Scale every investor&apos;s committed amount by {(newPool / oldPool).toFixed(3)}×
                so their share % stays consistent.
                {!scaleInvestors && (
                  <span className="block text-amber-600 mt-1">
                    Unchecked: existing commitments stay as-is. Investors who fully paid will now
                    show as overpaid; new commitments may go to "Owes". Use when only renaming /
                    re-categorizing the project.
                  </span>
                )}
              </span>
            </label>
          </div>
        )}
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

// ── Close & Settle Wizard ─────────────────────────────────────
//
// End-of-project settlement flow. Lists each investor's position and
// lets the owner:
//   - Pay out all overpayment refunds in one shot (creates type=refund
//     payments with no destination_project_id — external cash back)
//   - Tick off each underpaid investor as "collected" (creates a
//     type=share_contribution payment for the owed amount)
//   - Mark the project completed only when everyone is settled (or
//     written off explicitly)
//
// All actions go through the same hooks the rest of the app uses, so
// the per-investor ledger / Portfolio totals update automatically.
function CloseSettleSheet({ projectId, onClose, onCompleted }) {
  const settlement = useProjectSettlement(projectId)
  const [busy, setBusy] = useState(null)         // 'refunds' | 'complete' | <investor_id>
  const [error, setError] = useState(null)
  const [writeOff, setWriteOff] = useState({})   // {investor_id: true} — owner explicitly waives the owe

  if (settlement.loading) {
    return (
      <Sheet open onClose={onClose} title="Close & Settle">
        <div className="py-12 flex items-center justify-center"><Spinner size="lg" /></div>
      </Sheet>
    )
  }
  if (settlement.error || !settlement.data) {
    return (
      <Sheet open onClose={onClose} title="Close & Settle">
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
          {settlement.error || 'Could not load settlement data.'}
        </p>
      </Sheet>
    )
  }

  const s = settlement.data
  const overpaid  = s.investors.filter(i => i.refundDue > 0.5)
  const underpaid = s.investors.filter(i => i.owes > 0.5)
  const settled   = s.investors.filter(i => i.settled)

  // Effectively-settled = settled OR written-off
  const allEffectivelySettled = s.investors.every(i =>
    i.settled || (i.owes > 0.5 && writeOff[i.id]) || i.refundDue < 0.5
  )
  const noRefundsPending = overpaid.length === 0

  // ── Action: payout all overpayments at once ──
  const handlePayoutAll = async () => {
    setBusy('refunds'); setError(null)
    try {
      for (const inv of overpaid) {
        await payoutSettlementRefund({
          investorId: inv.id,
          projectId,
          amount: Math.round(inv.refundDue * 100) / 100,
        })
      }
      settlement.reload()
    } catch (e) { setError(e.message) } finally { setBusy(null) }
  }

  // ── Action: collect owes from a specific investor (mark received) ──
  const handleCollect = async (inv) => {
    setBusy(inv.id); setError(null)
    try {
      await collectSettlementOwes({
        investorId: inv.id,
        projectId,
        amount: Math.round(inv.owes * 100) / 100,
      })
      settlement.reload()
    } catch (e) { setError(e.message) } finally { setBusy(null) }
  }

  // ── Action: mark project completed (only when all settled) ──
  const handleMarkCompleted = async () => {
    if (!allEffectivelySettled) {
      setError('Settle or write off every investor first.')
      return
    }
    setBusy('complete'); setError(null)
    try {
      await updateProject(projectId, { status: 'completed' })
      onCompleted()
    } catch (e) { setError(e.message) } finally { setBusy(null) }
  }

  return (
    <Sheet open onClose={onClose} title="Close & Settle Project"
      footer={
        <div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2">{error}</p>}
          <button
            type="button"
            onClick={handleMarkCompleted}
            disabled={busy === 'complete' || !allEffectivelySettled}
            className="btn-primary w-full"
          >
            {busy === 'complete' ? 'Marking…'
              : allEffectivelySettled ? 'Mark Project Completed'
              : `Settle ${overpaid.length + underpaid.filter(i => !writeOff[i.id]).length} more to complete`}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Project total summary */}
        <div className="bg-blue-50 rounded-2xl p-4 text-[12px] text-blue-900">
          <p className="font-semibold mb-2">Settlement basis</p>
          <table className="w-full">
            <tbody>
              <tr><td>Property pool</td><td className="text-right font-mono">{inr(Math.round(s.ourPool))}</td></tr>
              <tr><td>+ Total expenses to date</td><td className="text-right font-mono">{inr(Math.round(s.totalExpenses))}</td></tr>
              <tr className="border-t border-blue-200"><td className="pt-1 font-semibold">= Project total</td><td className="pt-1 text-right font-mono font-semibold">{inr(Math.round(s.projectTotal))}</td></tr>
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-blue-800">
            Each investor's commitment = their share % × project total.
            Refund / owes = (paid by them) − (their commitment).
          </p>
        </div>

        {/* Overpaid — refunds to pay out */}
        {overpaid.length > 0 && (
          <section>
            <div className="flex items-baseline justify-between mb-2 px-1">
              <h3 className="text-sm font-bold text-gray-900">Overpaid — pay refunds out</h3>
              <p className="font-mono font-semibold text-sm text-fintech-green">+ {inr(Math.round(s.totalRefundDue))}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100 overflow-hidden">
              {overpaid.map(inv => (
                <InvRow key={inv.id} inv={inv} kind="overpaid" />
              ))}
            </div>
            <button
              type="button"
              onClick={handlePayoutAll}
              disabled={busy === 'refunds'}
              className="mt-3 w-full text-center text-sm font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-xl py-2.5 active:scale-95 transition-transform disabled:opacity-50"
            >
              {busy === 'refunds' ? 'Paying out…' : `Pay refunds to ${overpaid.length} investor${overpaid.length === 1 ? '' : 's'} (${inr(Math.round(s.totalRefundDue))})`}
            </button>
          </section>
        )}

        {/* Underpaid — owes to collect */}
        {underpaid.length > 0 && (
          <section>
            <div className="flex items-baseline justify-between mb-2 px-1">
              <h3 className="text-sm font-bold text-gray-900">Underpaid — collect or write off</h3>
              <p className="font-mono font-semibold text-sm text-fintech-red">− {inr(Math.round(s.totalOwes))}</p>
            </div>
            <p className="text-[11px] text-gray-500 mb-2 px-1">
              Mark "Collected" once the cash is actually in your hands. "Write off" waives the obligation so the project can be closed without it.
            </p>
            <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100 overflow-hidden">
              {underpaid.map(inv => (
                <InvRow
                  key={inv.id}
                  inv={inv}
                  kind="underpaid"
                  busy={busy === inv.id}
                  onCollect={() => handleCollect(inv)}
                  writeOff={!!writeOff[inv.id]}
                  onToggleWriteOff={() => setWriteOff(w => ({ ...w, [inv.id]: !w[inv.id] }))}
                />
              ))}
            </div>
          </section>
        )}

        {/* Already settled */}
        {settled.length > 0 && (
          <section>
            <div className="flex items-baseline justify-between mb-2 px-1">
              <h3 className="text-sm font-bold text-gray-900">Already settled</h3>
              <p className="text-[11px] text-gray-500">{settled.length} investor{settled.length === 1 ? '' : 's'}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100 overflow-hidden">
              {settled.map(inv => (
                <InvRow key={inv.id} inv={inv} kind="settled" />
              ))}
            </div>
          </section>
        )}

        {s.investors.length === 0 && (
          <Empty icon="🧑‍💼" title="No investors on this project" />
        )}

        {/* Status hint */}
        <div className={`rounded-xl px-3 py-2 text-[11px] ${
          allEffectivelySettled
            ? 'bg-emerald-50 text-emerald-800 border border-emerald-100'
            : 'bg-amber-50 text-amber-800 border border-amber-100'
        }`}>
          {allEffectivelySettled
            ? '✓ Every investor is settled or written off — you can mark the project completed below.'
            : '⏳ Some investors still have outstanding refunds or owes. Resolve each above before marking the project completed.'}
        </div>
      </div>
    </Sheet>
  )
}

// ── Investor row inside Close & Settle wizard ─────────────────
function InvRow({ inv, kind, busy, onCollect, writeOff, onToggleWriteOff }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-gray-900 text-sm truncate">{inv.name}</p>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
              {inv.share_percent}%
            </span>
            {kind === 'settled' && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-fintech-green">Settled</span>
            )}
            {kind === 'overpaid' && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-fintech-green">
                Refund due {inr(Math.round(inv.refundDue))}
              </span>
            )}
            {kind === 'underpaid' && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-fintech-red">
                Owes {inr(Math.round(inv.owes))}
              </span>
            )}
            {kind === 'underpaid' && writeOff && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">
                Written off
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Paid <span className="font-mono">{inr(Math.round(inv.paidNet))}</span>
            {' · Commitment '}<span className="font-mono">{inr(Math.round(inv.scaledCommitment))}</span>
          </p>
        </div>
        {kind === 'underpaid' && (
          <div className="flex flex-col gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={onCollect}
              disabled={busy || writeOff}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-brand-50 text-brand-900 hover:bg-brand-100 disabled:opacity-50 whitespace-nowrap"
            >
              {busy ? 'Collecting…' : '✓ Collected'}
            </button>
            <button
              type="button"
              onClick={onToggleWriteOff}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap ${
                writeOff
                  ? 'bg-gray-300 text-gray-700'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {writeOff ? 'Undo' : 'Write off'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── HeaderMetric ───────────────────────────────────────────────
// Compact header metric tile used in the dark project header strip.
// Renders the value as inrCompact() so big numbers don't overflow
// the 3-column grid on narrow phones, with the full-precision value
// available on hover via the title attribute.
function HeaderMetric({ label, value, fullValue, sub, subTitle, prefix = '', tone }) {
  const toneClass =
    tone === 'good'      ? 'text-emerald-300' :
    tone === 'bad'       ? 'text-red-300'     :
    tone === 'extracted' ? 'text-blue-200'    :
    tone === 'muted'     ? 'text-white/60'    :
                           ''
  return (
    <div className="bg-white/10 rounded-xl p-2.5 sm:p-3 text-center min-w-0">
      <p className="text-brand-100 text-[10px] sm:text-xs mb-0.5 truncate">{label}</p>
      <p
        title={fullValue}
        className={`font-bold mono leading-tight tabular-nums whitespace-nowrap overflow-hidden text-ellipsis text-xs sm:text-sm lg:text-base ${toneClass}`}
      >
        {prefix}{inrCompact(value)}
      </p>
      {sub && (
        <p
          title={subTitle ?? undefined}
          className="text-[9px] text-white/60 mt-0.5 truncate"
        >
          {sub}
        </p>
      )}
    </div>
  )
}
