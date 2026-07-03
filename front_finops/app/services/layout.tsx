import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Services",
  description:
    "Analyse Pareto 80/20 des services cloud : répartition du coût, part cumulée et volatilité (coefficient de variation).",
}

export default function ServicesLayout({ children }: { children: React.ReactNode }) {
  return children
}
