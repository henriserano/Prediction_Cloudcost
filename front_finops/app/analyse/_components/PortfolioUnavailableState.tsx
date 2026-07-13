"use client"

import Link from "next/link"
import { AlertTriangle, ArrowUpRight } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"

// Rendered by the Analyse sub-tabs that can't operate on monthly cloud-billing
// aggregates (Tendances, Anomalies). Both need a daily time series that the
// /billing endpoints don't expose. Rather than fake a computation on monthly
// aggregates, we surface an honest empty state with an escape route.
export function PortfolioUnavailableState({
  tabLabel,
}: {
  tabLabel: string
}) {
  return (
    <SectionCard accent="none">
      <EmptyState
        icon={AlertTriangle}
        title={`${tabLabel} · non disponible en vue portefeuille`}
        description="Cette analyse nécessite une série journalière, or l'agrégat multi-cloud consolidé ne fournit qu'une granularité mensuelle par service. Deux façons de la débloquer."
        action={
          <div className="flex flex-wrap gap-2 justify-center">
            <Link href="/analyse?tab=repartition">
              <Button className="gap-2">
                Voir la Répartition
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
            <Link href="/analyse">
              <Button variant="outline" className="gap-2">
                Basculer en Vue projet
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        }
      />
    </SectionCard>
  )
}
