import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Analytique",
  description:
    "Décomposition STL, statistiques descriptives, détection d'anomalies ±2σ et tests de stationnarité ADF + KPSS.",
}

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return children
}
