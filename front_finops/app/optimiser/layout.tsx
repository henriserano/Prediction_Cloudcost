import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Optimiser",
  description:
    "Recommandations Sia FinOps : choix de modèles, arbitrages d'infrastructure, projets à ralentir ou à arrêter.",
}

export default function OptimiserLayout({ children }: { children: React.ReactNode }) {
  return children
}
