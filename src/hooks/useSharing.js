// src/hooks/useSharing.js
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ── Fetch members of a project ───────────────────────────────
export function useProjectMembers(projectId) {
  const [members, setMembers]   = useState([])
  const [loading, setLoading]   = useState(true)

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    const { data } = await supabase
      .from('project_members')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at')
    setMembers(data ?? [])
    setLoading(false)
  }, [projectId])

  useEffect(() => { load() }, [load])
  return { members, loading, reload: load }
}

// ── Fetch pending invites for current user ───────────────────
export function usePendingInvites() {
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('my_pending_invites')
      .select('*')
      .order('created_at', { ascending: false })
    setInvites(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  return { invites, loading, reload: load }
}

// ── Invite a user by email ───────────────────────────────────
export async function inviteUser({ projectId, email, role }) {
  const { data: { session } } = await supabase.auth.getSession()
  const { error } = await supabase.from('project_members').insert({
    project_id:    projectId,
    invited_by:    session?.user?.id,
    invited_email: email.toLowerCase().trim(),
    role,
    status:        'pending'
  })
  if (error) throw error
}

// ── Accept an invite ─────────────────────────────────────────
export async function acceptInvite(inviteId) {
  const { data: { session } } = await supabase.auth.getSession()
  const { error } = await supabase
    .from('project_members')
    .update({ status: 'accepted', user_id: session?.user?.id, accepted_at: new Date().toISOString() })
    .eq('id', inviteId)
  if (error) throw error
}

// ── Decline an invite ────────────────────────────────────────
export async function declineInvite(inviteId) {
  const { error } = await supabase
    .from('project_members')
    .update({ status: 'declined' })
    .eq('id', inviteId)
  if (error) throw error
}

// ── Remove a member ──────────────────────────────────────────
export async function removeMember(memberId) {
  const { error } = await supabase
    .from('project_members')
    .delete()
    .eq('id', memberId)
  if (error) throw error
}

// ── Update member role ───────────────────────────────────────
export async function updateMemberRole(memberId, role) {
  const { error } = await supabase
    .from('project_members')
    .update({ role })
    .eq('id', memberId)
  if (error) throw error
}

// ── Auto-accept pending invites on login ─────────────────────
export async function acceptPendingInvites() {
  await supabase.rpc('accept_pending_invites')
}

// ── Get my role on a project ─────────────────────────────────
export function useMyRole(projectId, isOwner) {
  const [role, setRole] = useState(isOwner ? 'owner' : null)

  useEffect(() => {
    if (isOwner) { setRole('owner'); return }
    if (!projectId) return
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase
        .from('project_members')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', user.id)
        .eq('status', 'accepted')
        .single()
        .then(({ data }) => { if (data) setRole(data.role) })
    })
  }, [projectId, isOwner])

  return {
    role,
    isOwner:  role === 'owner',
    canEdit:  role === 'owner' || role === 'editor',
    canView:  !!role,
  }
}
