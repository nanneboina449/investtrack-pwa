// src/pages/Investors.jsx
//
// Manage Investors — global cross-project view of every investor record
// the user can see (RLS-scoped). Lets you edit name, email, share %, and
// amount invested without having to navigate into each project.
//
// Primary use case: project owners who added themselves (or others)
// without an email and now need to link the email so My Portfolio
// strict-matches them. Also useful for bulk fix-ups after data drift.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAllInvestorsAdmin, updateInvestor, deleteInvestor, linkInvestorToMyEmail } from '../hooks/useData'
import { useAuth } from '../contexts/AuthContext'
import { inr } from '../lib/supabase'
import { Sheet, Field, Spinner, Empty, useToast } from '../components/ui'

export default function Investors() {
  const { user } = useAuth()
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [filter, setFilter]   = useState('')
  const [editing, setEditing] = useState(null)   // investor row being edited
  const { show, Toast } = useToast()
  const investors = useAllInvestorsAdmin(includeDeleted)

  const myEmail = (user?.email ?? '').toLowerCase().trim()

  // Filter by free-text search across name / email / project name
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return investors.data
    return (investors.data ?? []).filter(i =>
      (i.name         ?? '').toLowerCase().includes(q) ||
      (i.email        ?? '').toLowerCase().includes(q) ||
      (i.project_name ?? '').toLowerCase().includes(q)
    )
  }, [investors.data, filter])

  // Group by project for visual structure
  const grouped = useMemo(() => {
    const m = {}
    for (const inv of (visible ?? [])) {
      if (!m[inv.project_id]) {
        m[inv.project_id] = {
          project_id:    inv.project_id,
          project_name:  inv.project_name,
          project_status: inv.project_status,
          investors: [],
        }
      }
      m[inv.project_id].investors.push(inv)
    }
    return Object.values(m).sort((a, b) => a.project_name.localeCompare(b.project_name))
  }, [visible])

  const handleDelete = async (inv) => {
    if (!confirm(`Remove "${inv.name}" from ${inv.project_name}?`)) return
    try {
      const result = await deleteInvestor(inv.id)
      investors.reload()
      show(result?.mode === 'soft'
        ? 'Investor archived — ledger history preserved'
        : 'Investor removed')
    } catch (e) { show(e.message, 'error') }
  }

  const handleClaim = async (inv) => {
    try {
      await linkInvestorToMyEmail(inv.id)
      investors.reload()
      show('Linked — your email is now on this record')
    } catch (e) { show(e.message, 'error') }
  }

  if (investors.loading) {
    return <div className="min-h-[50vh] flex items-center justify-center"><Spinner size="lg" /></div>
  }

  return (
    <div className="page-enter">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-5 pt-14 pb-4 lg:pt-8">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Investors</h1>
          <span className="text-xs text-gray-400">{visible?.length ?? 0} records</span>
        </div>
        <p className="text-sm text-gray-500 mt-1">Edit details across all projects you can see.</p>
      </div>

      {/* Search + filters */}
      <div className="px-5 py-3 bg-white border-b border-gray-100 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          placeholder="Search name, email, or project"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="input flex-1"
        />
        <label className="flex items-center gap-2 text-xs text-gray-600 px-2 py-2 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={e => setIncludeDeleted(e.target.checked)}
            className="h-4 w-4 accent-brand-900"
          />
          Include archived
        </label>
      </div>

      {/* Empty */}
      {grouped.length === 0 && (
        <div className="px-5 py-12">
          <Empty icon="🧑‍💼" title="No investors found" sub={filter ? 'Try a different search term.' : 'Add investors from any project to manage them here.'} />
        </div>
      )}

      {/* Grouped list */}
      <div className="px-5 py-4 space-y-5">
        {grouped.map(g => (
          <section key={g.project_id}>
            <div className="flex items-center gap-2 mb-2 px-1">
              <Link to={`/projects/${g.project_id}`} className="font-semibold text-gray-900 text-sm hover:text-brand-700 truncate">
                {g.project_name}
              </Link>
              {g.project_status && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">
                  {g.project_status}
                </span>
              )}
              <span className="text-[11px] text-gray-400 ml-auto">{g.investors.length} investor{g.investors.length === 1 ? '' : 's'}</span>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100 overflow-hidden">
              {g.investors.map(inv => (
                <Row
                  key={inv.id}
                  inv={inv}
                  isMe={myEmail && (inv.email ?? '').toLowerCase().trim() === myEmail}
                  onEdit={() => setEditing(inv)}
                  onDelete={() => handleDelete(inv)}
                  onClaim={() => handleClaim(inv)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {editing && (
        <EditInvestorSheet
          inv={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); investors.reload(); show('Investor updated') }}
        />
      )}

      <Toast />
    </div>
  )
}

// ── Row ──────────────────────────────────────────────────────
function Row({ inv, isMe, onEdit, onDelete, onClaim }) {
  return (
    <div className={`px-4 py-3 ${inv.is_deleted ? 'opacity-50' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-gray-900 text-sm truncate">{inv.name}</p>
            {isMe && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-fintech-green text-white">You</span>
            )}
            {inv.is_deleted && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">Archived</span>
            )}
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
              {Number(inv.share_percent ?? 0)}%
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5 truncate">
            {inv.email
              ? <span className="font-mono">{inv.email}</span>
              : <em className="text-amber-700">no email set</em>}
            {' · '}
            <span>committed {inr(Math.round(Number(inv.amount_invested ?? 0)))}</span>
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!inv.email && !inv.is_deleted && (
            <button
              type="button"
              onClick={onClaim}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              title="Attach my email to this record"
            >
              This is me
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-brand-50 text-brand-900 hover:bg-brand-100"
            disabled={inv.is_deleted}
          >
            ✎ Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
            disabled={inv.is_deleted}
            title="Delete (soft-delete if there is ledger history)"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit sheet ───────────────────────────────────────────────
function EditInvestorSheet({ inv, onClose, onSaved }) {
  const [form, setForm] = useState({
    name:            inv.name            ?? '',
    email:           inv.email           ?? '',
    share_percent:   inv.share_percent   ?? '',
    amount_invested: inv.amount_invested ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e?.preventDefault?.()
    setSaving(true); setError(null)
    try {
      const payload = {
        name:            form.name.trim(),
        email:           form.email.trim() || null,
        share_percent:   parseFloat(form.share_percent) || 0,
        amount_invested: parseFloat(form.amount_invested) || 0,
      }
      await updateInvestor(inv.id, payload)
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet open onClose={onClose} title="Edit Investor"
      footer={
        <div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2">{error}</p>}
          <button type="button" onClick={submit} disabled={saving} className="btn-primary w-full">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <p className="text-[11px] text-gray-400">On project <strong>{inv.project_name}</strong></p>

        <Field label="Name *">
          <input className="input" value={form.name} onChange={e => set('name', e.target.value)} required />
        </Field>

        <Field label="Email">
          <input
            className="input font-mono text-sm"
            type="email"
            placeholder="name@example.com"
            value={form.email}
            onChange={e => set('email', e.target.value)}
          />
          <p className="text-[10px] text-gray-400 mt-1">
            Used by My Portfolio to match this record to a logged-in user.
          </p>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Share %">
            <input
              className="input text-right font-mono"
              type="number" step="0.01" min="0" max="100"
              value={form.share_percent}
              onChange={e => set('share_percent', e.target.value)}
            />
          </Field>
          <Field label="Amount Committed (₹)">
            <input
              className="input text-right font-mono"
              type="number" step="1" min="0"
              value={form.amount_invested}
              onChange={e => set('amount_invested', e.target.value)}
            />
          </Field>
        </div>
      </form>
    </Sheet>
  )
}
