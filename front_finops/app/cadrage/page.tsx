"use client"

import PageShell from "@/components/layout/PageShell"
import { SimulationTab } from "./_components/SimulationTab"

export default function CadragePage() {
  return (
    <PageShell
      eyebrow="Étape 1 · Cadrage"
      title="Simuler les coûts d'un projet"
      description="Estimez la facture cloud d'un projet avant son lancement — LLM, outils, cible de déploiement, risques et recommandations d'architecture."
    >
      <SimulationTab />
    </PageShell>
  )
}
