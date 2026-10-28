import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import type { Role } from './types'

interface AuthState {
  loading: boolean
  session: Session | null
  userId: string | null
  email: string | null
  role: Role | null
  workspaceId: string | null
  noWorkspace: boolean
  isAdmin: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)
export const useAuth = () => useContext(Ctx)!

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<Role | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)

  const loadMembership = useCallback(async (s: Session | null) => {
    if (!s) { setRole(null); setWorkspaceId(null); setNoWorkspace(false); return }
    const { data, error } = await supabase.from('workspace_members').select('role, workspace_id').eq('user_id', s.user.id).maybeSingle()
    if (error || !data) { setRole(null); setWorkspaceId(null); setNoWorkspace(true); return }
    setRole(data.role as Role); setWorkspaceId(data.workspace_id); setNoWorkspace(false)
  }, [])

  useEffect(() => {
    let alive = true
    let currentUserId: string | null = null
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      currentUserId = data.session?.user.id ?? null
      setSession(data.session)
      await loadMembership(data.session)
      if (alive) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      const nextUserId = s?.user.id ?? null
      const userChanged = nextUserId !== currentUserId
      currentUserId = nextUserId
      setSession(s)
      if (userChanged) setLoading(true)
      // defer: calling supabase inside this callback can deadlock
      setTimeout(async () => {
        await loadMembership(s)
        if (alive && userChanged) setLoading(false)
      }, 0)
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [loadMembership])

  const value: AuthState = {
    loading, session, role, workspaceId, noWorkspace,
    userId: session?.user.id ?? null,
    email: session?.user.email ?? null,
    isAdmin: role === 'admin',
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      return error ? error.message : null
    },
    signOut: async () => { await supabase.auth.signOut() },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
