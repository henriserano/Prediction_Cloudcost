"use client"

import PageShell from "@/components/layout/PageShell"
import { PortefeuilleView } from "./_components/PortefeuilleView"

export default function PortefeuillePage() {
  return (
    <PageShell
      eyebrow="Collecte · Portefeuille"
      title="Vue portefeuille multi-cloud"
      description="Regroupez plusieurs comptes GCP, AWS et Azure pour obtenir une vue consolidée de vos dépenses cloud. Lecture seule : n'écrit pas dans le store d'événements."
    >
      <PortefeuilleView />
    </PageShell>
  )
}
