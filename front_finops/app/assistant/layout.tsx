import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Assistant",
  description:
    "Assistant analytique Sia FinOps : interroge les KPI, prévisions, anomalies et diagnostics en langage naturel.",
}

export default function AssistantLayout({ children }: { children: React.ReactNode }) {
  return children
}
