"use client"

import { useEffect } from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"

// App Router error boundary — catches render/runtime errors below the root
// layout and offers a reset instead of a blank screen.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface the error in the console for debugging / monitoring.
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-1 min-h-[60vh] items-center justify-center bg-background p-6">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-xl border border-border bg-card px-8 py-10 text-center shadow-sm">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"
          aria-hidden
        >
          <AlertTriangle className="h-6 w-6" />
        </span>
        <div className="space-y-1.5">
          <h1 className="font-heading text-lg font-semibold text-foreground">
            Une erreur est survenue
          </h1>
          <p className="text-sm text-muted-foreground">
            La page n&apos;a pas pu s&apos;afficher correctement. Réessayez, ou revenez plus tard si le problème persiste.
          </p>
          {error.digest && (
            <p className="text-[11px] text-muted-foreground/70 tabular-nums">
              Référence : {error.digest}
            </p>
          )}
        </div>
        <Button onClick={reset} className="gap-2">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Réessayer
        </Button>
      </div>
    </div>
  )
}
