// src/pages/Dashboard.jsx
import { useNavigate } from 'react-router-dom'
import { useDashboard, useMyInvestments } from '../hooks/useData'
import { acceptPendingInvites } from '../hooks/useSharing'
import { inr, pct } from '../lib/supabase'
import { StatCard, Spinner, Empty } from '../components/ui'
import InviteBanner from '../components/InviteBanner'
import { useEffect } from 'react'

export default function Dashboard() {
  const { summary, projects, loading } = useDashboard()
  const navigate = useNavigate()
  const myInvestments = useMyInvestments()

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
