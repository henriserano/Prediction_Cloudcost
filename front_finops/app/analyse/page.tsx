"use client"

import { Suspense, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { LayoutDashboard, PieChart, LineChart, AlertOctagon } from "lucide-react"
import PageShell from "@/components/layout/PageShell"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

import { TableauDeBordTab } from "./_tabs/TableauDeBordTab"
import { RepartitionTab } from "./_tabs/RepartitionTab"
import { TendancesTab } from "./_tabs/TendancesTab"
import { AnomaliesTab } from "./_tabs/AnomaliesTab"

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

const DEFAULT_TAB: TabId = "tableau-de-bord"

function isTabId(v: string | null): v is TabId {
  return v != null && TABS.some((t) => t.id === v)
}

function AnalyseContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const raw = searchParams.get("tab")
  const tab: TabId = isTabId(raw) ? raw : DEFAULT_TAB

  // URL is the source of truth so the four legacy routes (/dashboard, /services,
  // /analytics, /diagnostics) can redirect straight to /analyse?tab=<slug>
  // and land the user on the correct sub-tab.
  const setTab = useCallback(
    (id: TabId) => {
      const next = new URLSearchParams(searchParams)
      if (id === DEFAULT_TAB) next.delete("tab")
      else next.set("tab", id)
      router.replace(next.size > 0 ? `/analyse?${next.toString()}` : "/analyse", {
        scroll: false,
      })
    },
    [router, searchParams],
  )

  return (
    <>
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
              onClick={() => setTab(id)}
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

      <div key={tab} className="space-y-4 lg:space-y-5">
        {tab === "tableau-de-bord" && <TableauDeBordTab />}
        {tab === "repartition" && <RepartitionTab />}
        {tab === "tendances" && <TendancesTab />}
        {tab === "anomalies" && <AnomaliesTab />}
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
    >
      <Suspense fallback={<Skeleton className="h-[400px]" />}>
        <AnalyseContent />
      </Suspense>
    </PageShell>
  )
}
