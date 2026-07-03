import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Prévision",
  description:
    "Prévision Sia FinOps : benchmark de 6 modèles (AutoETS, AutoTheta, AutoARIMA, Prophet, N-HiTS, TimesNet) avec walk-forward CV.",
}

export default function ForecastLayout({ children }: { children: React.ReactNode }) {
  return children
}
