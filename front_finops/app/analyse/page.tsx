"use client"

import { Suspense, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  AlertOctagon,
  LayoutDashboard,
  LineChart,
  PieChart,
} from "lucide-react"
import PageShell from "@/components/layout/PageShell"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { usePortfolios, type Portfolio } from "@/lib/hooks/usePortfolios"

import { TableauDeBordTab } from "./_tabs/TableauDeBordTab"
import { RepartitionTab } from "./_tabs/RepartitionTab"
import { TendancesTab } from "./_tabs/TendancesTab"
import { AnomaliesTab } from "./_tabs/AnomaliesTab"
import { SourcePicker } from "./_components/SourcePicker"

const TABS = [
  {
    id: "tableau-de-bord",
    label: "Tableau de bord",
    icon: LayoutDashboard,
    hint: "Vue d'ensemble",
  },
  {
    id: "repartition",
    label: "Répartition des coûts",
    icon: PieChart,
    hint: "Services · Volatilité",
  },
  {
    id: "tendances",
    label: "Tendances & stats",
    icon: LineChart,
    hint: "STL · Stationnarité",
  },
  {
    id: "anomalies",
    label: "Détection d'anomalies",
    icon: AlertOctagon,
    hint: "Drift · Ensemble · Missing",
  },
] as const

type TabId = (typeof TABS)[number]["id"]
export type AnalyseSource = "projet" | "portefeuille"

const DEFAULT_TAB: TabId = "tableau-de-bord"
const DEFAULT_SOURCE: AnalyseSource = "projet"

function isTabId(v: string | null): v is TabId {
  return v != null && TABS.some((t) => t.id === v)
}
function isSource(v: string | null): v is AnalyseSource {
  return v === "projet" || v === "portefeuille"
}

// Shared props all sub-tabs receive. Each tab decides what to do with
// `source`/`portfolio` — Répartition switches its aggregator, Tableau de bord
// simplifies its KPIs, Tendances/Anomalies render an unavailable state.
export interface AnalyseTabProps {
  source: AnalyseSource
  portfolio: Portfolio | null
}

function AnalyseContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { portfolios } = usePortfolios()

  const tab: TabId = isTabId(searchParams.get("tab")) ? (searchParams.get("tab") as TabId) : DEFAULT_TAB
  const rawSource = searchParams.get("source")
  const source: AnalyseSource = isSource(rawSource) && portfolios.length > 0 ? rawSource : DEFAULT_SOURCE
  const rawPortfolioId = searchParams.get("portfolio")
  const portfolioId =
    rawPortfolioId && portfolios.some((p) => p.id === rawPortfolioId)
      ? rawPortfolioId
      : portfolios[0]?.id ?? null
  const portfolio = source === "portefeuille"
    ? portfolios.find((p) => p.id === portfolioId) ?? null
    : null

  const pushTab = useCallback(
    (nextTab: TabId) => {
      const next = new URLSearchParams(searchParams)
      if (nextTab === DEFAULT_TAB) next.delete("tab")
      else next.set("tab", nextTab)
      router.replace(next.size > 0 ? `/analyse?${next.toString()}` : "/analyse", {
        scroll: false,
      })
    },
    [router, searchParams],
  )

  const tabProps: AnalyseTabProps = { source, portfolio }

  return (
    <>
      {/* Sub-tab nav */}
      <nav
        aria-label="Sous-section d'analyse"
        className="inline-flex rounded-xl border border-border bg-card p-1 gap-1 flex-wrap shadow-sm"
      >
        {TABS.map(({ id, label, icon: Icon, hint }) => {
          const active = tab === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => pushTab(id)}
              aria-pressed={active}
              className={cn(
                "group inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all",
                active
                  ? "bg-brand text-brand-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon
                className={cn(
                  "h-3.5 w-3.5",
                  active ? "text-[color:var(--accent-green)]" : "text-muted-foreground",
                )}
                aria-hidden
              />
              <span>{label}</span>
              <span
                className={cn(
                  "text-[10px] font-medium",
                  active ? "text-white/60" : "text-muted-foreground/60",
                )}
              >
                {hint}
              </span>
            </button>
          )
        })}
      </nav>

      {/* Mobile / narrow-screen fallback for the source picker. On lg+ screens
          the header slot renders it instead — see AnalysePage below. */}
      <div className="lg:hidden">
        <SourcePicker variant="inline" />
      </div>

      {/* Active tab body — remounts on tab OR source change so intra-tab state
          resets (avoids stale filters when switching source). */}
      <div key={`${tab}:${source}:${portfolio?.id ?? ""}`} className="space-y-4 lg:space-y-5">
        {tab === "tableau-de-bord" && <TableauDeBordTab {...tabProps} />}
        {tab === "repartition" && <RepartitionTab {...tabProps} />}
        {tab === "tendances" && <TendancesTab {...tabProps} />}
        {tab === "anomalies" && <AnomaliesTab {...tabProps} />}
      </div>
    </>
  )
}

export default function AnalysePage() {
  return (
    <PageShell
      eyebrow="Comprendre · Analyse"
      title="Visualiser les flux et suivre les dépenses"
      description="Tableau de bord, répartition des coûts, tendances statistiques et détection d'anomalies — tout ce dont vous avez besoin pour comprendre où part la facture."
      actions={
        // SourcePicker reads searchParams so it must sit inside Suspense.
        // Hidden on mobile because PageShell doesn't render actions on the
        // narrow top bar — the inline fallback in AnalyseContent takes over.
        <Suspense fallback={null}>
          <SourcePicker variant="header" />
        </Suspense>
      }
    >
      <Suspense fallback={<Skeleton className="h-[400px]" />}>
        <AnalyseContent />
      </Suspense>
    </PageShell>
  )
}
