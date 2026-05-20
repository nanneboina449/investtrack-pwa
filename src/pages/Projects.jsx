// src/pages/Projects.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjects, createProject } from '../hooks/useData'
import { inr, isoDate } from '../lib/supabase'
import { Sheet, Field, Empty, Spinner, SegControl, useToast, Collapsible } from '../components/ui'

export default function Projects() {
  const { data: projects, loading, reload } = useProjects()
  const navigate = useNavigate()
  const [tab, setTab]         = useState('active')
  const [showAdd, setShowAdd] = useState(false)
  const { show, Toast }       = useToast()

  const filtered = projects.filter(p => p.status === tab)

  return (
    <div className="page-enter">
      <Toast />

      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-5 pt-14 pb-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <button onClick={() => setShowAdd(true)} className="btn-primary text-sm px-4 py-2">
            + New
          </button>
        </div>
        <SegControl
          value={tab}
          onChange={setTab}
          options={[
            { value: 'active',    label: `Active (${projects.filter(p=>p.status==='active').length})` },
            { value: 'upcoming',  label: `Upcoming (${projects.filter(p=>p.status==='upcoming').length})` },
            { value: 'completed', label: 'Done' },
          ]}
        />
      </div>

      <div className="px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-14"><Spinner size="lg" /></div>
        ) : filtered.length === 0 ? (
          <Empty icon="📁" title={`No ${tab} projects`} sub="Tap + New to create one" />
        ) : (
          <div className="space-y-3">
            {filtered.map(p => (
              <div key={p.id} className="card p-4 cursor-pointer active:scale-[0.98] transition-transform"
                onClick={() => navigate(`/projects/${p.id}`)}>
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{p.name}</p>
                    {p.description && <p className="text-xs text-gray-400 truncate mt-0.5">{p.description}</p>}
                  </div>
                  <span className={`badge-${p.status} ml-2`}>{p.status}</span>
                </div>
                <div className="grid grid-cols-4 gap-1 text-center border-t border-gray-50 pt-3">
                  {[
                    { l: 'Value',    v: inr(p.total_value) },
                    { l: 'Raised',   v: inr(p.total_raised ?? 0) },
                    { l: 'Profit',   v: inr(p.total_profit ?? 0), g: (p.total_profit ?? 0) >= 0 },
                    { l: 'Members',  v: p.investor_count ?? 0 },
                  ].map(({ l, v, g }) => (
                    <div key={l}>
                      <p className={`text-xs font-bold mono ${g ? 'text-emerald-600' : 'text-gray-800'}`}>{v}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{l}</p>
                    </div>
                  ))}
                </div>
                {p.expected_return_percent && (
                  <p className="text-xs text-gray-400 mt-2 pt-2 border-t border-gray-50">
                    Stake: <span className="font-semibold text-gray-600">{p.our_stake_percent}%</span> · Pool: <span className="font-semibold text-emerald-600">{inr((p.total_value ?? 0) * (p.our_stake_percent ?? 100) / 100)}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <AddProjectSheet
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSaved={() => { setShowAdd(false); reload(); show('Project created!') }}
      />
    </div>
  )
}

// ── Add Project Sheet ──────────────────────────────────────────
function AddProjectSheet({ open, onClose, onSaved }) {
  const [form, setForm]   = useState({ name: '', description: '', total_value: '', status: 'upcoming', our_stake_percent: '100', start_date: isoDate() })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name || !form.total_value) return
    setSaving(true)
    setError(null)
    try {
      await createProject({
        name:                    form.name,
        description:             form.description || null,
        total_value:             parseFloat(form.total_value),
        status:                  form.status,
        start_date:              form.start_date || null,
        our_stake_percent: parseFloat(form.our_stake_percent) || 100,
      })
      setForm({ name: '', description: '', total_value: '', status: 'upcoming', our_stake_percent: '100', start_date: isoDate() })
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="New Project">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Project Name *">
          <input className="input" placeholder="e.g. Warehouse Hyderabad" value={form.name} onChange={e => set('name', e.target.value)} required />
        </Field>
        <Field label="Description">
          <textarea className="input resize-none" rows={2} placeholder="Short description…" value={form.description} onChange={e => set('description', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Total Value (₹) *">
            <input className="input" type="number" placeholder="0" value={form.total_value} onChange={e => set('total_value', e.target.value)} required />
          </Field>
          <Field label="Our Stake %">
            <input className="input" type="number" step="0.01" placeholder="e.g. 30" value={form.our_stake_percent} onChange={e => set('our_stake_percent', e.target.value)} />
          </Field>
        </div>
        {form.total_value && form.our_stake_percent && (
          <div className="bg-brand-50 border border-brand-100 rounded-xl px-4 py-3">
            <p className="text-xs text-brand-700 font-medium">Your investable pool = <span className="font-bold mono">{inr(parseFloat(form.total_value||0) * parseFloat(form.our_stake_percent||100) / 100)}</span></p>
            <p className="text-[10px] text-brand-500 mt-0.5">{form.our_stake_percent}% of {inr(parseFloat(form.total_value||0))} · Investor shares split from this amount</p>
          </div>
        )}
        <Field label="Status">
          <select className="input" value={form.status} onChange={e => set('status', e.target.value)}>
            <option value="upcoming">Upcoming</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
        </Field>
        <Field label="Start Date">
          <input className="input" type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
        </Field>
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={saving}>
          {saving ? 'Creating…' : 'Create Project'}
        </button>
      </form>
    </Sheet>
  )
}
