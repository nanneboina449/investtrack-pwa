// src/contexts/AuthContext.jsx
import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isMisconfigured } from '../lib/supabase'

const AuthContext = createContext(null)

// Auto-accept project_members rows whose invited_email matches the
// logged-in user's email. Used to live in Dashboard.jsx; moved here in
// 2026-05 so it fires regardless of which page is the home route.
//
// Without this, an investor added with an email on a project sees an
// empty Projects list — their project_members row stays status='pending'
// with user_id=NULL, and RLS on my_projects requires user_id=auth.uid()
// AND status='accepted'.
//
// Idempotent — running it when there are no pending invites is a no-op.
async function autoAcceptInvites() {
  try {
    await supabase.rpc('accept_pending_invites')
  } catch (e) {
    // Don't block sign-in if the RPC fails; just log.
    // eslint-disable-next-line no-console
    console.warn('accept_pending_invites failed:', e?.message ?? e)
  }
}

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(!isMisconfigured)

  useEffect(() => {
    if (isMisconfigured) return

    let mounted = true

    // Initial session check — accepts any pending invites the user
    // already has waiting (e.g. they were invited before this session).
    supabase.auth.getSession().then(async ({ data }) => {
      const u = data.session?.user ?? null
      if (mounted) {
        setUser(u)
        setLoading(false)
      }
      if (u) autoAcceptInvites()
    })

    // React to sign-in / sign-out across tabs and after token refresh.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null
      setUser(u)
      // Only run auto-accept on actual sign-in events; skip refresh
      // ticks and sign-outs.
      if (u && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED')) {
        autoAcceptInvites()
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signIn = (email, password) =>
    supabase.auth.signInWithPassword({ email, password })

  const signUp = (email, password) =>
    supabase.auth.signUp({ email, password })

  const signOut = () => supabase.auth.signOut()

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
