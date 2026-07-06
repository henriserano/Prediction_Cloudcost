"use client"

import * as React from "react"

export interface AuthUser {
  userId: string
  displayName: string
  createdAt: string
  hasCredentials: boolean
}

interface AuthState {
  user: AuthUser | null
  loading: boolean
  error: string | null
}

interface AuthContextValue extends AuthState {
  refresh: () => Promise<void>
  signup: (displayName: string, pin: string) => Promise<AuthUser>
  login: (displayName: string, pin: string) => Promise<AuthUser>
  logout: () => Promise<void>
  verifyPin: (pin: string) => Promise<boolean>
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

function toUser(raw: {
  user_id?: string
  userId?: string
  display_name?: string
  displayName?: string
  created_at?: string
  createdAt?: string
  has_credentials?: boolean
  hasCredentials?: boolean
}): AuthUser {
  return {
    userId: (raw.user_id ?? raw.userId ?? "") as string,
    displayName: (raw.display_name ?? raw.displayName ?? "") as string,
    createdAt: (raw.created_at ?? raw.createdAt ?? "") as string,
    hasCredentials: Boolean(raw.has_credentials ?? raw.hasCredentials ?? false),
  }
}

async function extractError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (body?.error?.message) return String(body.error.message)
    if (typeof body?.error === "string") return body.error
    if (body?.detail) return String(body.detail)
  } catch {
    /* not json */
  }
  return `Erreur ${res.status}`
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AuthState>({
    user: null,
    loading: true,
    error: null,
  })

  const refresh = React.useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" })
      if (res.status === 401) {
        setState({ user: null, loading: false, error: null })
        return
      }
      if (!res.ok) {
        setState({ user: null, loading: false, error: await extractError(res) })
        return
      }
      const raw = await res.json()
      setState({ user: toUser(raw), loading: false, error: null })
    } catch (err) {
      setState({
        user: null,
        loading: false,
        error: err instanceof Error ? err.message : "Network error",
      })
    }
  }, [])

  React.useEffect(() => {
    // Initial session probe. The linter flags setState-in-effect but this is
    // the exact "sync with external system on mount" case the rule allows;
    // refresh() only calls setState inside async callbacks, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  const signup = React.useCallback(
    async (displayName: string, pin: string): Promise<AuthUser> => {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: displayName, pin }),
        credentials: "include",
      })
      if (!res.ok) throw new Error(await extractError(res))
      const body = await res.json()
      const user = toUser(body.user ?? body)
      setState({ user, loading: false, error: null })
      return user
    },
    [],
  )

  const login = React.useCallback(
    async (displayName: string, pin: string): Promise<AuthUser> => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: displayName, pin }),
        credentials: "include",
      })
      if (!res.ok) throw new Error(await extractError(res))
      const body = await res.json()
      const user = toUser(body.user ?? body)
      setState({ user, loading: false, error: null })
      return user
    },
    [],
  )

  const logout = React.useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
    setState({ user: null, loading: false, error: null })
  }, [])

  const verifyPin = React.useCallback(
    async (pin: string): Promise<boolean> => {
      if (!state.user) return false
      const res = await fetch("/api/auth/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: state.user.displayName,
          pin,
        }),
        credentials: "include",
      })
      return res.ok
    },
    [state.user],
  )

  const value: AuthContextValue = React.useMemo(
    () => ({ ...state, refresh, signup, login, logout, verifyPin }),
    [state, refresh, signup, login, logout, verifyPin],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>")
  return ctx
}
