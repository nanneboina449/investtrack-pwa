// src/components/ShareModal.jsx
import { useState } from 'react'
import { useProjectMembers, inviteUser, removeMember, updateMemberRole } from '../hooks/useSharing'
import { Sheet, Spinner, useToast } from './ui'

const ROLES = [
  { value: 'viewer', label: 'Viewer', desc: 'Can view everything, no changes' },
  { value: 'editor', label: 'Editor', desc: 'Can add profits, investors, loans' },
  { value: 'owner',  label: 'Owner',  desc: 'Full access including delete' },
]

const ROLE_COLORS = {
  owner:  'bg-purple-50 text-purple-700',
  editor: 'bg-blue-50 text-blue-700',
  viewer: 'bg-gray-100 text-gray-600',
}

export default function ShareModal({ open, onClose, project }) {
  const { members, loading, reload } = useProjectMembers(project?.id)
  const [email, setEmail]   = useState('')
  const [role, setRole]     = useState('viewer')
  const [sending, setSending] = useState(false)
  const [error, setError]   = useState(null)
  const { show, Toast }     = useToast()

  const handleInvite = async (e) => {
    e.preventDefault()
    setSending(true); setError(null)
    try {
      await inviteUser({ projectId: project.id, email, role })
      setEmail('')
      reload()
      show(`Invite sent to ${email}`)
    } catch (e) {
      setError(e.message.includes('unique') ? 'This person is already invited.' : e.message)
    } finally {
      setSending(false)
    }
  }

  const handleRemove = async (memberId, memberEmail) => {
    if (!confirm(`Remove ${memberEmail}?`)) return
    try { await removeMember(memberId); reload(); show('Member removed') }
    catch (e) { show(e.message, 'error') }
  }

  const handleRoleChange = async (memberId, newRole) => {
    try { await updateMemberRole(memberId, newRole); reload(); show('Role updated') }
    catch (e) { show(e.message, 'error') }
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Share "${project?.name}"`}>
      <Toast />
      <div className="space-y-5">

        {/* Invite form */}
        <form onSubmit={handleInvite} className="space-y-3">
          <div>
            <label className="label">Invite by Email</label>
            <input
              className="input"
              type="email"
              placeholder="colleague@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="label">Role</label>
            <div className="space-y-2">
              {ROLES.map(r => (
                <label key={r.value}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all
                    ${role === r.value ? 'border-brand-900 bg-brand-50' : 'border-gray-200'}`}>
                  <input type="radio" name="role" value={r.value}
                    checked={role === r.value} onChange={() => setRole(r.value)} className="accent-brand-900" />
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{r.label}</p>
                    <p className="text-xs text-gray-400">{r.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <button type="submit" className="btn-primary w-full" disabled={sending}>
            {sending ? 'Sending…' : 'Send Invite'}
          </button>
        </form>

        {/* Current members */}
        {loading ? <Spinner /> : members.length > 0 && (
          <div>
            <p className="label mb-3">People with access ({members.length})</p>
            <div className="space-y-2">
              {members.map(m => (
                <div key={m.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                  {/* Avatar */}
                  <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-900 font-bold text-sm flex-shrink-0">
                    {m.invited_email[0].toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{m.invited_email}</p>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                      m.status === 'pending' ? 'bg-amber-50 text-amber-700' : ROLE_COLORS[m.role]
                    }`}>
                      {m.status === 'pending' ? 'Pending' : m.role}
                    </span>
                  </div>

                  {/* Role picker (accepted members only) */}
                  {m.status === 'accepted' && (
                    <select
                      value={m.role}
                      onChange={e => handleRoleChange(m.id, e.target.value)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"
                    >
                      {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  )}

                  <button onClick={() => handleRemove(m.id, m.invited_email)}
                    className="text-gray-300 hover:text-red-400 text-lg leading-none flex-shrink-0">
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}
