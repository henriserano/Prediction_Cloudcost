"use client"

import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts"
import { Trophy, TrendingDown } from "lucide-react"
import PageShell from "@/components/layout/PageShell"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { FORECAST_DATA, MODEL_BENCHMARKS } from "@/lib/mockData"

const TODAY = "2026-06-23"

const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" }

export default function ForecastPage() {
  const forecastNext30Sum = FORECAST_DATA.filter((d) => d.date > TODAY)
    .slice(0, 30)
    .reduce((s, d) => s + d.forecast, 0)

  return (
    <PageShell
      title="Prévision"
      description="Modèle AutoETS — horizon 30 jours avec intervalles de confiance"
    >
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardDescription>Prévision 30 jours</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{forecastNext30Sum.toFixed(0)} €</p>
            <p className="text-xs text-muted-foreground mt-0.5">~{(forecastNext30Sum / 30).toFixed(2)} €/j en moyenne</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Meilleur modèle</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">AutoETS</p>
            <p className="text-xs text-muted-foreground mt-0.5">MAE 5.65 € — MAPE 23.9%</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Modèles évalués</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">6</p>
            <p className="text-xs text-muted-foreground mt-0.5">Statistiques + Deep Learning</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Forecast AutoETS</CardTitle>
          <CardDescription>
            Valeurs réelles (gris) + prévision (bleu) + IC 80% / 95%
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={360}>
            <ComposedChart data={FORECAST_DATA} margin={{ left: -8, right: 8 }}>
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
              <XAxis
                dataKey="date"
                tickFormatter={(v) => v.slice(5)}
                tick={{ fontSize: 11 }}
                tickLine={false}
                interval={7}
              />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} unit=" €" />
              <Tooltip
                formatter={(v: number | undefined, name: string) =>
                  v !== undefined ? [`${v.toFixed(2)} €`, name] : ["-", name]
                }
                labelFormatter={(l) => `Date : ${l}`}
              />
              <ReferenceLine
                x={TODAY}
                stroke="#64748b"
                strokeDasharray="4 2"
                label={{ value: "Aujourd'hui", position: "insideTopLeft", fontSize: 11, fill: "#64748b" }}
              />
              <Area
                type="monotone"
                dataKey="high95"
                stroke="none"
                fill="url(#ic95)"
                name="IC 95%"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="low95"
                stroke="none"
                fill="white"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="high80"
                stroke="none"
                fill="url(#ic80)"
                name="IC 80%"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="low80"
                stroke="none"
                fill="white"
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="actual"
                stroke="#94a3b8"
                strokeWidth={1.5}
                dot={false}
                name="Réel"
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="forecast"
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
                name="Prévision"
                strokeDasharray="4 2"
              />
              <Legend />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Benchmark des modèles</CardTitle>
          <CardDescription>
            Entraînement : 140 jours — Test : 30 jours (25 mai – 23 juin 2026)
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                {MODEL_BENCHMARKS.map((m) => (
                  <tr
                    key={m.model}
                    className={m.winner ? "bg-primary/5 font-medium" : ""}
                  >
                    <td className="py-2.5 pr-3">
                      {MEDAL[m.rank] ?? m.rank}
                    </td>
                    <td className="py-2.5 pr-3 flex items-center gap-1.5">
                      {m.winner && <Trophy className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                      {m.model}
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
            Score = rang moyen sur MAE, RMSE, MAPE, R². Plus bas = meilleur.
          </p>
        </CardContent>
      </Card>
    </PageShell>
  )
}
