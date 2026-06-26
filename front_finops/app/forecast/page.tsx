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
  return <div className={`animate-pulse rounded-lg bg-muted ${className}`} />
}

export default function ForecastPage() {
  const { data: points, isLoading: forecastLoading } = useForecast(60, "AutoETS")
  const { data: summary, isLoading: summaryLoading } = useForecastSummary(60, "AutoETS")
  const { data: benchmarks, isLoading: benchLoading } = useModelBenchmarks()

  // Last actual date = boundary between historical and future
  const lastActualDate = points?.filter((p) => p.actual != null).at(-1)?.date ?? ""

  return (
    <PageShell
      title="Prévision"
      description={
        summary
          ? `Modèle ${summary.bestModel} — horizon ${summary.horizonDays} jours`
          : "Chargement de la prévision…"
      }
    >
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {summaryLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <Card>
              <CardHeader><CardDescription>Prévision 30 jours</CardDescription></CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">
                  {points
                    ? points.filter((p) => p.actual == null).slice(0, 30).reduce((s, p) => s + p.forecast, 0).toFixed(0)
                    : "—"} €
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  ~{summary!.dailyAvgForecast.toFixed(2)} €/j en moyenne
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardDescription>Meilleur modèle</CardDescription></CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{summary!.bestModel}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  MAE {summary!.bestModelMae.toFixed(2)} € — MAPE {summary!.bestModelMape.toFixed(1)}%
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardDescription>Modèles évalués</CardDescription></CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{summary!.modelsEvaluated}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Walk-forward CV 5 folds</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Forecast chart */}
      <Card>
        <CardHeader>
          <CardTitle>Forecast AutoETS</CardTitle>
          <CardDescription>Valeurs réelles (gris) + prévision (bleu) + IC 80% / 95%</CardDescription>
        </CardHeader>
        <CardContent>
          {forecastLoading ? (
            <Skeleton className="h-[360px]" />
          ) : (
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={points} margin={{ left: -8, right: 8 }}>
                <defs>
                  <linearGradient id="ic95" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.12} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0.04} />
                  </linearGradient>
                  <linearGradient id="ic80" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0.06} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} tick={{ fontSize: 11 }} tickLine={false} interval={7} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} unit=" €" />
                <Tooltip
                  formatter={(v: number | undefined, name: string) =>
                    v !== undefined ? [`${v.toFixed(2)} €`, name] : ["-", name]
                  }
                  labelFormatter={(l) => `Date : ${l}`}
                />
                {lastActualDate && (
                  <ReferenceLine
                    x={lastActualDate}
                    stroke="#64748b"
                    strokeDasharray="4 2"
                    label={{ value: "Aujourd'hui", position: "insideTopLeft", fontSize: 11, fill: "#64748b" }}
                  />
                )}
                <Area type="monotone" dataKey="high95" stroke="none" fill="url(#ic95)" name="IC 95%" isAnimationActive={false} />
                <Area type="monotone" dataKey="low95" stroke="none" fill="white" isAnimationActive={false} />
                <Area type="monotone" dataKey="high80" stroke="none" fill="url(#ic80)" name="IC 80%" isAnimationActive={false} />
                <Area type="monotone" dataKey="low80" stroke="none" fill="white" isAnimationActive={false} />
                <Line type="monotone" dataKey="actual" stroke="#94a3b8" strokeWidth={1.5} dot={false} name="Réel" connectNulls={false} />
                <Line type="monotone" dataKey="forecast" stroke="#2563eb" strokeWidth={2} dot={false} name="Prévision" strokeDasharray="4 2" />
                <Legend />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Benchmark table */}
      <Card>
        <CardHeader>
          <CardTitle>Benchmark des modèles</CardTitle>
          <CardDescription>Walk-forward cross-validation — 5 folds × 14 jours</CardDescription>
        </CardHeader>
        <CardContent>
          {benchLoading ? (
            <Skeleton className="h-[200px]" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs">
                      <th className="pb-2 text-left font-medium">Rang</th>
                      <th className="pb-2 text-left font-medium">Modèle</th>
                      <th className="pb-2 text-left font-medium">Famille</th>
                      <th className="pb-2 text-right font-medium">MAE</th>
                      <th className="pb-2 text-right font-medium">RMSE</th>
                      <th className="pb-2 text-right font-medium">MAPE</th>
                      <th className="pb-2 text-right font-medium">R²</th>
                      <th className="pb-2 text-right font-medium">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {benchmarks!.map((m) => (
                      <tr key={m.model} className={m.winner ? "bg-primary/5 font-medium" : ""}>
                        <td className="py-2.5 pr-3">{MEDAL[m.rank] ?? m.rank}</td>
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-1.5">
                            {m.winner && <Trophy className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                            {m.model}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-muted-foreground text-xs">{m.family}</td>
                        <td className="py-2.5 text-right tabular-nums">{m.mae.toFixed(2)} €</td>
                        <td className="py-2.5 text-right tabular-nums">{m.rmse.toFixed(2)} €</td>
                        <td className="py-2.5 text-right tabular-nums">{m.mape.toFixed(1)}%</td>
                        <td className={`py-2.5 text-right tabular-nums ${m.r2 < 0 ? "text-destructive" : "text-green-600"}`}>
                          {m.r2.toFixed(4)}
                        </td>
                        <td className="py-2.5 text-right tabular-nums font-medium">{m.score.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Score = mae / best_mae. Plus bas = meilleur.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </PageShell>
  )
}
