"use client"

import { useState } from "react"
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts"
import { Trophy, Clock } from "lucide-react"
import PageShell from "@/components/layout/PageShell"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useForecast, useForecastSummary, useModelBenchmarks } from "@/lib/hooks/useApi"
import type { ModelBenchmark } from "@/lib/types"
import { cn } from "@/lib/utils"

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" }

const HORIZONS: { label: string; value: number }[] = [
  { label: "30 j", value: 30 },
  { label: "60 j", value: 60 },
  { label: "90 j", value: 90 },
  { label: "180 j", value: 180 },
]

const FAMILY_COLORS: Record<string, string> = {
  "Exp. Smoothing": "bg-blue-50 text-blue-700 border-blue-200",
  "Theta":          "bg-violet-50 text-violet-700 border-violet-200",
  "ARIMA":          "bg-cyan-50 text-cyan-700 border-cyan-200",
  "Holt-Winters":   "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Seasonal Naive": "bg-orange-50 text-orange-700 border-orange-200",
}

function familyClass(family: string) {
  return FAMILY_COLORS[family] ?? "bg-gray-50 text-gray-600 border-gray-200"
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-muted ${className}`} />
}

function SummaryCard({
  label, children, sub, className = "",
}: {
  label: string; children: React.ReactNode; sub?: string; className?: string
}) {
  return (
    <Card className={`relative overflow-hidden ${className}`}>
      <div className="absolute top-0 left-0 h-0.5 w-full bg-gradient-to-r from-[oklch(0.48_0.24_264)] to-transparent" />
      <CardHeader>
        <CardDescription className="text-xs font-medium uppercase tracking-wider">{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{children}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// HorizonPicker — segmented control
// ─────────────────────────────────────────────────────────────────────────────

function HorizonPicker({
  value, onChange,
}: {
  value: number; onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className="flex rounded-lg border border-border bg-muted/40 p-0.5 gap-0.5">
        {HORIZONS.map((h) => (
          <button
            key={h.value}
            onClick={() => onChange(h.value)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-all duration-150",
              value === h.value
                ? "bg-white text-foreground shadow-sm"
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
// ModelPicker — card pills, data-driven from benchmark results
// ─────────────────────────────────────────────────────────────────────────────

function ModelPicker({
  benchmarks, selected, onChange, loading,
}: {
  benchmarks: ModelBenchmark[] | undefined
  selected: string
  onChange: (model: string) => void
  loading: boolean
}) {
  if (loading || !benchmarks) {
    return (
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-36 rounded-xl" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {benchmarks.map((m) => {
        const active = m.model === selected
        return (
          <button
            key={m.model}
            onClick={() => onChange(m.model)}
            className={cn(
              "group relative flex flex-col items-start gap-1 rounded-xl border px-3.5 py-2.5 text-left",
              "transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              active
                ? "border-[oklch(0.48_0.24_264)] bg-[oklch(0.48_0.24_264)]/8 shadow-sm"
                : "border-border bg-card hover:border-[oklch(0.48_0.24_264)]/40 hover:bg-muted/30"
            )}
          >
            {/* Top row: medal + model name + winner badge */}
            <div className="flex items-center gap-1.5 w-full">
              <span className="text-sm leading-none">{MEDAL[m.rank] ?? `#${m.rank}`}</span>
              <span className={cn(
                "text-xs font-semibold leading-none truncate max-w-[100px]",
                active ? "text-[oklch(0.30_0.20_264)]" : "text-foreground"
              )}>
                {m.model}
              </span>
              {m.winner && (
                <Trophy className="h-3 w-3 text-amber-500 shrink-0 ml-auto" />
              )}
            </div>

            {/* Family tag */}
            <span className={cn(
              "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none",
              familyClass(m.family)
            )}>
              {m.family}
            </span>

            {/* MAE */}
            <span className="text-[10px] text-muted-foreground tabular-nums">
              MAE {m.mae.toFixed(2)} €
            </span>

            {/* Active indicator dot */}
            {active && (
              <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-[oklch(0.48_0.24_264)]" />
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
  const [selectedModel, setSelectedModel] = useState("AutoETS")
  const [horizon, setHorizon] = useState(60)

  const { data: benchmarks, isLoading: benchLoading } = useModelBenchmarks()
  const { data: points, isLoading: forecastLoading } = useForecast(horizon, selectedModel)
  const { data: summary, isLoading: summaryLoading } = useForecastSummary(horizon, selectedModel)

  const lastActualDate = points?.filter((p) => p.actual != null).at(-1)?.date ?? ""
  const forecastTotal = points
    ? points.filter((p) => p.actual == null).reduce((s, p) => s + p.forecast, 0).toFixed(0)
    : "—"

  const activeBench = benchmarks?.find((m) => m.model === selectedModel)

  return (
    <PageShell
      title="Prévision"
      description={
        summary
          ? `${summary.bestModel} · horizon ${summary.horizonDays} j · MAE ${summary.bestModelMae.toFixed(2)} €`
          : "Sélectionnez un modèle et un horizon"
      }
    >
      {/* ── Model + Horizon selector ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-sm">Modèle de prévision</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Classement par MAE · Walk-forward CV 5 folds × 14 jours
              </CardDescription>
            </div>
            <HorizonPicker value={horizon} onChange={setHorizon} />
          </div>
        </CardHeader>
        <CardContent>
          <ModelPicker
            benchmarks={benchmarks}
            selected={selectedModel}
            onChange={setSelectedModel}
            loading={benchLoading}
          />
        </CardContent>
      </Card>

      {/* ── KPI cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4">
        {(summaryLoading || !summary) ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <SummaryCard
              label={`Prévision ${horizon} jours`}
              sub={`~${summary.dailyAvgForecast.toFixed(2)} €/j en moyenne`}
            >
              {forecastTotal} €
            </SummaryCard>
            <SummaryCard
              label="Modèle sélectionné"
              sub={activeBench ? `Score ${activeBench.score.toFixed(2)} · ${activeBench.family}` : undefined}
            >
              {selectedModel}
            </SummaryCard>
            <SummaryCard
              label="Précision"
              sub={`MAPE ${summary.bestModelMape.toFixed(1)}% · RMSE ${activeBench?.rmse.toFixed(2) ?? "—"} €`}
              className="col-span-2 lg:col-span-1"
            >
              MAE {summary.bestModelMae.toFixed(2)} €
            </SummaryCard>
          </>
        )}
      </div>

      {/* ── Forecast chart ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Forecast — {selectedModel}</CardTitle>
          <CardDescription>
            Historique (gris) · Prévision (bleu) · IC 80% / 95% · horizon {horizon} jours
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(forecastLoading || !points) ? (
            <Skeleton className="h-[300px] lg:h-[360px]" />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={points} margin={{ left: -20, right: 8 }}>
                <defs>
                  <linearGradient id="ic95" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1a6cf6" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#1a6cf6" stopOpacity={0.04} />
                  </linearGradient>
                  <linearGradient id="ic80" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1a6cf6" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#1a6cf6" stopOpacity={0.08} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => v.slice(5)}
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  interval={Math.ceil(horizon / 8)}
                />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} unit=" €" width={56} />
                <Tooltip
                  formatter={(v: unknown, name: string) => {
                    const n = typeof v === "number" ? v : undefined
                    return n !== undefined ? [`${n.toFixed(2)} €`, name] : ["-", name]
                  }}
                  labelFormatter={(l) => `Date : ${l}`}
                />
                {lastActualDate && (
                  <ReferenceLine
                    x={lastActualDate}
                    stroke="#64748b"
                    strokeDasharray="4 2"
                    label={{ value: "Aujourd'hui", position: "insideTopLeft", fontSize: 10, fill: "#64748b" }}
                  />
                )}
                <Area type="monotone" dataKey="high95" stroke="none" fill="url(#ic95)" name="IC 95%" isAnimationActive={false} />
                <Area type="monotone" dataKey="low95" stroke="none" fill="white" isAnimationActive={false} />
                <Area type="monotone" dataKey="high80" stroke="none" fill="url(#ic80)" name="IC 80%" isAnimationActive={false} />
                <Area type="monotone" dataKey="low80" stroke="none" fill="white" isAnimationActive={false} />
                <Line type="monotone" dataKey="actual" stroke="#94a3b8" strokeWidth={1.5} dot={false} name="Réel" connectNulls={false} />
                <Line type="monotone" dataKey="forecast" stroke="#1a6cf6" strokeWidth={2} dot={false} name="Prévision" strokeDasharray="5 3" />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── Benchmark table ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Benchmark des modèles</CardTitle>
          <CardDescription>Walk-forward cross-validation · 5 folds × 14 jours — cliquez une ligne pour sélectionner</CardDescription>
        </CardHeader>
        <CardContent>
          {(benchLoading || !benchmarks) ? (
            <Skeleton className="h-[180px]" />
          ) : (
            <>
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-xs min-w-[520px]">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="pb-2 text-left font-medium pl-1">Rg</th>
                      <th className="pb-2 text-left font-medium">Modèle</th>
                      <th className="pb-2 text-left font-medium hidden sm:table-cell">Famille</th>
                      <th className="pb-2 text-right font-medium">MAE</th>
                      <th className="pb-2 text-right font-medium hidden sm:table-cell">RMSE</th>
                      <th className="pb-2 text-right font-medium">MAPE</th>
                      <th className="pb-2 text-right font-medium hidden sm:table-cell">R²</th>
                      <th className="pb-2 text-right font-medium pr-1">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {benchmarks.map((m) => {
                      const isSelected = m.model === selectedModel
                      return (
                        <tr
                          key={m.model}
                          onClick={() => setSelectedModel(m.model)}
                          className={cn(
                            "cursor-pointer transition-colors duration-100",
                            isSelected
                              ? "bg-[oklch(0.48_0.24_264)]/8 font-semibold"
                              : m.winner
                              ? "bg-amber-50/60 hover:bg-muted/60"
                              : "hover:bg-muted/40"
                          )}
                        >
                          <td className="py-2.5 pr-2 pl-1">{MEDAL[m.rank] ?? m.rank}</td>
                          <td className="py-2.5 pr-3">
                            <div className="flex items-center gap-1.5">
                              {m.winner && <Trophy className="h-3 w-3 text-amber-500 shrink-0" />}
                              <span className="truncate max-w-[100px]">{m.model}</span>
                              {isSelected && (
                                <span className="ml-1 inline-flex items-center rounded-full bg-[oklch(0.48_0.24_264)] px-1.5 py-0.5 text-[9px] font-semibold text-white leading-none">
                                  actif
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 pr-3 text-muted-foreground hidden sm:table-cell">
                            <span className={cn(
                              "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none",
                              familyClass(m.family)
                            )}>
                              {m.family}
                            </span>
                          </td>
                          <td className="py-2.5 text-right tabular-nums">{m.mae.toFixed(2)} €</td>
                          <td className="py-2.5 text-right tabular-nums hidden sm:table-cell">{m.rmse.toFixed(2)} €</td>
                          <td className="py-2.5 text-right tabular-nums">{m.mape.toFixed(1)}%</td>
                          <td className={cn(
                            "py-2.5 text-right tabular-nums hidden sm:table-cell",
                            m.r2 < 0 ? "text-destructive" : "text-green-600"
                          )}>
                            {m.r2.toFixed(4)}
                          </td>
                          <td className="py-2.5 text-right tabular-nums font-bold pr-1">{m.score.toFixed(2)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Score = MAE / meilleur MAE. Plus bas = meilleur. Cliquez une ligne pour charger ce modèle.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </PageShell>
  )
}
