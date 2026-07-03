import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "GCP Connect",
  description:
    "Connectez votre compte Google Cloud pour importer facturation, journaux et services activés dans Sia FinOps.",
}

export default function GCPConnectLayout({ children }: { children: React.ReactNode }) {
  return children
}
