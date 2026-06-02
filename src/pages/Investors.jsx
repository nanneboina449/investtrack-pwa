// src/pages/Investors.jsx
//
// Manage Investors — ONE card per person, not per project record.
//
// Real-world model: a person ("Venkatesh Nanneboina") can appear on
// multiple projects, each with its own row in the `investors` table.
// Contact details (email, phone) are shared across all their rows —
// editing here updates every record sharing the same normalized name
// via updatePerson() in useData.js.
//
// Click any card → edit name / email / phone. Saves apply everywhere.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAllInvestorsAdmin, updatePerson } from '../hooks/useData'
import { useAuth } from '../contexts/AuthContext'
import { inr } from '../lib/supabase'
import { Sheet, Field, Spinner, Empty, useToast } from '../components/ui'

const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')

export default function Investors() {
  const { user }       = useAuth()
  const [filter, setF] = useState('')
  const [editing, setEditing] = useState(null)
  const { show, Toast } = useToast()
  const investors = useAllInvestorsAdmin(false)   // hide soft-deleted

  const myEmail = (user?.email ?? '').toLowerCase().trim()

  // ── Deduplicate into one card per person (grouped by normalized name) ──
  const people = useMemo(() => {
    const groups = {}
    for (const inv of (investors.data ?? [])) {
      const key = norm(inv.name)
      if (!key) continue
      if (!groups[key]) {
        groups[key] = {
          key,
          displayName: inv.name,        // first seen — kept consistent below
          emails:      new Set(),
          phones:      new Set(),
          projects:    [],
          totalInvested: 0,
        }
      }
      const g = groups[key]
      if (inv.email) g.emails.add(inv.email)
      if (inv.phone) g.phones.add(inv.phone)
      g.projects.push({
        investor_id:   inv.id,
        project_id:    inv.project_id,
        project_name:  inv.project_name,
        project_status: inv.project_status,
        share_percent: Number(inv.share_percent ?? 0),
        amount_invested: Number(inv.amount_invested ?? 0),
      })
      g.totalInvested += Number(inv.amount_invested ?? 0)
    }
    // Filter and sort
    const q = norm(filter)
    return Object.values(groups)
      .filter(g => {
        if (!q) return true
        return (
          g.displayName.toLowerCase().includes(q) ||
          [...g.emails].some(e => e.toLowerCase().includes(q)) ||
          [...g.phones].some(p => p.toLowerCase().includes(q)) ||
          g.projects.some(p => p.project_name.toLowerCase().includes(q))
        )
      })
      .sort((a, b) => b.totalInvested - a.totalInvested)
  }, [investors.data, filter])

  if (investors.loading) {
    return <div className="min-h-[50vh] flex items-center justify-center"><Spinner size="lg" /></div>
  }

  return (
    <div className="page-enter">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-5 pt-14 pb-4 lg:pt-8">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Investors</h1>
          <span className="text-xs text-gray-400">{people.length} people</span>
        </div>
        <p className="text-sm text-gray-500 mt-1">Edit a person's email or phone to update every project they're on.</p>
      </div>

      {/* Search */}
      <div className="px-5 py-3 bg-white border-b border-gray-100">
        <input
          type="text"
          placeholder="Search name, email, phone, or project"
          value={filter}
          onChange={e => setF(e.target.value)}
          className="input"
        />
      </div>

      {/* Empty */}
      {people.length === 0 && (
        <div className="px-5 py-12">
          <Empty
            icon="🧑‍💼"
            title="No investors yet"
            sub={filter ? 'Try a different search term.' : 'Add investors from any project to see them listed here.'}
          />
        </div>
      )}

      {/* People cards */}
      <div className="px-5 py-4 space-y-3">
        {people.map(p => (
          <PersonCard
            key={p.key}
            person={p}
            isMe={myEmail && [...p.emails].some(e => e.toLowerCase().trim() === myEmail)}
            onClick={() => setEditing(p)}
          />
        ))}
      </div>

      {editing && (
        <EditPersonSheet
          person={editing}
          onClose={() => setEditing(null)}
          onSaved={(result) => {
            setEditing(null); investors.reload()
            const { updated, invited } = result ?? {}
            const parts = [`Updated across ${updated ?? 0} project${(updated ?? 0) === 1 ? '' : 's'}`]
            if (invited > 0) parts.push(`${invited} invite${invited === 1 ? '' : 's'} sent`)
            show(parts.join(' · '))
          }}
        />
      )}

      <Toast />
    </div>
  )
}

// ── Person card (collapsed view) ─────────────────────────────
function PersonCard({ person, isMe, onClick }) {
  const emails = [...person.emails]
  const phones = [...person.phones]
  const missingEmail = emails.length === 0
  const missingPhone = phones.length === 0
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-white rounded-2xl border border-gray-100 hover:border-brand-100 hover:shadow-sm transition-all overflow-hidden"
    >
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-gray-900 text-base">{person.displayName}</p>
              {isMe && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-fintech-green text-white">You</span>
              )}
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {person.projects.length} project{person.projects.length === 1 ? '' : 's'}
              </span>
            </div>

            {/* Contact lines */}
            <div className="mt-1.5 space-y-0.5 text-[12px]">
              <p className={missingEmail ? 'text-amber-700' : 'text-gray-600'}>
                <span className="text-gray-400">📧</span>{' '}
                {missingEmail ? <em>no email — tap to add</em> : <span className="font-mono">{emails.join(', ')}</span>}
              </p>
              <p className={missingPhone ? 'text-amber-700' : 'text-gray-600'}>
                <span className="text-gray-400">📱</span>{' '}
                {missingPhone ? <em>no phone — tap to add</em> : <span className="font-mono">{phones.join(', ')}</span>}
              </p>
            </div>

            {/* Project chips */}
            <div className="mt-2 flex flex-wrap gap-1">
              {person.projects.map(pr => (
                <Link
                  key={pr.investor_id}
                  to={`/projects/${pr.project_id}`}
                  onClick={e => e.stopPropagation()}
                  className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-gray-50 text-gray-700 hover:bg-gray-100"
                >
                  {pr.project_name} · {pr.share_percent}%
                </Link>
              ))}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">Total Committed</p>
            <p className="font-mono font-semibold text-sm text-gray-900 mt-0.5">
              {inr(Math.round(person.totalInvested))}
            </p>
          </div>
        </div>
      </div>
    </button>
  )
}

// ── Edit person sheet ────────────────────────────────────────
function EditPersonSheet({ person, onClose, onSaved }) {
  const initialEmail = [...person.emails][0] ?? ''
  const initialPhone = [...person.phones][0] ?? ''
  const [form, setForm] = useState({
    name:  person.displayName,
    email: initialEmail,
    phone: initialPhone,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    setSaving(true); setError(null)
    try {
      const result = await updatePerson({
        currentName: person.displayName,
        newName:     form.name.trim() !== person.displayName.trim() ? form.name : undefined,
        email:       form.email,
        phone:       form.phone,
      })
      onSaved(result ?? { updated: person.projects.length, invited: 0 })
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const mixedEmail = person.emails.size > 1
  const mixedPhone = person.phones.size > 1

  return (
    <Sheet open onClose={onClose} title="Edit Investor Details"
      footer={
        <div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2">{error}</p>}
          <button type="button" onClick={submit} disabled={saving} className="btn-primary w-full">
            {saving ? 'Saving…' : `Save across ${person.projects.length} project${person.projects.length === 1 ? '' : 's'}`}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-[11px] text-gray-500">
          Changes apply to every project this person is on. Their share % and committed amounts on each project stay as-is — only contact details and name are updated.
        </p>

        <Field label="Name *">
          <input
            className="input"
            value={form.name}
            onChange={e => set('name', e.target.value)}
            required
          />
          <p className="text-[10px] text-gray-400 mt-1">
            Renaming here will rename all {person.projects.length} record{person.projects.length === 1 ? '' : 's'}.
          </p>
        </Field>

        <Field label="Email">
          <input
            className="input font-mono text-sm"
            type="email"
            placeholder="name@example.com"
            value={form.email}
            onChange={e => set('email', e.target.value)}
          />
          {mixedEmail && (
            <p className="text-[10px] text-amber-700 bg-amber-50 rounded-md px-2 py-1 mt-1">
              ⚠ This person currently has different emails across projects ({[...person.emails].join(', ')}). Saving will overwrite all of them with the value above.
            </p>
          )}
          <p className="text-[10px] text-gray-400 mt-1">
            Used by the Portfolio screen to match this person to a logged-in account.
          </p>
        </Field>

        <Field label="Phone">
          <input
            className="input font-mono text-sm"
            type="tel"
            placeholder="+91 …"
            value={form.phone}
            onChange={e => set('phone', e.target.value)}
          />
          {mixedPhone && (
            <p className="text-[10px] text-amber-700 bg-amber-50 rounded-md px-2 py-1 mt-1">
              ⚠ Different phones currently set: {[...person.phones].join(', ')}. Saving overwrites all.
            </p>
          )}
        </Field>

        {/* Per-project breakdown (read-only) */}
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Projects ({person.projects.length})</p>
          <div className="space-y-1.5">
            {person.projects.map(pr => (
              <div key={pr.investor_id} className="flex items-center justify-between text-[12px] px-3 py-2 bg-gray-50 rounded-lg">
                <Link to={`/projects/${pr.project_id}`} className="font-medium text-gray-800 hover:text-brand-700 truncate flex-1">
                  {pr.project_name}
                </Link>
                <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                  <span className="text-gray-500">{pr.share_percent}%</span>
                  <span className="font-mono text-gray-700">{inr(Math.round(pr.amount_invested))}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">
            To change share % or amount on a specific project, open that project and use Edit there.
          </p>
        </div>
      </div>
    </Sheet>
  )
}
