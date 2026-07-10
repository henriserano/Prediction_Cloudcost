"use client"

import * as React from "react"
import { LogIn, ShieldAlert, User as UserIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/lib/context/auth-context"

const PIN_LEN = 6

/**
 * Full-screen login gate rendered as long as no user session is active.
 * Kept intentionally lightweight (no react-router redirect, no /login page):
 * the moment ``useAuth().user`` becomes non-null, children render.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading, signup } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Chargement…</div>
      </div>
    )
  }

  if (!user) return <LoginScreen onAuth={signup} />
  return <>{children}</>
}

function LoginScreen({
  onAuth,
}: {
  onAuth: (displayName: string, pin: string) => Promise<unknown>
}) {
  const [name, setName] = React.useState("")
  const [pin, setPin] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const pinOk = /^\d{6}$/.test(pin)
  const nameOk = name.trim().length > 0
  const canSubmit = pinOk && nameOk && !submitting

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await onAuth(name.trim(), pin)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue")
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[color:var(--accent-green)]/25 to-[color:var(--brand)]/15 ring-1 ring-[color:var(--accent-green)]/30">
            <LogIn className="h-5 w-5 text-[color:var(--accent-green)]" />
          </div>
          <h1 className="font-heading text-xl font-semibold tracking-tight">
            Assistant FinOps Sia
          </h1>
          <p className="text-sm text-muted-foreground">
            Entre ton nom et un PIN à 6 chiffres. Nouveau nom = compte créé.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="auth-name"
              className="text-xs font-medium text-foreground/80"
            >
              Nom
            </label>
            <div className="relative">
              <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="auth-name"
                autoFocus
                autoComplete="username"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ex. Henri"
                maxLength={64}
                className="pl-9"
                disabled={submitting}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="auth-pin"
              className="text-xs font-medium text-foreground/80"
            >
              PIN (6 chiffres)
            </label>
            <Input
              id="auth-pin"
              inputMode="numeric"
              pattern="\d{6}"
              autoComplete="current-password"
              value={pin}
              onChange={(e) =>
                setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_LEN))
              }
              placeholder="••••••"
              maxLength={PIN_LEN}
              className="tracking-[0.4em] text-center font-mono"
              disabled={submitting}
            />
          </div>

          {error && (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              POC — un PIN 6 chiffres n&apos;est pas une authentification robuste.
              Ne stocke pas de vraies données production.
            </span>
          </div>

          <Button type="submit" disabled={!canSubmit} className="w-full">
            {submitting ? "Connexion..." : "Se connecter"}
          </Button>
        </form>
      </div>
    </div>
  )
}
