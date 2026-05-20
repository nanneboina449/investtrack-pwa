// src/components/InviteBanner.jsx
// Shows pending invites at the top of Dashboard
import { usePendingInvites, acceptInvite, declineInvite } from '../hooks/useSharing'
import { useToast } from './ui'

const ROLE_LABELS = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' }
const ROLE_COLORS = {
  owner:  'bg-purple-100 text-purple-800',
  editor: 'bg-blue-100 text-blue-800',
  viewer: 'bg-gray-100 text-gray-700',
}

export default function InviteBanner() {
  const { invites, reload } = usePendingInvites()
  const { show, Toast } = useToast()

  if (invites.length === 0) return null

  const handleAccept = async (invite) => {
    try {
      await acceptInvite(invite.id)
      reload()
      show(`Joined "${invite.project_name}"!`)
    } catch (e) { show(e.message, 'error') }
  }

  const handleDecline = async (invite) => {
    try {
      await declineInvite(invite.id)
      reload()
      show('Invite declined')
    } catch (e) { show(e.message, 'error') }
  }

  return (
    <div className="px-4 pt-4 space-y-2">
      <Toast />
      {invites.map(invite => (
        <div key={invite.id} className="card p-4 border-l-4 border-l-brand-900">
          <div className="flex justify-between items-start mb-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-brand-900 uppercase tracking-wide mb-0.5">
                📨 Project Invite
              </p>
              <p className="font-semibold text-gray-900 truncate">{invite.project_name}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                From {invite.invited_by_name || invite.invited_by_email}
              </p>
            </div>
            <span className={`badge ml-2 flex-shrink-0 ${ROLE_COLORS[invite.role]}`}>
              {ROLE_LABELS[invite.role]}
            </span>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={() => handleAccept(invite)}
              className="flex-1 bg-brand-900 text-white text-sm font-semibold rounded-xl py-2 active:scale-95 transition-transform">
              Accept
            </button>
            <button onClick={() => handleDecline(invite)}
              className="flex-1 bg-gray-100 text-gray-600 text-sm font-semibold rounded-xl py-2 active:scale-95 transition-transform">
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
