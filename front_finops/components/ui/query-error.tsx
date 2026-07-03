"use client"

import { AlertTriangle, RotateCcw } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"

interface QueryErrorProps {
  title?: string
  description?: string
  /** Refetch the failed queries. */
  onRetry: () => void
}

/**
 * Full-width error state for pages whose main TanStack Query requests failed
 * (backend down, network error…). Same visual language as the error block of
 * app/services/page.tsx, plus a retry button wired to refetch().
 */
export function QueryError({
  title = "Impossible de charger les données",
  description = "Le backend ne répond pas ou a renvoyé une erreur. Vérifiez la connexion et réessayez.",
  onRetry,
}: QueryErrorProps) {
  return (
    <SectionCard accent="none">
      <EmptyState
        icon={AlertTriangle}
        title={title}
        description={description}
        action={
          <Button onClick={onRetry} className="gap-2">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Réessayer
          </Button>
        }
      />
    </SectionCard>
  )
}
