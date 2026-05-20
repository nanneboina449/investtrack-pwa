// src/components/ui/index.jsx
import { useState } from 'react'

// ── Spinner ──────────────────────────────────────────────────
export function Spinner({ size = 'md' }) {
  const s = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-10 w-10' : 'h-6 w-6'
  return <div className={`${s} border-2 border-brand-100 border-t-brand-900 rounded-full animate-spin`} />
}

// ── Empty state ───────────────────────────────────────────────
export function Empty({ icon, title, sub, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center px-6">
      <span className="text-5xl mb-4">{icon}</span>
      <p className="font-semibold text-gray-700 mb-1">{title}</p>
      {sub && <p className="text-sm text-gray-400 mb-4">{sub}</p>}
      {action}
    </div>
  )
}

// ── Sheet (bottom drawer) ─────────────────────────────────────
// footer prop = sticky button area, always visible above keyboard
export function Sheet({ open, onClose, title, children, footer }) {
  if (!open) return null
  return (
    <div className="sheet-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        {/* Header */}
        <div className="sheet-header">
          <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />
          {title && (
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">{title}</h2>
              <button onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 text-lg leading-none">
                ×
              </button>
            </div>
          )}
        </div>

        {/* Scrollable content */}
        <div className="sheet-scroll">
          {children}
        </div>

        {/* Sticky footer — always above keyboard */}
        {footer && (
          <div className="sheet-footer">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Collapsible section ───────────────────────────────────────
export function Collapsible({ label, icon = '⚙', defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-gray-100 overflow-hidden">
      <button type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 text-sm font-medium text-gray-600">
        <span className="flex items-center gap-2">{icon} {label}</span>
        <span className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && <div className="p-4 space-y-4">{children}</div>}
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────
export function StatCard({ label, value, sub, color = 'gray', icon }) {
  const colors = {
    gray:   'bg-gray-50 text-gray-700',
    green:  'bg-emerald-50 text-emerald-700',
    blue:   'bg-blue-50 text-blue-700',
    orange: 'bg-orange-50 text-orange-700',
    purple: 'bg-purple-50 text-purple-700',
    red:    'bg-red-50 text-red-700',
  }
  return (
    <div className="card p-4 flex items-center gap-3">
      {icon && (
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0 ${colors[color]}`}>
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xs text-gray-500 mb-0.5 truncate">{label}</p>
        <p className="font-bold text-gray-900 text-sm leading-tight">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── Progress bar ──────────────────────────────────────────────
export function ProgressBar({ value, max = 100, color = 'bg-brand-900', height = 'h-2' }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div className={`w-full bg-gray-100 rounded-full overflow-hidden ${height}`}>
      <div className={`${color} h-full rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  )
}

// ── Segmented control ─────────────────────────────────────────
export function SegControl({ options, value, onChange }) {
  return (
    <div className="flex bg-gray-100 rounded-xl p-1 gap-1 overflow-x-auto">
      {options.map(opt => (
        <button key={opt.value} onClick={() => onChange(opt.value)}
          className={`flex-shrink-0 py-1.5 px-3 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
            value === opt.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}>
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ── Share allocation bar ──────────────────────────────────────
const COLORS = ['#1565c0','#e65100','#4527a0','#00695c','#ad1457','#558b2f','#6a1b9a']

export function ShareBar({ investors = [] }) {
  const total = investors.reduce((s, i) => s + (i.share_percent ?? 0), 0)
  const remaining = Math.max(0, 100 - total)
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden gap-px">
        {investors.map((inv, idx) => (
          <div key={inv.investor_id ?? idx}
            style={{ width: `${inv.share_percent}%`, background: COLORS[idx % COLORS.length] }}
            title={`${inv.investor_name}: ${inv.share_percent}%`} />
        ))}
        {remaining > 0 && <div style={{ width: `${remaining}%` }} className="bg-gray-100" />}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {investors.map((inv, idx) => (
          <div key={inv.investor_id ?? idx} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[idx % COLORS.length] }} />
            <span className="text-xs text-gray-500">{inv.investor_name} · {inv.share_percent}%</span>
          </div>
        ))}
        {remaining > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-gray-200 flex-shrink-0" />
            <span className="text-xs text-gray-400">Open · {remaining.toFixed(1)}%</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Form field wrapper ────────────────────────────────────────
export function Field({ label, error, children }) {
  return (
    <div>
      {label && <label className="label">{label}</label>}
      {children}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

// ── Toast ─────────────────────────────────────────────────────
export function useToast() {
  const [toast, setToast] = useState(null)
  const show = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }
  const Toast = () => toast ? (
    <div className={`fixed z-50 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg
      top-4 left-1/2 -translate-x-1/2 transition-all
      ${toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {toast.msg}
    </div>
  ) : null
  return { show, Toast }
}
