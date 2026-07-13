import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Collecte des données",
  description:
    "Connectez le modèle Sia FinOps à vos flux de facturation cloud : import CSV/Excel, Google Cloud, AWS, Azure.",
}

export default function CollecteLayout({ children }: { children: React.ReactNode }) {
  return children
}
