import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Portefeuille",
  description:
    "Vision consolidée multi-cloud : regroupez plusieurs comptes GCP, AWS et Azure et obtenez une vue agrégée de la dépense cloud.",
}

export default function PortefeuilleLayout({ children }: { children: React.ReactNode }) {
  return children
}
