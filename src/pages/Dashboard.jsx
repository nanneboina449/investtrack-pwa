// src/pages/Dashboard.jsx
import { useNavigate } from 'react-router-dom'
import { useDashboard, useMyInvestments, useAllInvestorsSummary } from '../hooks/useData'
import { acceptPendingInvites } from '../hooks/useSharing'
import { inr, pct } from '../lib/supabase'
import { StatCard, Spinner, Empty } from '../components/ui'
import InviteBanner from '../components/InviteBanner'
import { useEffect, useState } from 'react'

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
      <div className="bg-brand-900 text-white px-5 pt-14 pb-8">
        <p className="text-brand-100 text-sm mb-1">Total Portfolio Value</p>
        <p className="text-4xl font-bold mono mb-6">{inr(summary.totalValue)}</p>
        <div className="grid grid-cols-3 gap-3">
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

      <div className="px-4 py-5 space-y-6">
        {loading ? (
          <div className="flex justify-center py-10"><Spinner size="lg" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <StatCard icon="🚀" label="Active Projects"  value={summary.activeProjects}   color="green" />
              <StatCard icon="⏳" label="Upcoming"         value={summary.upcomingProjects} color="blue" />
              <StatCard icon="↗"  label="Loans Given"      value={inr(summary.loansGiven)}   color="orange" />
              <StatCard icon="↙"  label="Loans Received"   value={inr(summary.loansReceived)} color="purple" />
            </div>

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
                <div className="space-y-3">
                  {active.map(p => <ProjectCard key={p.id} project={p} />)}
                </div>
              </section>
            )}

            {upcoming.length > 0 && (
              <section>
                <h2 className="font-bold text-gray-900 mb-3">Upcoming Projects</h2>
                <div className="space-y-3">
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

// ── Investor running totals (cross-project) ──────────────────
function InvestorRunningTotals({ groups }) {
  const totals = groups.reduce((a, g) => ({
    committed:   a.committed   + g.totals.committed,
    paid:        a.paid        + g.totals.paid,
    profit:      a.profit      + g.totals.profit,
    outstanding: a.outstanding + g.totals.outstanding,
  }), { committed: 0, paid: 0, profit: 0, outstanding: 0 })

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-gray-900">Investor Running Totals</h2>
        <span className="text-xs text-gray-400">{groups.length} {groups.length === 1 ? 'investor' : 'investors'}</span>
      </div>

      {/* Aggregate row */}
      <div className="card p-4 mb-3 bg-brand-50 border-brand-100">
        <div className="grid grid-cols-4 gap-1 text-center">
          {[
            { l: 'Committed', v: inr(totals.committed),                   c: 'text-brand-900' },
            { l: 'Paid in',    v: inr(totals.paid),                        c: 'text-emerald-700' },
            { l: 'Outstanding',v: inr(Math.abs(totals.outstanding)),       c: totals.outstanding > 0.5 ? 'text-amber-700' : totals.outstanding < -0.5 ? 'text-blue-700' : 'text-emerald-700' },
            { l: 'Profit',     v: inr(totals.profit),                      c: 'text-emerald-700' },
          ].map(({l, v, c}) => (
            <div key={l}>
              <p className={`text-xs font-bold mono ${c}`}>{v}</p>
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
  const { name, totals, projectCount, projects } = group
  const owesProject = totals.outstanding > 0.5
  const projectOwes = totals.outstanding < -0.5
  const netPositive = totals.netGain >= 0

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full text-left p-4">
        <div className="flex justify-between items-start mb-3">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 truncate">{name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{projectCount} project{projectCount === 1 ? '' : 's'} · {open ? 'tap to collapse' : 'tap for breakdown'}</p>
          </div>
          <div className="text-right ml-2">
            <p className={`font-bold mono ${netPositive ? 'text-emerald-600' : 'text-red-500'}`}>
              {netPositive ? '+' : ''}{inr(totals.netGain)}
            </p>
            <p className="text-[10px] text-gray-400">net P&L</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1 text-center border-t border-gray-50 pt-3">
          <div>
            <p className="text-xs font-bold mono text-gray-800">{inr(totals.committed)}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">Committed</p>
          </div>
          <div>
            <p className="text-xs font-bold mono text-emerald-600">{inr(totals.paid)}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">Paid</p>
          </div>
          <div>
            <p className={`text-xs font-bold mono ${owesProject ? 'text-amber-600' : projectOwes ? 'text-blue-600' : 'text-emerald-600'}`}>
              {inr(Math.abs(totals.outstanding))}
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {owesProject ? 'Owes' : projectOwes ? 'Refund' : 'Settled'}
            </p>
          </div>
          <div>
            <p className="text-xs font-bold mono text-emerald-600">{inr(totals.profit)}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">Profit</p>
          </div>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-2 bg-gray-50 border-t border-gray-100">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide pt-3">Per project</p>
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
