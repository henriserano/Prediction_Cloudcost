import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Projection",
  description:
    "Projection Sia FinOps : benchmark de 6 modèles (AutoETS, AutoTheta, AutoARIMA, Prophet, N-HiTS, TimesNet) avec walk-forward CV.",
}

export default function ProjectionLayout({ children }: { children: React.ReactNode }) {
  return children
}
