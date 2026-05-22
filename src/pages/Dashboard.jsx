// src/pages/Dashboard.jsx
import { useNavigate } from 'react-router-dom'
import { useDashboard, useMyInvestments, useAllInvestorsSummary, useInvestorLedger } from '../hooks/useData'
import { acceptPendingInvites } from '../hooks/useSharing'
import { inr, pct } from '../lib/supabase'
import { StatCard, Spinner, Empty } from '../components/ui'
import InviteBanner from '../components/InviteBanner'
import { useEffect, useState, useMemo } from 'react'
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend,
} from 'recharts'

const CHART_PALETTE = ['#1e3a8a', '#0891b2', '#0d9488', '#65a30d', '#ca8a04', '#dc2626', '#9333ea', '#db2777']

export default function Dashboard() {
  const { summary, projects, loading } = useDashboard()
  const navigate = useNavigate()
  const myInvestments      = useMyInvestments()
  const investorsSummary   = useAllInvestorsSummary()

  // Auto-accept any pending invites when user lands on dashboard
  useEffect(() => { acceptPendingInvites() }, [])

  const active   = projects.data.filter(p => p.status === 'active')
  const upcoming = projects.data.filter(p => p.status === 'upcoming')

  return (
    <div className="page-enter">
      {/* Portfolio banner */}
      <div className="bg-brand-900 text-white px-5 lg:px-8 pt-14 lg:pt-8 pb-8">
        <p className="text-brand-100 text-sm mb-1">Total Portfolio Value</p>
        <p className="text-4xl lg:text-5xl font-bold mono mb-6">{inr(summary.totalValue)}</p>
        <div className="grid grid-cols-3 gap-3 lg:max-w-2xl">
          <div className="bg-white/10 rounded-2xl p-3 text-center">
            <p className="text-brand-100 text-xs mb-1">Invested</p>
            <p className="font-bold mono text-sm">{inr(summary.totalInvested)}</p>
          </div>
          <div className="bg-white/10 rounded-2xl p-3 text-center">
            <p className="text-brand-100 text-xs mb-1">Profit</p>
            <p className={`font-bold mono text-sm ${summary.totalProfit >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
              {inr(summary.totalProfit)}
            </p>
          </div>
          <div className="bg-white/10 rounded-2xl p-3 text-center">
            <p className="text-brand-100 text-xs mb-1">Return</p>
            <p className="font-bold mono text-sm">{pct(summary.returnPct)}</p>
          </div>
        </div>
      </div>

      {/* Pending invites */}
      <InviteBanner />

      <div className="px-4 lg:px-8 py-5 space-y-6">
        {loading ? (
          <div className="flex justify-center py-10"><Spinner size="lg" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard icon="🚀" label="Active Projects"  value={summary.activeProjects}   color="green" />
              <StatCard icon="⏳" label="Upcoming"         value={summary.upcomingProjects} color="blue" />
              <StatCard icon="↗"  label="Loans Given"      value={inr(summary.loansGiven)}   color="orange" />
              <StatCard icon="↙"  label="Loans Received"   value={inr(summary.loansReceived)} color="purple" />
            </div>

            {/* Portfolio allocation donut — interactive */}
            {projects.data.length > 0 && (
              <PortfolioDonut projects={projects.data} />
            )}

            {/* Investor positions across every project */}
            {investorsSummary.data.length > 0 && (
              <InvestorRunningTotals groups={investorsSummary.data} />
            )}

            {/* My investments across shared projects */}
            {myInvestments.data.length > 0 && (
              <section>
                <h2 className="font-bold text-gray-900 mb-3">My Investments</h2>
                <div className="space-y-2">
                  {myInvestments.data.map(inv => (
                    <div key={inv.investor_id} className="card p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-semibold text-gray-900 text-sm">{inv.project_name}</p>
                          <p className="text-xs text-gray-400">{inv.share_percent}% share · {inv.project_status}</p>
                        </div>
                        <span className={`badge-${inv.project_status}`}>{inv.project_status}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-center border-t border-gray-50 pt-2 mt-2">
                        {[
                          { l: 'Invested',    v: inr(inv.amount_invested) },
                          { l: 'Net Return',  v: inr(inv.net_return), g: inv.net_return >= 0 },
                          { l: 'Current Val', v: inr(inv.current_value) },
                        ].map(({ l, v, g }) => (
                          <div key={l}>
                            <p className={`text-xs font-bold mono ${g ? 'text-emerald-600' : 'text-gray-800'}`}>{v}</p>
                            <p className="text-[10px] text-gray-400 mt-0.5">{l}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {active.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-bold text-gray-900">Active Projects</h2>
                  <button onClick={() => navigate('/projects')} className="text-xs text-brand-900 font-medium">View all →</button>
                </div>
                <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                  {active.map(p => <ProjectCard key={p.id} project={p} />)}
                </div>
              </section>
            )}

            {upcoming.length > 0 && (
              <section>
                <h2 className="font-bold text-gray-900 mb-3">Upcoming Projects</h2>
                <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                  {upcoming.map(p => <ProjectCard key={p.id} project={p} />)}
                </div>
              </section>
            )}

            {active.length === 0 && upcoming.length === 0 && (
              <Empty icon="📊" title="No projects yet" sub="Create your first investment project"
                action={<button onClick={() => navigate('/projects')} className="btn-primary text-sm px-6 py-2.5">Add Project</button>} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Portfolio Allocation Donut (interactive) ─────────────────
function PortfolioDonut({ projects }) {
  const [hovered, setHovered] = useState(null)
  const data = useMemo(() => projects
    .filter(p => p.status !== 'completed')
    .map((p, i) => ({
      name:  p.name,
      value: Math.max(0, (p.total_raised ?? 0) + (p.total_profit ?? 0)),
      status: p.status,
      raised: p.total_raised ?? 0,
      profit: p.total_profit ?? 0,
    }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value), [projects])

  if (data.length === 0) return null
  const totalValue = data.reduce((s, d) => s + d.value, 0)
  const focused = hovered ?? data[0]
  const focusedPct = totalValue > 0 ? (focused.value / totalValue) * 100 : 0

  return (
    <section>
      <h2 className="font-bold text-gray-900 mb-3">Portfolio Allocation</h2>
      <div className="card p-4">
        <div className="flex items-center gap-4">
          <div className="relative flex-shrink-0" style={{ width: 140, height: 140 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%" cy="50%"
                  innerRadius={45}
                  outerRadius={68}
                  paddingAngle={2}
                  dataKey="value"
                  onMouseEnter={(_, idx) => setHovered(data[idx])}
                  onMouseLeave={() => setHovered(null)}
                >
                  {data.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} stroke="white" strokeWidth={2} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
              <p className="text-[9px] text-gray-400 uppercase tracking-wide">Total</p>
              <p className="text-sm font-bold mono text-brand-900">{inr(totalValue)}</p>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-900 truncate">{focused.name}</p>
            <p className="text-[10px] text-gray-400 mb-2">{focused.status} · {focusedPct.toFixed(1)}% of portfolio</p>
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-gray-500">Raised</span>
                <span className="font-semibold mono">{inr(focused.raised)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Profit</span>
                <span className="font-semibold mono text-emerald-600">+{inr(focused.profit)}</span>
              </div>
            </div>
            <p className="text-[10px] text-gray-300 mt-2">{hovered ? 'showing hovered slice' : 'hover or tap a slice'}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-3 pt-3 border-t border-gray-50">
          {data.map((d, i) => (
            <button key={d.name} type="button"
              onMouseEnter={() => setHovered(d)}
              onMouseLeave={() => setHovered(null)}
              className="flex items-center gap-1.5 text-[11px] text-left">
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
              <span className="text-gray-600 truncate">{d.name}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Investor running totals (cross-project) ──────────────────
function InvestorRunningTotals({ groups }) {
  const totals = groups.reduce((a, g) => ({
    committed:      a.committed      + g.totals.committed,
    paid:           a.paid           + g.totals.paid,
    profit:         a.profit         + g.totals.profit,
    expense_share:  a.expense_share  + g.totals.expense_share,
    outstanding:    a.outstanding    + g.totals.outstanding,
    loansGiven:     a.loansGiven     + (g.totals.loansGiven ?? 0),
    runningBalance: a.runningBalance + (g.totals.runningBalance ?? 0),
  }), { committed:0, paid:0, profit:0, expense_share:0, outstanding:0, loansGiven:0, runningBalance:0 })

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-gray-900">Investor Running Totals</h2>
        <span className="text-xs text-gray-400">{groups.length} {groups.length === 1 ? 'investor' : 'investors'}</span>
      </div>

      {/* Aggregate balance row — single headline number */}
      <div className="card p-5 mb-3 bg-brand-50 border-brand-100">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-brand-500 font-semibold">Total Running Balance</p>
            <p className="text-[10px] text-brand-400 mt-0.5">profit − expenses + net cash + outstanding loans owed back</p>
          </div>
          <p className={`font-bold mono text-2xl ${totals.runningBalance >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            {totals.runningBalance >= 0 ? '+' : ''}{inr(totals.runningBalance)}
          </p>
        </div>
        <div className="grid grid-cols-5 gap-1 text-center mt-4 pt-4 border-t border-brand-100">
          {[
            { l: 'Profit',     v: inr(totals.profit),               c: 'text-emerald-700' },
            { l: 'Expenses',   v: `-${inr(totals.expense_share)}`,   c: 'text-red-500' },
            { l: 'Net cash',   v: `${totals.paid >= 0 ? '+' : ''}${inr(totals.paid)}`, c: totals.paid >= 0 ? 'text-emerald-700' : 'text-red-500' },
            { l: 'Loans out',  v: inr(totals.loansGiven),           c: 'text-blue-700' },
            { l: 'Committed',  v: inr(totals.committed),             c: 'text-brand-900' },
          ].map(({l, v, c}) => (
            <div key={l}>
              <p className={`text-[11px] font-bold mono ${c}`}>{v}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{l}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {groups.map(g => <InvestorRow key={g.name} group={g} />)}
      </div>
    </section>
  )
}

function InvestorRow({ group }) {
  const [open, setOpen] = useState(false)
  const [showLedger, setShowLedger] = useState(false)
  const { name, totals, projectCount, projects } = group
  const runningBalance = totals.runningBalance ?? 0
  const balancePositive = runningBalance >= 0
  const investorIds = projects.map(p => p.investor_id)

  // Bar chart data for the expanded view — one bar per project, two series
  const chartData = projects.map(p => ({
    name:   p.project_name.length > 12 ? p.project_name.slice(0, 11) + '…' : p.project_name,
    Paid:   Math.round(p.paid),
    Profit: Math.round(p.profit),
  }))

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full text-left p-4">
        <div className="flex justify-between items-start">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 truncate">{name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{projectCount} project{projectCount === 1 ? '' : 's'} · {open ? 'tap to collapse' : 'tap for breakdown'}</p>
          </div>
          <div className="text-right ml-2">
            <p className={`font-bold mono text-lg ${balancePositive ? 'text-emerald-600' : 'text-red-500'}`}>
              {balancePositive ? '+' : ''}{inr(runningBalance)}
            </p>
            <p className="text-[10px] text-gray-400">running balance</p>
          </div>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 bg-gray-50 border-t border-gray-100">
          {/* Running Balance breakdown */}
          <div className="pt-3 bg-white rounded-xl p-3 space-y-1 text-xs">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Running Balance breakdown</p>
            <div className="flex justify-between">
              <span className="text-gray-500">Profit allocated</span>
              <span className="font-mono font-semibold text-emerald-600">+{inr(totals.profit)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Expense share</span>
              <span className="font-mono font-semibold text-red-500">-{inr(totals.expense_share)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Net cash (paid − refunds)</span>
              <span className={`font-mono font-semibold ${totals.paid >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {totals.paid >= 0 ? '+' : ''}{inr(totals.paid)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Loans I've given (outstanding)</span>
              <span className="font-mono font-semibold text-blue-600">+{inr(totals.loansGiven ?? 0)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-100 pt-1.5 mt-1">
              <span className="font-semibold text-gray-700">= Running Balance</span>
              <span className={`font-mono font-bold ${runningBalance >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {runningBalance >= 0 ? '+' : ''}{inr(runningBalance)}
              </span>
            </div>
            <p className="text-[10px] text-gray-400 mt-2 border-t border-gray-100 pt-2">
              Committed stake across projects: {inr(totals.committed)} (not part of balance — represents stake, not cash)
            </p>
          </div>

          {/* Mini bar chart per project */}
          {chartData.length > 0 && (
            <div className="pt-1">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Paid + Profit per project</p>
              <div style={{ width: '100%', height: 140 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 5 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickFormatter={v => v >= 100000 ? `${(v/100000).toFixed(1)}L` : v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                    <Tooltip formatter={(v) => inr(v)} contentStyle={{ fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="Paid"   stackId="a" fill="#0d9488" />
                    <Bar dataKey="Profit" stackId="a" fill="#65a30d" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <button onClick={() => setShowLedger(true)}
            className="w-full text-xs font-semibold text-brand-900 bg-white border border-brand-100 rounded-xl py-2 active:scale-95 transition-transform">
            📜 View full ledger
          </button>

          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide pt-1">Per project</p>
          {projects.map(p => {
            const pOwes  = p.outstanding > 0.5
            const pBack  = p.outstanding < -0.5
            const pNet   = p.netGain >= 0
            return (
              <div key={p.investor_id} className="bg-white rounded-xl p-3 text-xs">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-semibold text-gray-900">{p.project_name}</p>
                    <p className="text-[10px] text-gray-400">{p.share_percent}% share · {p.project_status}</p>
                  </div>
                  <p className={`font-bold mono ${pNet ? 'text-emerald-600' : 'text-red-500'}`}>
                    {pNet ? '+' : ''}{inr(p.netGain)}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <span className="text-gray-500">Committed</span>
                  <span className="font-semibold mono text-right">{inr(p.committed)}</span>
                  <span className="text-gray-500">Paid in</span>
                  <span className="font-semibold mono text-right text-emerald-600">{inr(p.paid)}</span>
                  <span className="text-gray-500">Profit allocated</span>
                  <span className="font-semibold mono text-right text-emerald-600">+{inr(p.profit)}</span>
                  <span className="text-gray-500">Expense share</span>
                  <span className="font-semibold mono text-right text-red-500">-{inr(p.expense_share)}</span>
                  <span className="text-gray-500 font-semibold">{pOwes ? 'Still owes' : pBack ? 'Refund due' : 'Settled'}</span>
                  <span className={`font-bold mono text-right ${pOwes ? 'text-amber-600' : pBack ? 'text-blue-600' : 'text-emerald-600'}`}>
                    {inr(Math.abs(p.outstanding))}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showLedger && (
        <InvestorLedgerModal name={name} investorIds={investorIds} onClose={() => setShowLedger(false)} />
      )}
    </div>
  )
}

// ── Chronological ledger across all projects for one investor ──
function InvestorLedgerModal({ name, investorIds, onClose }) {
  const ledger = useInvestorLedger(investorIds)
  const TYPE_LABEL = {
    share_contribution: { l: 'Share',        c: 'bg-blue-50 text-blue-700' },
    top_up:             { l: 'Top-up',        c: 'bg-emerald-50 text-emerald-700' },
    expense_paid:       { l: 'Paid expense',  c: 'bg-red-50 text-red-700' },
    refund:             { l: 'Refund',        c: 'bg-amber-50 text-amber-700' },
    profit_distribution:{ l: 'Profit',        c: 'bg-emerald-50 text-emerald-700' },
    expense_share:      { l: 'Expense share', c: 'bg-red-50 text-red-700' },
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-100 flex justify-between items-start">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">Ledger</p>
            <p className="font-bold text-lg text-gray-900">{name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{ledger.data.length} transactions across {investorIds.length} projects</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {ledger.loading ? (
            <div className="flex justify-center py-10"><Spinner size="lg" /></div>
          ) : ledger.data.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">No transactions yet</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 text-gray-500 uppercase tracking-wide text-[10px]">
                <tr>
                  <th className="text-left py-2 px-4">Date</th>
                  <th className="text-left py-2 px-2">Project</th>
                  <th className="text-left py-2 px-2">Type</th>
                  <th className="text-right py-2 px-2">Amount</th>
                  <th className="text-right py-2 px-4">Running</th>
                </tr>
              </thead>
              <tbody>
                {ledger.data.map((r, i) => {
                  const meta = TYPE_LABEL[r.type] ?? { l: r.type, c: 'bg-gray-50 text-gray-600' }
                  return (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="py-2 px-4 text-gray-500 whitespace-nowrap">{new Date(r.date).toLocaleDateString('en-IN')}</td>
                      <td className="py-2 px-2 text-gray-900 font-medium">
                        {r.project_name}
                        {r.link_from && <span className="block text-[10px] text-blue-600 mt-0.5">← from {r.link_from}</span>}
                        {r.link_to   && <span className="block text-[10px] text-amber-600 mt-0.5">→ to {r.link_to}</span>}
                      </td>
                      <td className="py-2 px-2"><span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${meta.c}`}>{meta.l}</span></td>
                      <td className={`py-2 px-2 text-right font-mono font-semibold ${r.amount >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {r.amount >= 0 ? '+' : ''}{inr(r.amount)}
                      </td>
                      <td className={`py-2 px-4 text-right font-mono font-bold ${r.running >= 0 ? 'text-gray-800' : 'text-red-500'}`}>
                        {inr(r.running)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="p-4 border-t border-gray-100 text-[10px] text-gray-400 text-center">
          Running total = cumulative profit − expenses + paid + refunds (net cash position). Internal moves between projects cancel out across rows.
        </div>
      </div>
    </div>
  )
}

function ProjectCard({ project }) {
  const navigate = useNavigate()
  const profit = project.total_profit ?? 0
  const raised = project.total_raised ?? 0

  return (
    <div className="card p-4 cursor-pointer active:scale-[0.98] transition-transform"
      onClick={() => navigate(`/projects/${project.id}`)}>
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-gray-900 truncate">{project.name}</p>
            {project.my_role && project.my_role !== 'owner' && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 flex-shrink-0">
                {project.my_role}
              </span>
            )}
          </div>
          {project.description && <p className="text-xs text-gray-400 mt-0.5 truncate">{project.description}</p>}
        </div>
        <span className={`badge-${project.status} ml-2 flex-shrink-0`}>{project.status}</span>
      </div>
      <div className="grid grid-cols-4 gap-1 text-center border-t border-gray-50 pt-3">
        {[
          { label: 'Value',     value: inr(project.total_value) },
          { label: 'Raised',    value: inr(raised) },
          { label: 'Profit',    value: inr(profit), green: profit >= 0 },
          { label: 'Investors', value: project.investor_count ?? 0 },
        ].map(({ label, value, green }) => (
          <div key={label}>
            <p className={`text-xs font-bold mono leading-tight ${green ? 'text-emerald-600' : 'text-gray-800'}`}>{value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
