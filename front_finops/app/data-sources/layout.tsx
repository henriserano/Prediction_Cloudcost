import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Sources de données",
  description:
    "Alimentez le modèle Sia FinOps : import CSV, connexion Google Cloud ou Amazon Web Services.",
}

export default function DataSourcesLayout({ children }: { children: React.ReactNode }) {
  return children
}
