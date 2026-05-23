// src/pages/MyPortfolio.jsx
//
// "My Portfolio" — the logged-in user's personal wealth view, per
// investtrack_portfolio_ui_spec.pdf. Replaces the org-wide Dashboard
// at the / route.
//
// Sections (top → bottom):
//   1. Hero — large running balance + all-time return below
//   2. Performance chart — Recharts AreaChart over cumulative balance
//   3. 3-column stats — Invested / Realized Profit / Total Expenses
//   4. Asset Breakdown — each project + each loan-given (Receivable)
//   5. Liabilities — each loan-received (Payable)
//
// Scoping: all data comes from useMyPortfolio() which matches on
// email + name. Other users' investments are not visible here even if
// the logged-in user is a project owner.
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useMyPortfolio } from '../hooks/useData'
import { inr } from '../lib/supabase'
import { Spinner, Empty } from '../components/ui'
import {
  AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

// ── Compact hero amount formatter ─────────────────────────────
// Per spec: large clean number with no trailing decimals. inr() in
// lib/supabase is already hardcoded to maximumFractionDigits=0, so
// just round and pass through.
function formatHero(amount) {
  return inr(Math.round(Number(amount || 0)))
}

// ── Money color helper ────────────────────────────────────────
// Per spec: profit + positive cash flow = fintech-green (#00c805);
// liabilities + owed amounts + negative drift = fintech-red (#ff5000).
function moneyClass(amount, { neutralZero = true } = {}) {
  const n = Number(amount || 0)
  if (neutralZero && Math.abs(n) < 0.5) return 'text-gray-500'
  return n >= 0 ? 'text-fintech-green' : 'text-fintech-red'
}

export default function MyPortfolio() {
  const { data, loading, error } = useMyPortfolio()

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="px-5 py-12">
        <Empty icon="⚠️" title="Couldn't load your portfolio" sub={error} />
      </div>
    )
  }
  if (!data || data.empty) {
    return <EmptyState data={data} />
  }

  return (
    <div className="page-enter">
      {/* Header strip */}
      <div className="bg-white border-b border-gray-100 px-5 pt-14 pb-3 lg:pt-8">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
          My Portfolio
        </p>
        {data.identity?.name && (
          <p className="text-sm text-gray-500 mt-0.5">{data.identity.name}</p>
        )}
      </div>

      {/* Name-mismatch hint — only when we had to relax to email-only.
          The strict name+email rule failed, but email-only found records.
          Surface this so the user can fix the underlying data drift. */}
      {data.matchMode === 'loose-email-only' && (
        <div className="mx-5 mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[12px] text-amber-900">
          <p className="font-semibold mb-0.5">Name mismatch — showing all records on {data.identity.email}</p>
          <p className="text-amber-800">
            Your profile name is "{data.identity.name ?? '—'}" but the investor records on your projects are under a different spelling. Edit one of them to match (or update your profile name in Settings) to switch to strict matching.
          </p>
        </div>
      )}

      {/* Hero */}
      <Hero
        runningBalance={data.runningBalance}
        netReturn={data.netReturn}
      />

      {/* Performance chart */}
      <PerformanceChart timeline={data.timeline} netReturn={data.netReturn} />

      {/* 3-column stats */}
      <StatRow
        invested={data.invested}
        realizedProfit={data.realizedProfit}
        totalExpenses={data.totalExpenses}
      />

      {/* Asset Breakdown */}
      <Section title="Asset Breakdown">
        {data.projects.length === 0 && data.loansGiven.length === 0 && (
          <p className="text-sm text-gray-400 px-4 py-3">No assets yet.</p>
        )}
        {data.projects.map(p => (
          <AssetRow
            key={`proj-${p.project_id}`}
            primary={p.name}
            badge={p.status === 'active' ? { label: 'Active Project', color: 'green' }
                  : p.status === 'completed' ? { label: 'Completed', color: 'gray' }
                  : { label: 'Upcoming', color: 'blue' }}
            amount={p.currentValue}
            to={`/projects/${p.project_id}`}
          />
        ))}
        {data.loansGiven.map(l => (
          <AssetRow
            key={`lg-${l.id}`}
            primary={`Loan to ${l.counterparty}`}
            badge={{ label: 'Receivable', color: 'green' }}
            amount={l.outstanding}
            sub={l.interest_pct > 0 ? `${l.interest_pct}% interest` : null}
          />
        ))}
      </Section>

      {/* Liabilities */}
      {data.loansReceived.length > 0 && (
        <Section title="Liabilities">
          {data.loansReceived.map(l => (
            <AssetRow
              key={`lr-${l.id}`}
              primary={`Loan from ${l.counterparty}`}
              badge={{ label: 'Payable', color: 'red' }}
              amount={-l.outstanding}      // negative → red + leading minus
              sub={l.interest_pct > 0 ? `${l.interest_pct}% interest` : null}
            />
          ))}
        </Section>
      )}

      {/* Transaction timeline (Screen 2 from the spec) */}
      <Timeline rows={data.timeline} />
    </div>
  )
}

// ── Hero ──────────────────────────────────────────────────────
function Hero({ runningBalance, netReturn }) {
  const returnSign = netReturn >= 0 ? '+' : '−'
  return (
    <div className="px-5 pt-8 pb-6 text-center">
      <p className="text-xs text-gray-500 mb-2">Total Portfolio Value (Running Balance)</p>
      <p className="text-5xl font-light text-gray-900 tabular-nums tracking-tight">
        {formatHero(runningBalance)}
      </p>
      <p className={`mt-3 text-sm font-semibold ${moneyClass(netReturn)}`}>
        {returnSign} {inr(Math.abs(Math.round(netReturn)))} (All-Time Return)
      </p>
    </div>
  )
}

// ── Performance chart (Recharts AreaChart, gradient fill) ─────
function PerformanceChart({ timeline, netReturn }) {
  // Coalesce to daily buckets so multiple events on the same day stack
  // into one chart point.
  const series = useMemo(() => {
    if (!timeline || timeline.length === 0) return []
    const lastByDate = {}
    for (const r of timeline) lastByDate[r.date] = r.running
    return Object.entries(lastByDate)
      .map(([date, running]) => ({ date, running: Math.round(Number(running) || 0) }))
      .sort((a, b) => a.date < b.date ? -1 : 1)
  }, [timeline])

  if (series.length < 2) {
    // Not enough data to render a meaningful line yet
    return null
  }

  const positive = netReturn >= 0
  const stroke = positive ? '#00c805' : '#ff5000'
  const fillId = positive ? 'portfolioGreen' : 'portfolioRed'

  return (
    <div className="px-2 pb-4" style={{ height: 180 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={stroke} stopOpacity={0.35} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" hide />
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Tooltip
            cursor={{ stroke: '#9ca3af', strokeDasharray: '3 3' }}
            contentStyle={{
              border: 'none', borderRadius: 12, fontSize: 12,
              boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
            }}
            formatter={(v) => [inr(v), 'Balance']}
            labelFormatter={(d) => new Date(d).toLocaleDateString('en-IN', {
              day: '2-digit', month: 'short', year: 'numeric',
            })}
          />
          <Area
            type="monotone"
            dataKey="running"
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#${fillId})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Stat row (3 columns) ──────────────────────────────────────
function StatRow({ invested, realizedProfit, totalExpenses }) {
  return (
    <div className="px-5 py-4 border-t border-b border-gray-100 bg-white">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Invested (Net Cash)" value={inr(Math.round(invested))} />
        <Stat label="Realized Profit"     value={inr(Math.round(realizedProfit))}
              className="text-fintech-green" />
        <Stat label="Total Expenses"      value={inr(Math.round(totalExpenses))} />
      </div>
    </div>
  )
}

function Stat({ label, value, className = 'text-gray-900' }) {
  return (
    <div>
      <p className="text-[11px] text-gray-500 mb-1">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${className}`}>{value}</p>
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────
function Section({ title, children }) {
  return (
    <section className="px-5 py-5">
      <h2 className="text-sm font-bold text-gray-900 mb-3">{title}</h2>
      <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100 overflow-hidden">
        {children}
      </div>
    </section>
  )
}

// ── Asset / liability row ─────────────────────────────────────
function AssetRow({ primary, badge, amount, sub, to }) {
  const body = (
    <div className="flex items-center justify-between px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-gray-900 text-sm truncate">{primary}</p>
          {badge && <Badge color={badge.color} label={badge.label} />}
        </div>
        {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
      </div>
      <p className={`font-mono font-semibold text-sm whitespace-nowrap ml-3 ${moneyClass(amount, { neutralZero: false })}`}>
        {amount < 0 ? '− ' : ''}{inr(Math.abs(Math.round(amount)))}
      </p>
    </div>
  )
  if (to) return <Link to={to} className="block hover:bg-gray-50 transition-colors">{body}</Link>
  return body
}

function Badge({ color, label }) {
  const styles = {
    green:  'bg-emerald-50 text-fintech-green',
    red:    'bg-red-50 text-fintech-red',
    blue:   'bg-blue-50 text-blue-700',
    gray:   'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${styles[color]}`}>
      {label}
    </span>
  )
}

// ── Transaction timeline (Screen 2) ───────────────────────────
function Timeline({ rows }) {
  if (!rows || rows.length === 0) return null
  const recent = [...rows].sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 30)
  return (
    <section className="px-5 py-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-gray-900">Recent Activity</h2>
        <span className="text-[11px] text-gray-400">{rows.length} events total</span>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100 overflow-hidden">
        {recent.map((r, i) => (
          <TimelineRow key={i} row={r} />
        ))}
      </div>
    </section>
  )
}

function TimelineRow({ row }) {
  const date = new Date(row.date).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
  const sign = row.amount > 0 ? '+ ' : row.amount < 0 ? '− ' : ''
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="min-w-0 flex-1 mr-3">
        <p className="text-sm font-semibold text-gray-900 truncate">{row.label}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {date}{row.sub ? ` • ${row.sub}` : ''}
        </p>
      </div>
      <p className={`font-mono font-semibold text-sm whitespace-nowrap ${moneyClass(row.amount, { neutralZero: false })}`}>
        {sign}{inr(Math.abs(Math.round(row.amount)))}
      </p>
    </div>
  )
}

// ── Empty state ──────────────────────────────────────────────
//
// No investor records on the logged-in user's email yet. We just point
// them at the Investors tab — they can find their name there, open the
// edit sheet, and add their email. The update propagates to every
// project they're on via updatePerson(), and this screen populates on
// the next visit.
function EmptyState({ data }) {
  const identity = data?.identity
  const owned    = data?.ownedProjects ?? []
  return (
    <div className="page-enter">
      <div className="bg-white border-b border-gray-100 px-5 pt-14 pb-3 lg:pt-8">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
          My Portfolio
        </p>
        {identity?.name && (
          <p className="text-sm text-gray-500 mt-0.5">{identity.name}</p>
        )}
      </div>

      <div className="px-5 py-10 space-y-6">
        <div className="text-center">
          <div className="text-5xl mb-4">🌱</div>
          <p className="font-semibold text-gray-700 mb-1">No investor records linked to your email</p>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            We couldn't find any investor record on <strong className="font-mono">{identity?.email}</strong>.
            Open the <strong>Investors</strong> tab, find your name, and add your email — it'll apply to every project you're on and this screen will populate next time.
          </p>
          <Link
            to="/investors"
            className="inline-block mt-5 btn-primary px-5 py-2.5 text-sm"
          >
            Open Investors →
          </Link>
        </div>

        {/* Quick diagnostic */}
        <details className="bg-gray-50 rounded-2xl border border-gray-200 px-4 py-3 text-[12px] text-gray-700 max-w-md mx-auto">
          <summary className="font-semibold cursor-pointer select-none">Diagnostic</summary>
          <div className="mt-3 space-y-1 font-mono">
            <p><span className="text-gray-500">email:</span> {identity?.email}</p>
            <p><span className="text-gray-500">name :</span> {identity?.name ?? <em className="text-gray-400">(not set)</em>}</p>
          </div>
        </details>

        {/* Owned projects shortcut */}
        {owned.length > 0 && (
          <section className="max-w-2xl mx-auto">
            <h2 className="text-sm font-bold text-gray-900 mb-2">Projects you own</h2>
            <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100 overflow-hidden">
              {owned.map(p => (
                <Link
                  key={p.project_id}
                  to={`/projects/${p.project_id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <p className="font-semibold text-gray-900 text-sm truncate">{p.name}</p>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">
                      {p.status}
                    </span>
                  </div>
                  <span className="text-gray-400 text-lg">›</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
