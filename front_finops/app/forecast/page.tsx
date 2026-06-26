"use client"

import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts"
import { Trophy } from "lucide-react"
import PageShell from "@/components/layout/PageShell"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useForecast, useForecastSummary, useModelBenchmarks } from "@/lib/hooks/useApi"

const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" }

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-muted ${className}`} />
}

function SummaryCard({ label, children, sub }: { label: string; children: React.ReactNode; sub?: string }) {
  return (
    <Card className="relative overflow-hidden">
      <div className="absolute top-0 left-0 h-0.5 w-full bg-gradient-to-r from-[oklch(0.48_0.24_264)] to-transparent" />
      <CardHeader><CardDescription className="text-xs font-medium uppercase tracking-wider">{label}</CardDescription></CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{children}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  )
}

export default function ForecastPage() {
  const { data: points, isLoading: forecastLoading } = useForecast(60, "AutoETS")
  const { data: summary, isLoading: summaryLoading } = useForecastSummary(60, "AutoETS")
  const { data: benchmarks, isLoading: benchLoading } = useModelBenchmarks()

  const lastActualDate = points?.filter((p) => p.actual != null).at(-1)?.date ?? ""
  const forecast30 = points
    ? points.filter((p) => p.actual == null).slice(0, 30).reduce((s, p) => s + p.forecast, 0).toFixed(0)
    : "—"

  return (
    <PageShell
      title="Prévision"
      description={summary ? `Modèle ${summary.bestModel} · horizon ${summary.horizonDays} jours` : "Chargement…"}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4">
        {(summaryLoading || !summary) ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <SummaryCard label="Prévision 30 jours" sub={`~${summary.dailyAvgForecast.toFixed(2)} €/j en moyenne`}>
              {forecast30} €
            </SummaryCard>
            <SummaryCard label="Meilleur modèle" sub={`MAE ${summary.bestModelMae.toFixed(2)} € · MAPE ${summary.bestModelMape.toFixed(1)}%`}>
              {summary.bestModel}
            </SummaryCard>
            <SummaryCard label="Modèles évalués" sub="Walk-forward CV 5 folds" className="col-span-2 lg:col-span-1">
              {summary.modelsEvaluated}
            </SummaryCard>
          </>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Forecast AutoETS</CardTitle>
          <CardDescription>Historique (gris) · Prévision (bleu) · IC 80% / 95%</CardDescription>
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
                <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} tick={{ fontSize: 10 }} tickLine={false} interval={7} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} unit=" €" width={56} />
                <Tooltip
                  formatter={(v: number | undefined, name: string) =>
                    v !== undefined ? [`${v.toFixed(2)} €`, name] : ["-", name]
                  }
                  labelFormatter={(l) => `Date : ${l}`}
                />
                {lastActualDate && (
                  <ReferenceLine x={lastActualDate} stroke="#64748b" strokeDasharray="4 2"
                    label={{ value: "Aujourd'hui", position: "insideTopLeft", fontSize: 10, fill: "#64748b" }} />
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

      <Card>
        <CardHeader>
          <CardTitle>Benchmark des modèles</CardTitle>
          <CardDescription>Walk-forward cross-validation · 5 folds × 14 jours</CardDescription>
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
                    {benchmarks.map((m) => (
                      <tr key={m.model} className={m.winner ? "bg-primary/5 font-semibold" : ""}>
                        <td className="py-2.5 pr-2 pl-1">{MEDAL[m.rank] ?? m.rank}</td>
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-1.5">
                            {m.winner && <Trophy className="h-3 w-3 text-amber-500 shrink-0" />}
                            <span className="truncate max-w-[100px]">{m.model}</span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-muted-foreground hidden sm:table-cell">{m.family}</td>
                        <td className="py-2.5 text-right tabular-nums">{m.mae.toFixed(2)} €</td>
                        <td className="py-2.5 text-right tabular-nums hidden sm:table-cell">{m.rmse.toFixed(2)} €</td>
                        <td className="py-2.5 text-right tabular-nums">{m.mape.toFixed(1)}%</td>
                        <td className={`py-2.5 text-right tabular-nums hidden sm:table-cell ${m.r2 < 0 ? "text-destructive" : "text-green-600"}`}>{m.r2.toFixed(4)}</td>
                        <td className="py-2.5 text-right tabular-nums font-bold pr-1">{m.score.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-3">Score = MAE / meilleur MAE. Plus bas = meilleur.</p>
            </>
          )}
        </CardContent>
      </Card>
    </PageShell>
  )
}
