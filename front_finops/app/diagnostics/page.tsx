"use client"

import { useState } from "react"
import {
  AlertOctagon,
  ActivitySquare,
  BellRing,
  Ruler,
  CircleDashed,
  Layers,
  Sparkles,
} from "lucide-react"
import PageShell from "@/components/layout/PageShell"
import { cn } from "@/lib/utils"

import OutliersTab from "./_components/OutliersTab"
import DriftTab from "./_components/DriftTab"
import DistributionTab from "./_components/DistributionTab"
import ScalingTab from "./_components/ScalingTab"
import MissingTab from "./_components/MissingTab"
import DimReductionTab from "./_components/DimReductionTab"
import EnsembleTab from "./_components/EnsembleTab"

const TABS = [
  { id: "outliers",    label: "Anomalies",       icon: AlertOctagon,   hint: "Z · MAD · IQR · Iso · LOF · Mahal." },
  { id: "drift",       label: "Drift",            icon: ActivitySquare, hint: "KS · PSI · Page-Hinkley" },
  { id: "distribution",label: "Distribution",     icon: BellRing,       hint: "Skew · Kurt · Box-Cox · JB · SW" },
  { id: "scaling",     label: "Scaling",          icon: Ruler,          hint: "Standard · MinMax · Robust" },
  { id: "missing",     label: "Missing",          icon: CircleDashed,   hint: "MCAR · MAR · MNAR" },
  { id: "dim",         label: "Dim. reduction",   icon: Layers,         hint: "PCA · t-SNE" },
  { id: "ensemble",    label: "Ensemble",         icon: Sparkles,       hint: "Bagging · Stacking · Bias-Var" },
] as const

type TabId = (typeof TABS)[number]["id"]

export default function DiagnosticsPage() {
  const [tab, setTab] = useState<TabId>("outliers")

  return (
    <PageShell
      eyebrow="Advanced diagnostics"
      title="Diagnostics"
      description="Suite complète d'analyses statistiques et de tests avancés — anomalies multi-méthodes, drift, normalité, dimensionnalité, ensemble forecasting"
    >
      <nav
        aria-label="Type de diagnostic"
        className="flex rounded-xl border border-border bg-card p-1 gap-1 overflow-x-auto shadow-sm scrollbar-hide"
      >
        {TABS.map(({ id, label, icon: Icon, hint }) => {
          const active = tab === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={active}
              className={cn(
                "group inline-flex flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-sm font-medium transition-all whitespace-nowrap min-w-[125px]",
                active
                  ? "bg-brand text-brand-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <span className="flex items-center gap-2">
                <Icon
                  className={cn(
                    "h-3.5 w-3.5",
                    active ? "text-[color:var(--accent-green)]" : "text-muted-foreground"
                  )}
                  aria-hidden
                />
                {label}
              </span>
              <span
                className={cn(
                  "text-[9.5px] font-medium tracking-wide",
                  active ? "text-white/60" : "text-muted-foreground/60"
                )}
              >
                {hint}
              </span>
            </button>
          )
        })}
      </nav>

      <div key={tab}>
        {tab === "outliers"     && <OutliersTab />}
        {tab === "drift"        && <DriftTab />}
        {tab === "distribution" && <DistributionTab />}
        {tab === "scaling"      && <ScalingTab />}
        {tab === "missing"      && <MissingTab />}
        {tab === "dim"          && <DimReductionTab />}
        {tab === "ensemble"     && <EnsembleTab />}
      </div>
    </PageShell>
  )
}
