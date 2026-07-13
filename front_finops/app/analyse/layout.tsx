import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Analyse",
  description:
    "Analyse Sia FinOps : tableau de bord, répartition des coûts, tendances statistiques, détection d'anomalies.",
}

export default function AnalyseLayout({ children }: { children: React.ReactNode }) {
  return children
}
