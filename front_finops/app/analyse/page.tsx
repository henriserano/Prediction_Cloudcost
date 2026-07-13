"use client"

import { Suspense, useCallback } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  AlertOctagon,
  Briefcase,
  HardDrive,
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

  const pushUrl = useCallback(
    (patch: { tab?: TabId; source?: AnalyseSource; portfolio?: string | null }) => {
      const next = new URLSearchParams(searchParams)
      if (patch.tab !== undefined) {
        if (patch.tab === DEFAULT_TAB) next.delete("tab")
        else next.set("tab", patch.tab)
      }
      if (patch.source !== undefined) {
        if (patch.source === DEFAULT_SOURCE) next.delete("source")
        else next.set("source", patch.source)
      }
      if (patch.portfolio !== undefined) {
        if (patch.portfolio === null) next.delete("portfolio")
        else next.set("portfolio", patch.portfolio)
      }
      router.replace(next.size > 0 ? `/analyse?${next.toString()}` : "/analyse", {
        scroll: false,
      })
    },
    [router, searchParams],
  )

  const portfolioAvailable = portfolios.length > 0
  const tabProps: AnalyseTabProps = { source, portfolio }

  return (
    <>
      {/* Sub-tab nav — same as before */}
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
              onClick={() => pushUrl({ tab: id })}
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

      {/* Global source picker — Vue projet vs Vue portefeuille. Sits below the
          sub-tab nav so it visually applies to whichever sub-tab is active. */}
      <div className="flex flex-wrap items-center gap-3">
        <nav
          aria-label="Source des données"
          className="inline-flex rounded-xl border border-border bg-card p-1 gap-1 shadow-sm"
        >
          <button
            type="button"
            onClick={() => pushUrl({ source: "projet", portfolio: null })}
            aria-pressed={source === "projet"}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all",
              source === "projet"
                ? "bg-brand text-brand-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <HardDrive
              className={cn(
                "h-3.5 w-3.5",
                source === "projet" ? "text-[color:var(--accent-green)]" : "text-muted-foreground",
              )}
              aria-hidden
            />
            <span>Vue projet</span>
            <span
              className={cn(
                "text-[10px] font-medium",
                source === "projet" ? "text-white/60" : "text-muted-foreground/60",
              )}
            >
              Données ingérées
            </span>
          </button>
          <button
            type="button"
            onClick={() => pushUrl({ source: "portefeuille", portfolio: portfolioId })}
            disabled={!portfolioAvailable}
            aria-pressed={source === "portefeuille"}
            title={
              portfolioAvailable
                ? undefined
                : "Créez un portefeuille depuis la page Portefeuille pour activer cette vue"
            }
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed",
              source === "portefeuille"
                ? "bg-brand text-brand-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Briefcase
              className={cn(
                "h-3.5 w-3.5",
                source === "portefeuille" ? "text-[color:var(--accent-green)]" : "text-muted-foreground",
              )}
              aria-hidden
            />
            <span>Vue portefeuille</span>
            <span
              className={cn(
                "text-[10px] font-medium max-w-[140px] truncate",
                source === "portefeuille" ? "text-white/60" : "text-muted-foreground/60",
              )}
            >
              {portfolioAvailable
                ? `${portfolios.length} défini${portfolios.length > 1 ? "s" : ""}`
                : "aucun"}
            </span>
          </button>
        </nav>

        {source === "portefeuille" && portfolioAvailable && (
          <select
            value={portfolioId ?? ""}
            onChange={(e) => pushUrl({ portfolio: e.target.value })}
            aria-label="Portefeuille actif"
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-green)]/40"
          >
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.members.length} src
              </option>
            ))}
          </select>
        )}

        {source === "portefeuille" && !portfolioAvailable && (
          <p className="text-xs text-muted-foreground">
            <Link
              href="/portefeuille"
              className="underline underline-offset-2 text-foreground hover:text-[color:var(--accent-green)]"
            >
              Créer un portefeuille
            </Link>{" "}
            pour activer cette vue.
          </p>
        )}
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
    >
      <Suspense fallback={<Skeleton className="h-[400px]" />}>
        <AnalyseContent />
      </Suspense>
    </PageShell>
  )
}
