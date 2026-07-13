import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Estimation projet",
  description:
    "Simulez les coûts d'un projet avant son lancement : LLM, outils, cible de déploiement, risques et architecture recommandée.",
}

export default function CadrageLayout({ children }: { children: React.ReactNode }) {
  return children
}
