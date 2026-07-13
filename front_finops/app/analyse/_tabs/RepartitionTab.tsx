"use client"

import { useMemo } from "react"
import Link from "next/link"
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts"
import { Layers, Crown, PieChart, Briefcase, ArrowUpRight } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { KpiCard } from "@/components/ui/kpi-card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { useServices } from "@/lib/hooks/useApi"
import { isAllLocal, usePortfolioAggregate } from "@/lib/hooks/usePortfolios"
import { cn, truncateLabel } from "@/lib/utils"
import type { AnalyseTabProps } from "../page"

// Sia chart palette — black, green, sky-deep, blush-deep, gold
const CHART_COLORS = [
  "oklch(0.14 0 0)",
  "oklch(0.68 0.15 160)",
  "oklch(0.65 0.13 240)",
  "oklch(0.72 0.14 15)",
  "oklch(0.75 0.15 78)",
  "oklch(0.62 0.14 155)",
  "oklch(0.48 0.02 250)",
  "oklch(0.60 0.11 195)",
]

const COLOR_GREEN = "oklch(0.68 0.15 160)"
const COLOR_MUTED = "oklch(0.65 0.02 250)"

import type { ServiceCategory } from "@/lib/types"
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/service-taxonomy"

type Source = "projet" | "portefeuille"

interface UnifiedRow {
  service: string
  cost: number
  pct: number
  cumPct: number
  cv: number | null // null when source doesn't provide daily volatility
  category: ServiceCategory
}

/** Guess a category client-side when the backend doesn't provide one
 *  (currently: GCP billing endpoint). Substring, case-insensitive. */
function guessCategory(service: string): ServiceCategory {
  const s = service.toLowerCase()
  const rules: [string, ServiceCategory][] = [
    ["vertex ai", "ai_ml"], ["bedrock", "ai_ml"], ["claude", "ai_ml"], ["gemini", "ai_ml"],
    ["gpt", "ai_ml"], ["automl", "ai_ml"],
    ["bigquery", "analytics"], ["looker", "analytics"], ["dataflow", "analytics"], ["dataproc", "analytics"],
    ["pubsub", "analytics"], ["pub/sub", "analytics"],
    ["cloud sql", "database"], ["firestore", "database"], ["spanner", "database"], ["bigtable", "database"],
    ["memorystore", "database"],
    ["cloud storage", "storage"], ["filestore", "storage"], ["persistent disk", "storage"],
    ["cloud cdn", "network"], ["cloud dns", "network"], ["load balancing", "network"], ["vpc", "network"],
    ["cloud run", "compute"], ["cloud functions", "compute"], ["app engine", "compute"],
    ["compute engine", "compute"], ["kubernetes", "compute"], ["cloud build", "compute"],
    ["kms", "security"], ["secret manager", "security"], ["iam", "security"], ["cloud armor", "security"],
    ["cloud logging", "observability"], ["cloud monitoring", "observability"], ["cloud trace", "observability"],
  ]
  for (const [k, cat] of rules) if (s.includes(k)) return cat
  return "other"
}

function CategoryBadge({ category }: { category: ServiceCategory }) {
  const meta = CATEGORY_META[category]
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        meta.bgClass,
        meta.textClass,
      )}
      title={meta.label}
    >
      <span className={cn("inline-block h-1.5 w-1.5 rounded-full", meta.dotClass)} aria-hidden />
      {meta.label}
    </span>
  )
}

function CategoryLegend({ rows }: { rows: UnifiedRow[] }) {
  const totals = new Map<ServiceCategory, number>()
  for (const r of rows) {
    totals.set(r.category, (totals.get(r.category) ?? 0) + r.cost)
  }
  const grand = rows.reduce((s, r) => s + r.cost, 0)
  const active = CATEGORY_ORDER.filter((c) => (totals.get(c) ?? 0) > 0)
  if (active.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Catégories
      </span>
      {active.map((cat) => {
        const meta = CATEGORY_META[cat]
        const cost = totals.get(cat) ?? 0
        const pct = grand > 0 ? (cost / grand) * 100 : 0
        return (
          <span
            key={cat}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px]",
              meta.bgClass,
              meta.textClass,
            )}
            title={`${meta.label}: ${cost.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} (${pct.toFixed(1)}%)`}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", meta.dotClass)} aria-hidden />
            <span className="font-medium">{meta.label}</span>
            <span className="tabular-nums opacity-75">{pct.toFixed(1)}%</span>
          </span>
        )
      })}
    </div>
  )
}

function CVBadge({ cv }: { cv: number | null }) {
  if (cv == null) return <Badge variant="muted">N/A</Badge>
  if (cv < 20) return <Badge variant="success">Stable</Badge>
  if (cv < 60) return <Badge variant="warning">Modéré</Badge>
  return <Badge variant="destructive">Volatile</Badge>
}

// ---------------------------------------------------------------------------
// Page — source + portfolio come from the /analyse page-level picker via props.
// ---------------------------------------------------------------------------

export function RepartitionTab({ source, portfolio }: AnalyseTabProps) {
  // Fall back to projet when: no portfolio selected, OR the portfolio only
  // contains local members (data is identical to the local events store, and
  // the projet body has the CV/volatility column that the aggregate can't
  // reconstruct from monthly data).
  const effectiveSource: Source =
    source === "portefeuille" && portfolio && !isAllLocal(portfolio)
      ? "portefeuille"
      : "projet"

  // ── LOCAL data (vue projet) ───────────────────────────────────────────────
  const {
    data: localServices,
    isLoading: localLoading,
    error: localError,
  } = useServices()

  // ── PORTFOLIO data (vue portefeuille) ─────────────────────────────────────
  // Only fan out when the portfolio view is actually active — usePortfolioAggregate
  // returns an inert result when passed `null`.
  const aggregate = usePortfolioAggregate(
    effectiveSource === "portefeuille" ? portfolio : null,
  )

  // Adapt to a single unified row shape. Vue projet keeps the daily-derived
  // CV (volatility); vue portefeuille has no daily granularity so cv=null.
  const rows: UnifiedRow[] = useMemo(() => {
    if (effectiveSource === "projet") {
      return (localServices ?? []).map((s) => ({
        service: s.service,
        cost: s.cost,
        pct: s.pct,
        cumPct: s.cumPct,
        cv: s.cv,
        category: s.category ?? guessCategory(s.service),
      }))
    }
    return aggregate.topServices.map((s) => ({
      service: s.service,
      cost: s.cost,
      pct: s.pct,
      cumPct: s.cumPct,
      cv: null,
      category: guessCategory(s.service),
    }))
  }, [effectiveSource, localServices, aggregate.topServices])

  const isLoading = effectiveSource === "projet" ? localLoading : aggregate.loading
  const hasError = effectiveSource === "projet" ? !!localError : aggregate.hasAnyError && !aggregate.hasAnyData

  const currency = effectiveSource === "portefeuille" ? aggregate.currency : "EUR"
  const top5Pct = rows.slice(0, 5).reduce((s, r) => s + r.pct, 0)
  const topRow = rows[0]

  const periodLabel =
    effectiveSource === "portefeuille" && aggregate.monthly.length > 0
      ? `${aggregate.monthly[0].month} → ${aggregate.monthly[aggregate.monthly.length - 1].month}`
      : "Période complète"

  const description =
    effectiveSource === "portefeuille" && portfolio
      ? `Portefeuille · ${portfolio.name} · ${portfolio.members.length} compte${portfolio.members.length > 1 ? "s" : ""} agrégé${portfolio.members.length > 1 ? "s" : ""}`
      : "Analyse Pareto 80/20 · répartition et volatilité par service"

  return (
    <>
      {/* Contextual description — the source picker itself lives at the
          /analyse page level so all sub-tabs stay in sync. */}
      <p className="text-sm text-muted-foreground max-w-3xl">{description}</p>

      {/* Portefeuille asked but no portfolio is currently selected → gentle
          empty state guiding the user to /portefeuille. */}
      {source === "portefeuille" && !portfolio && (
        <SectionCard accent="green">
          <EmptyState
            icon={Briefcase}
            title="Aucun portefeuille sélectionné"
            description="Créez un portefeuille depuis la page Portefeuille pour agréger plusieurs comptes cloud dans cette vue."
            action={
              <Link href="/portefeuille">
                <Button className="gap-2">
                  Créer un portefeuille
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            }
          />
        </SectionCard>
      )}

      {/* Error on the active source */}
      {hasError && (
        <SectionCard accent="none">
          <EmptyState
            title={
              effectiveSource === "portefeuille"
                ? "Impossible de charger les données du portefeuille"
                : "Impossible de charger les données locales"
            }
            description={
              effectiveSource === "portefeuille"
                ? "Un ou plusieurs providers ont refusé la requête billing (permission ou session expirée)."
                : "Vérifiez la connexion au backend et réessayez."
            }
          />
        </SectionCard>
      )}

      {/* KPI overview */}
      {!hasError && (
        <section aria-label="Indicateurs services" className="grid grid-cols-1 sm:grid-cols-3 gap-3 lg:gap-4">
          {(isLoading || rows.length === 0) ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)
          ) : (
            <>
              <KpiCard
                label="Services analysés"
                value={rows.length}
                sub={periodLabel}
                icon={Layers}
                tone="default"
              />
              <KpiCard
                label="Service dominant"
                value={<span className="text-base">{topRow?.service ?? "—"}</span>}
                sub={topRow ? `${topRow.pct.toFixed(1)}% du coût total` : undefined}
                icon={Crown}
                tone="green"
              />
              <KpiCard
                label="Loi de Pareto"
                value={`${top5Pct.toFixed(0)}%`}
                sub={`Concentrés sur les ${Math.min(5, rows.length)} premiers services`}
                icon={PieChart}
                tone="success"
              />
            </>
          )}
        </section>
      )}

      {/* Pareto chart */}
      {!hasError && (
        <SectionCard
          title="Analyse Pareto 80/20"
          description={`Coût par service (barres) · pourcentage cumulé (ligne) · seuil 80% (référence)${effectiveSource === "portefeuille" ? ` · devise ${currency}` : ""}`}
        >
          {(isLoading || rows.length === 0) ? (
            <Skeleton className="h-[300px]" />
          ) : (
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={rows} margin={{ left: -18, right: 32, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0 0 0 / 0.06)" />
                <XAxis
                  dataKey="service"
                  tick={{ fontSize: 10, fill: COLOR_MUTED }}
                  tickLine={false}
                  axisLine={false}
                  angle={-35}
                  textAnchor="end"
                  height={110}
                  interval={0}
                  tickMargin={8}
                  tickFormatter={(v: string) => truncateLabel(v, 20)}
                />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: COLOR_MUTED }} tickLine={false} axisLine={false} unit=" €" width={56} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: COLOR_MUTED }} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} width={38} />
                <Tooltip
                  cursor={{ fill: "oklch(0 0 0 / 0.03)" }}
                  contentStyle={{
                    borderRadius: 10,
                    border: "1px solid oklch(0.90 0.010 250)",
                    fontSize: 12,
                  }}
                  formatter={(v: unknown, name: string) => {
                    const x = v as number
                    return name === "cumPct"
                      ? [`${x.toFixed(1)}%`, "% cumulé"]
                      : [`${x.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`, "Coût"]
                  }}
                />
                <ReferenceLine
                  yAxisId="right"
                  y={80}
                  stroke={COLOR_GREEN}
                  strokeDasharray="4 2"
                  label={{ value: "80%", position: "right", fontSize: 10, fill: COLOR_GREEN }}
                />
                <Bar yAxisId="left" dataKey="cost" radius={[6, 6, 0, 0]} name="Coût">
                  {rows.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="cumPct"
                  stroke={COLOR_GREEN}
                  strokeWidth={2.5}
                  dot={{ r: 3.5, fill: COLOR_GREEN, stroke: "white", strokeWidth: 2 }}
                  name="% cumulé"
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      )}

      {/* Desktop table */}
      {!hasError && (
        <SectionCard
          title="Détail par service"
          description={
            effectiveSource === "portefeuille"
              ? "Coût, part et part cumulée · volatilité indisponible sur agrégat mensuel"
              : "Coût, part, part cumulée, volatilité et profil de risque"
          }
          className="hidden sm:block"
        >
          {(isLoading || rows.length === 0) ? (
            <Skeleton className="h-[200px]" />
          ) : (
            <div className="space-y-3">
              <CategoryLegend rows={rows} />
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm min-w-[620px]">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-xs">
                      <th className="pb-2.5 text-left font-medium pl-1">Service</th>
                      <th className="pb-2.5 text-left font-medium">Catégorie</th>
                      <th className="pb-2.5 text-right font-medium">Coût total</th>
                      <th className="pb-2.5 text-right font-medium">Part</th>
                      <th className="pb-2.5 text-right font-medium">Cumul</th>
                      <th className="pb-2.5 text-right font-medium">CV</th>
                      <th className="pb-2.5 text-center font-medium pr-1">Profil</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((s, i) => (
                      <tr key={s.service} className="hover:bg-muted/40 transition-colors">
                        <td className="py-2.5 pr-3 pl-1">
                          <div className="flex items-center gap-2.5">
                            <span
                              aria-hidden
                              className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                            />
                            <span className="text-sm">{s.service}</span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-3">
                          <CategoryBadge category={s.category} />
                        </td>
                        <td className="py-2.5 text-right tabular-nums font-semibold">
                          {s.cost.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €
                        </td>
                        <td className="py-2.5 text-right tabular-nums">{s.pct.toFixed(1)}%</td>
                        <td className="py-2.5 text-right tabular-nums text-muted-foreground">{s.cumPct.toFixed(1)}%</td>
                        <td className="py-2.5 text-right tabular-nums">
                          {s.cv == null ? <span className="text-muted-foreground">—</span> : `${s.cv.toFixed(1)}%`}
                        </td>
                        <td className="py-2.5 text-center pr-1"><CVBadge cv={s.cv} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {/* Mobile cards */}
      {!hasError && (
        <div className="sm:hidden space-y-3">
          {(isLoading || rows.length === 0) ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
          ) : (
            <>
              <CategoryLegend rows={rows} />
              {rows.map((s, i) => (
              <SectionCard key={s.service} accent="none">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 rounded-full shrink-0 mt-1"
                      style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                    <span className="text-sm font-medium truncate">{s.service}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CategoryBadge category={s.category} />
                    <CVBadge cv={s.cv} />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Coût</p>
                    <p className="font-bold tabular-nums">
                      {s.cost.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Part</p>
                    <p className="font-semibold tabular-nums">{s.pct.toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">CV</p>
                    <p className="font-semibold tabular-nums">
                      {s.cv == null ? "—" : `${s.cv.toFixed(1)}%`}
                    </p>
                  </div>
                </div>
              </SectionCard>
            ))}
            </>
          )}
        </div>
      )}
    </>
  )
}

