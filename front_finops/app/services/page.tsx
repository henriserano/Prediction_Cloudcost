"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts"
import { Layers, Crown, PieChart, Cloud, HardDrive, ArrowUpRight } from "lucide-react"
import PageShell from "@/components/layout/PageShell"
import { SectionCard } from "@/components/ui/section-card"
import { KpiCard } from "@/components/ui/kpi-card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { useServices, useGCPStatus, useGCPBilling } from "@/lib/hooks/useApi"
import { useSelectedGCPProject } from "@/lib/hooks/useSelectedGCPProject"
import { cn } from "@/lib/utils"

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

type Source = "local" | "gcp"

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
// Source picker — visible only when GCP is authenticated and a project is set
// ---------------------------------------------------------------------------

function SourcePicker({
  source,
  onChange,
  gcpAvailable,
  gcpProjectId,
}: {
  source: Source
  onChange: (s: Source) => void
  gcpAvailable: boolean
  gcpProjectId: string
}) {
  return (
    <nav
      aria-label="Source des données"
      className="inline-flex rounded-xl border border-border bg-card p-1 gap-1 shadow-sm"
    >
      <button
        type="button"
        onClick={() => onChange("local")}
        aria-pressed={source === "local"}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all",
          source === "local"
            ? "bg-brand text-brand-foreground shadow-sm"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        <HardDrive
          className={cn("h-3.5 w-3.5", source === "local" ? "text-[color:var(--accent-green)]" : "text-muted-foreground")}
          aria-hidden
        />
        <span>Local</span>
        <span className={cn("text-[10px] font-medium", source === "local" ? "text-white/60" : "text-muted-foreground/60")}>
          Parquet
        </span>
      </button>
      <button
        type="button"
        onClick={() => onChange("gcp")}
        disabled={!gcpAvailable}
        aria-pressed={source === "gcp"}
        title={
          gcpAvailable
            ? undefined
            : "Connectez un projet GCP via Sources de données pour activer cette source"
        }
        className={cn(
          "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed",
          source === "gcp"
            ? "bg-brand text-brand-foreground shadow-sm"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        <Cloud
          className={cn("h-3.5 w-3.5", source === "gcp" ? "text-[color:var(--accent-green)]" : "text-muted-foreground")}
          aria-hidden
        />
        <span>Google Cloud</span>
        <span
          className={cn(
            "text-[10px] font-medium max-w-[120px] truncate",
            source === "gcp" ? "text-white/60" : "text-muted-foreground/60"
          )}
        >
          {gcpProjectId || "aucun projet"}
        </span>
      </button>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ServicesPage() {
  const [gcpProjectId] = useSelectedGCPProject()
  const { data: gcpStatus } = useGCPStatus()

  const gcpAuth = gcpStatus?.authenticated === true
  const gcpAvailable = gcpAuth && !!gcpProjectId

  // Source is derived: GCP if available and user hasn't opted out; otherwise local.
  // We use URL search param via internal state — kept simple via useState.
  // (Persisting could be added via localStorage later.)
  const [source, setSource] = useSourceState(gcpAvailable ? "gcp" : "local")

  // Fall back to local if the GCP source becomes unavailable mid-session.
  const effectiveSource: Source = source === "gcp" && gcpAvailable ? "gcp" : "local"

  // ── LOCAL data ────────────────────────────────────────────────────────────
  const {
    data: localServices,
    isLoading: localLoading,
    error: localError,
  } = useServices()

  // ── GCP data ──────────────────────────────────────────────────────────────
  const {
    data: gcpBilling,
    isLoading: gcpLoading,
    error: gcpError,
  } = useGCPBilling(effectiveSource === "gcp" ? gcpProjectId : undefined, 6)

  // Adapt to a single unified row shape
  const rows: UnifiedRow[] = useMemo(() => {
    if (effectiveSource === "local") {
      return (localServices ?? []).map((s) => ({
        service: s.service,
        cost: s.cost,
        pct: s.pct,
        cumPct: s.cumPct,
        cv: s.cv,
        category: s.category ?? guessCategory(s.service),
      }))
    }
    if (!gcpBilling) return []
    const sorted = [...gcpBilling.byService].sort((a, b) => b.cost - a.cost)
    let acc = 0
    return sorted.map((s) => {
      acc += s.pct
      return {
        service: s.service,
        cost: s.cost,
        pct: s.pct,
        cumPct: acc,
        cv: null,
        category: guessCategory(s.service),
      }
    })
  }, [effectiveSource, localServices, gcpBilling])

  const isLoading = effectiveSource === "local" ? localLoading : gcpLoading
  const hasError = effectiveSource === "local" ? !!localError : !!gcpError

  const currency = effectiveSource === "gcp" ? gcpBilling?.currency ?? "EUR" : "EUR"
  const top5Pct = rows.slice(0, 5).reduce((s, r) => s + r.pct, 0)
  const topRow = rows[0]

  // ── Period label ──────────────────────────────────────────────────────────
  const periodLabel =
    effectiveSource === "gcp" && gcpBilling
      ? `${gcpBilling.period.start} → ${gcpBilling.period.end}`
      : "Période complète"

  const description =
    effectiveSource === "gcp"
      ? `Données Google Cloud · projet ${gcpProjectId} · ${periodLabel}`
      : "Analyse Pareto 80/20 · répartition et volatilité par service"

  return (
    <PageShell
      eyebrow="Cost breakdown"
      title="Services"
      description={description}
      actions={
        <SourcePicker
          source={effectiveSource}
          onChange={setSource}
          gcpAvailable={gcpAvailable}
          gcpProjectId={gcpProjectId}
        />
      }
    >
      {/* Not connected + user tries to see GCP → gentle empty state */}
      {source === "gcp" && !gcpAvailable && (
        <SectionCard accent="green">
          <EmptyState
            icon={Cloud}
            title="Aucun projet Google Cloud sélectionné"
            description={
              gcpAuth
                ? "Choisissez un projet dans GCP Connect pour visualiser sa facturation ici."
                : "Connectez d'abord votre compte Google Cloud via la page Sources de données."
            }
            action={
              <Link href={gcpAuth ? "/gcp-connect" : "/data-sources"}>
                <Button className="gap-2">
                  {gcpAuth ? "Choisir un projet" : "Connecter Google Cloud"}
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
              effectiveSource === "gcp"
                ? "Impossible de charger les données GCP"
                : "Impossible de charger les données locales"
            }
            description="Vérifiez la connexion au backend et réessayez."
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
          description={`Coût par service (barres) · pourcentage cumulé (ligne) · seuil 80% (référence)${effectiveSource === "gcp" ? ` · devise ${currency}` : ""}`}
        >
          {(isLoading || rows.length === 0) ? (
            <Skeleton className="h-[300px]" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={rows} margin={{ left: -18, right: 32, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0 0 0 / 0.06)" />
                <XAxis
                  dataKey="service"
                  tick={{ fontSize: 9, fill: COLOR_MUTED }}
                  tickLine={false}
                  axisLine={false}
                  angle={-20}
                  textAnchor="end"
                  height={60}
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
            effectiveSource === "gcp"
              ? "Coût, part et part cumulée · volatilité indisponible en source GCP mensuelle"
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
    </PageShell>
  )
}

// ---------------------------------------------------------------------------
// useSourceState — auto-picks the default until the user explicitly toggles.
// Derives the current source from an optional user choice, no effect needed.
// ---------------------------------------------------------------------------

function useSourceState(defaultSource: Source): [Source, (s: Source) => void] {
  const [userChoice, setUserChoice] = useState<Source | null>(null)
  const source = userChoice ?? defaultSource
  return [source, setUserChoice]
}
