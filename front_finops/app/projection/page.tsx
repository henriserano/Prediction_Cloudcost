"use client"

import { useState } from "react"
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts"
import { Trophy, Clock, Target, TrendingUp, Award, Medal } from "lucide-react"
import PageShell from "@/components/layout/PageShell"
import { SectionCard } from "@/components/ui/section-card"
import { KpiCard } from "@/components/ui/kpi-card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { QueryError } from "@/components/ui/query-error"
import { useForecast, useForecastSummary, useModelBenchmarks } from "@/lib/hooks/useApi"
import type { ModelBenchmark } from "@/lib/types"
import { cn, formatCurrency } from "@/lib/utils"

const HORIZONS: { label: string; value: number }[] = [
  { label: "30 j", value: 30 },
  { label: "60 j", value: 60 },
  { label: "90 j", value: 90 },
  { label: "180 j", value: 180 },
]

/**
 * Rank indicator — Lucide `Medal` icon tinted gold/silver/bronze for the
 * podium, plain "#N" for the rest. Replaces the old emoji medals that
 * rendered inconsistently across systems.
 */
function RankBadge({ rank, className }: { rank: number; className?: string }) {
  const tone =
    rank === 1 ? "text-amber-500"
    : rank === 2 ? "text-slate-400"
    : rank === 3 ? "text-amber-700"
    : null
  if (tone) {
    return (
      <Medal
        className={cn("h-4 w-4 shrink-0", tone, className)}
        aria-label={`Rang ${rank}`}
      />
    )
  }
  return (
    <span
      className={cn(
        "inline-block min-w-[18px] text-center text-[11px] font-semibold tabular-nums text-muted-foreground",
        className,
      )}
      aria-label={`Rang ${rank}`}
    >
      #{rank}
    </span>
  )
}

const COLOR_GREEN = "oklch(0.68 0.15 160)"
const COLOR_MUTED = "oklch(0.65 0.02 250)"

// Metrics can be null when a fold failed backend-side. Never call .toFixed directly.
const num = (n: number | null | undefined, d = 2) =>
  n == null || Number.isNaN(n) ? "—" : n.toFixed(d)

// ─────────────────────────────────────────────────────────────────────────────
// Horizon segmented control
// ─────────────────────────────────────────────────────────────────────────────

function HorizonPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
      <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 gap-0.5">
        {HORIZONS.map((h) => (
          <button
            key={h.value}
            onClick={() => onChange(h.value)}
            aria-pressed={value === h.value}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-semibold tabular-nums transition-all duration-150",
              value === h.value
                ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {h.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Model picker
// ─────────────────────────────────────────────────────────────────────────────

function ModelPicker({
  benchmarks, selected, onChange, loading,
}: {
  benchmarks: ModelBenchmark[] | undefined
  selected: string | null
  onChange: (model: string) => void
  loading: boolean
}) {
  if (loading || !benchmarks) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[70px]" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      {benchmarks.map((m) => {
        const active = m.model === selected
        return (
          <button
            key={m.model}
            onClick={() => onChange(m.model)}
            aria-pressed={active}
            className={cn(
              "group relative flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left",
              "transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-green)]/50",
              active
                ? "border-[color:var(--accent-green)] bg-[color:var(--accent-green)]/6 shadow-sm"
                : "border-border bg-card hover:border-[color:var(--accent-green)]/40 hover:bg-muted/40",
            )}
          >
            <div className="flex items-center gap-1.5 w-full">
              <RankBadge rank={m.rank} />
              <span
                className={cn(
                  "text-xs font-semibold leading-none truncate flex-1",
                  active ? "text-foreground" : "text-foreground/85",
                )}
              >
                {m.model}
              </span>
              {m.winner && (
                <Trophy
                  className="h-3 w-3 text-[color:var(--accent-gold)] shrink-0"
                  aria-label="Meilleur modèle"
                />
              )}
            </div>
            <Badge variant="outline" size="sm" className="normal-case tracking-normal">
              {m.family}
            </Badge>
            <span className="text-[10px] text-muted-foreground tabular-nums font-medium">
              MAE {num(m.mae)} €
            </span>
            {active && (
              <span
                aria-hidden
                className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-[color:var(--accent-green)]"
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function ForecastPage() {
  // `userSelectedModel` is null until the user picks one — the effective model
  // then falls back to the champion returned by the benchmark endpoint, so the
  // page opens on the best model without needing to hardcode a default.
  const [userSelectedModel, setUserSelectedModel] = useState<string | null>(null)
  const [horizon, setHorizon] = useState(60)

  const { data: benchmarks, isLoading: benchLoading, error: benchError, refetch: refetchBench } = useModelBenchmarks()
  const bestModel = benchmarks?.find((m) => m.winner)?.model ?? null
  const selectedModel = userSelectedModel ?? bestModel
  const setSelectedModel = setUserSelectedModel

  const { data: points, isLoading: forecastLoading, error: forecastError, refetch: refetchForecast } = useForecast(horizon, selectedModel)
  const { data: summary, isLoading: summaryLoading, error: summaryError, refetch: refetchSummary } = useForecastSummary(horizon, selectedModel)

  const hasError = !!(benchError || forecastError || summaryError)

  const lastActualDate = points?.filter((p) => p.actual != null).at(-1)?.date ?? ""
  const forecastTotal = points
    ? points.filter((p) => p.actual == null).reduce((s, p) => s + p.forecast, 0)
    : 0

  const activeBench = benchmarks?.find((m) => m.model === selectedModel)

  if (hasError) {
    return (
      <PageShell
        eyebrow="Comprendre · Projection"
        title="Projection des dépenses"
        description="Impossible de charger les prévisions"
      >
        <QueryError
          onRetry={() => {
            if (benchError) void refetchBench()
            if (forecastError) void refetchForecast()
            if (summaryError) void refetchSummary()
          }}
        />
      </PageShell>
    )
  }

  return (
    <PageShell
      eyebrow="Comprendre · Projection"
      title="Projection des dépenses"
      description={
        summary
          ? `Prévision cloud · champion ${summary.bestModel} · horizon ${summary.horizonDays} j · MAE ${num(summary.bestModelMae)} €`
          : "Sélectionnez un modèle et un horizon pour projeter la dépense"
      }
    >
      {/* Controls */}
      <SectionCard
        title="Configuration"
        description="Walk-forward CV · 5 folds × 14 jours · classement par MAE"
        action={<HorizonPicker value={horizon} onChange={setHorizon} />}
      >
        <ModelPicker
          benchmarks={benchmarks}
          selected={selectedModel}
          onChange={setSelectedModel}
          loading={benchLoading}
        />
      </SectionCard>

      {/* KPIs */}
      <section aria-label="Métriques" className="grid grid-cols-1 sm:grid-cols-3 gap-3 lg:gap-4">
        {(summaryLoading || !summary) ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <KpiCard
              label={`Prévision · ${horizon} jours`}
              value={formatCurrency(forecastTotal)}
              sub={`~${formatCurrency(summary.dailyAvgForecast)}/j en moyenne`}
              icon={TrendingUp}
              tone="green"
            />
            <KpiCard
              label="Modèle sélectionné"
              value={selectedModel ?? "…"}
              sub={activeBench ? `${activeBench.family} · rang #${activeBench.rank}` : undefined}
              icon={Award}
              tone="default"
            />
            <KpiCard
              label="Précision"
              value={`${num(summary.bestModelMae)} €`}
              sub={`MAPE ${num(summary.bestModelMape, 1)}% · RMSE ${num(activeBench?.rmse)} €`}
              icon={Target}
              tone={summary.bestModelMape != null && summary.bestModelMape < 15 ? "success" : "destructive"}
            />
          </>
        )}
      </section>

      {/* Forecast chart */}
      <SectionCard
        title={`Prévision · ${selectedModel ?? "…"}`}
        description={`Historique (gris) · Prévision vert (pointillé) · IC 80% & 95% · horizon ${horizon} jours`}
      >
        {(forecastLoading || !points) ? (
          <Skeleton className="h-[320px] lg:h-[380px]" />
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={points} margin={{ left: -18, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="ic95" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLOR_GREEN} stopOpacity={0.22} />
                  <stop offset="95%" stopColor={COLOR_GREEN} stopOpacity={0.03} />
                </linearGradient>
                <linearGradient id="ic80" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLOR_GREEN} stopOpacity={0.38} />
                  <stop offset="95%" stopColor={COLOR_GREEN} stopOpacity={0.10} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0 0 0 / 0.06)" />
              <XAxis
                dataKey="date"
                tickFormatter={(v) => v.slice(5)}
                tick={{ fontSize: 10, fill: COLOR_MUTED }}
                tickLine={false}
                axisLine={false}
                interval={Math.ceil(horizon / 8)}
              />
              <YAxis tick={{ fontSize: 10, fill: COLOR_MUTED }} tickLine={false} axisLine={false} unit=" €" width={56} />
              <Tooltip
                cursor={{ stroke: COLOR_GREEN, strokeWidth: 1, strokeDasharray: "3 3" }}
                contentStyle={{
                  borderRadius: 10,
                  border: "1px solid oklch(0.90 0.010 250)",
                  fontSize: 12,
                }}
                formatter={(v: unknown, name: string) => {
                  const n = typeof v === "number" ? v : undefined
                  return n !== undefined ? [`${n.toFixed(2)} €`, name] : ["-", name]
                }}
                labelFormatter={(l) => `Date · ${l}`}
              />
              {lastActualDate && (
                <ReferenceLine
                  x={lastActualDate}
                  stroke={COLOR_MUTED}
                  strokeDasharray="4 2"
                  label={{ value: "Aujourd'hui", position: "insideTopLeft", fontSize: 10, fill: COLOR_MUTED }}
                />
              )}
              <Area type="monotone" dataKey="high95" stroke="none" fill="url(#ic95)" name="IC 95%" isAnimationActive={false} />
              <Area type="monotone" dataKey="low95" stroke="none" fill="white" isAnimationActive={false} />
              <Area type="monotone" dataKey="high80" stroke="none" fill="url(#ic80)" name="IC 80%" isAnimationActive={false} />
              <Area type="monotone" dataKey="low80" stroke="none" fill="white" isAnimationActive={false} />
              <Line type="monotone" dataKey="actual" stroke={COLOR_MUTED} strokeWidth={1.5} dot={false} name="Réel" connectNulls={false} />
              <Line type="monotone" dataKey="forecast" stroke={COLOR_GREEN} strokeWidth={2.5} dot={false} name="Prévision" strokeDasharray="5 3" />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </SectionCard>

      {/* Benchmark table */}
      <SectionCard
        title="Benchmark des modèles"
        description="Cliquez une ligne pour charger le modèle correspondant"
      >
        {(benchLoading || !benchmarks) ? (
          <Skeleton className="h-[200px]" />
        ) : (
          <>
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs min-w-[520px]">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="pb-2.5 text-left font-medium pl-1">Rg</th>
                    <th className="pb-2.5 text-left font-medium">Modèle</th>
                    <th className="pb-2.5 text-left font-medium hidden sm:table-cell">Famille</th>
                    <th className="pb-2.5 text-right font-medium">MAE</th>
                    <th className="pb-2.5 text-right font-medium hidden sm:table-cell">RMSE</th>
                    <th className="pb-2.5 text-right font-medium">MAPE</th>
                    <th className="pb-2.5 text-right font-medium hidden sm:table-cell">R²</th>
                    <th className="pb-2.5 text-right font-medium pr-1">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {benchmarks.map((m) => {
                    const isSelected = m.model === selectedModel
                    return (
                      <tr
                        key={m.model}
                        onClick={() => setSelectedModel(m.model)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            setSelectedModel(m.model)
                          }
                        }}
                        className={cn(
                          "cursor-pointer transition-colors duration-100 outline-none",
                          isSelected
                            ? "bg-[color:var(--accent-green)]/6 font-semibold"
                            : m.winner
                            ? "bg-[color:var(--accent-gold)]/6 hover:bg-muted/60"
                            : "hover:bg-muted/40",
                        )}
                      >
                        <td className="py-2.5 pr-2 pl-1"><RankBadge rank={m.rank} /></td>
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-1.5">
                            {m.winner && (
                              <Trophy className="h-3 w-3 text-[color:var(--accent-gold)] shrink-0" aria-label="Champion" />
                            )}
                            <span className="truncate max-w-[110px]">{m.model}</span>
                            {isSelected && (
                              <Badge variant="green" size="sm" className="uppercase">Actif</Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 hidden sm:table-cell">
                          <Badge variant="outline" size="sm" className="normal-case tracking-normal">{m.family}</Badge>
                        </td>
                        <td className="py-2.5 text-right tabular-nums">{num(m.mae)} €</td>
                        <td className="py-2.5 text-right tabular-nums hidden sm:table-cell">{num(m.rmse)} €</td>
                        <td className="py-2.5 text-right tabular-nums">{num(m.mape, 1)}%</td>
                        <td
                          className={cn(
                            "py-2.5 text-right tabular-nums hidden sm:table-cell",
                            m.r2 != null && m.r2 < 0 ? "text-destructive" : "text-[color:var(--success)]"
                          )}
                        >
                          {num(m.r2, 4)}
                        </td>
                        <td className="py-2.5 text-right tabular-nums font-bold pr-1">{num(m.score)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Score = MAE / meilleur MAE. Plus bas = meilleur.
            </p>
          </>
        )}
      </SectionCard>
    </PageShell>
  )
}
