import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Diagnostics",
  description:
    "Diagnostics avancés Sia FinOps : anomalies (Z, MAD, IQR, IsolationForest, LOF, Mahalanobis), drift (KS, PSI, Page-Hinkley), distribution (Box-Cox, JB, Shapiro), scaling, missing (MCAR/MAR/MNAR), PCA/t-SNE, ensemble forecast.",
}

export default function DiagnosticsLayout({ children }: { children: React.ReactNode }) {
  return children
}
