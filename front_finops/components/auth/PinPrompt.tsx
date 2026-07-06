"use client"

import * as React from "react"
import { KeyRound } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface PinPromptProps {
  open: boolean
  title?: string
  description?: string
  submitLabel?: string
  onCancel: () => void
  onConfirm: (pin: string) => Promise<void> | void
}

/**
 * Modal that asks the user to re-enter their PIN. Used before revealing or
 * adding credentials. The parent controls submission (typically calls the
 * back with the PIN itself, so we don't leak it to sibling components).
 */
export function PinPrompt({
  open,
  title = "Confirme ton PIN",
  description = "Ré-entre ton PIN pour déverrouiller le coffre de crédentials.",
  submitLabel = "Confirmer",
  onCancel,
  onConfirm,
}: PinPromptProps) {
  const [pin, setPin] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    // Reset fields when the modal closes. Sync between the parent-controlled
    // "open" prop and internal ephemeral state.
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPin("")
      setError(null)
      setSubmitting(false)
    }
  }, [open])

  const canSubmit = /^\d{6}$/.test(pin) && !submitting

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm(pin)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue")
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[color:var(--accent-coral)]" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <Input
            autoFocus
            inputMode="numeric"
            pattern="\d{6}"
            autoComplete="current-password"
            value={pin}
            onChange={(e) =>
              setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="••••••"
            maxLength={6}
            className="tracking-[0.4em] text-center font-mono"
            disabled={submitting}
          />

          {error && (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={submitting}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? "Vérification..." : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
