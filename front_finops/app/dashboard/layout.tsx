import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Vue d'ensemble",
  description:
    "Tableau de bord Sia FinOps : dépense totale, tendance quotidienne, top services et anomalies détectées.",
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children
}
