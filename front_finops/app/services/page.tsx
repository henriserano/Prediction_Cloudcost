"use client"

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts"
import PageShell from "@/components/layout/PageShell"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { SERVICE_SHARES, KPI_DATA } from "@/lib/mockData"

const SERVICE_COLORS = [
  "#2563eb", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#d97706", "#dc2626", "#64748b",
]

function CVBadge({ cv }: { cv: number }) {
  const label = cv < 20 ? "Stable" : cv < 60 ? "Modéré" : "Volatile"
  const cls =
    cv < 20
      ? "bg-green-100 text-green-700"
      : cv < 60
      ? "bg-amber-100 text-amber-700"
      : "bg-red-100 text-red-700"
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}

export default function ServicesPage() {
  return (
    <PageShell
      title="Services"
      description="Analyse Pareto 80/20 — répartition et volatilité par service GCP"
    >
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardDescription>Nb de services analysés</CardDescription></CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{SERVICE_SHARES.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">sur la période complète</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardDescription>Service dominant</CardDescription></CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{KPI_DATA.topService}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{KPI_DATA.topServicePct}% du total</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardDescription>Top 5 = part totale</CardDescription></CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">87%</p>
            <p className="text-xs text-muted-foreground mt-0.5">Loi de Pareto confirmée</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Analyse Pareto 80/20</CardTitle>
          <CardDescription>
            Coût total par service (barres) — % cumulé (ligne). Ligne rouge = seuil 80%.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={SERVICE_SHARES} margin={{ left: -8, right: 32 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="service"
                tick={{ fontSize: 10 }}
                tickLine={false}
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11 }}
                tickLine={false}
                unit=" €"
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11 }}
                tickLine={false}
                unit="%"
                domain={[0, 100]}
              />
              <Tooltip
                formatter={(v: number, name: string) =>
                  name === "cumPct"
                    ? [`${v.toFixed(1)}%`, "% cumulé"]
                    : [`${v.toFixed(0)} €`, "Coût"]
                }
              />
              <ReferenceLine
                yAxisId="right"
                y={80}
                stroke="#dc2626"
                strokeDasharray="4 2"
                label={{ value: "80%", position: "right", fontSize: 11, fill: "#dc2626" }}
              />
              <Bar yAxisId="left" dataKey="cost" name="Coût">
                {SERVICE_SHARES.map((_, i) => (
                  <Cell key={i} fill={SERVICE_COLORS[i % SERVICE_COLORS.length]} />
                ))}
              </Bar>
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="cumPct"
                stroke="#64748b"
                strokeWidth={2}
                dot={{ r: 3, fill: "#64748b" }}
                name="% cumulé"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Détail par service</CardTitle>
          <CardDescription>
            Coût, part, volatilité (CV) et profil de risque
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="pb-2 text-left font-medium">Service</th>
                  <th className="pb-2 text-right font-medium">Coût total</th>
                  <th className="pb-2 text-right font-medium">Part</th>
                  <th className="pb-2 text-right font-medium">% Cumulé</th>
                  <th className="pb-2 text-right font-medium">CV</th>
                  <th className="pb-2 text-center font-medium">Profil</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {SERVICE_SHARES.map((s, i) => (
                  <tr key={s.service}>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: SERVICE_COLORS[i] }}
                        />
                        {s.service}
                      </div>
                    </td>
                    <td className="py-2.5 text-right tabular-nums font-medium">
                      {s.cost.toLocaleString("fr-FR", { minimumFractionDigits: 0 })} €
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{s.pct.toFixed(1)}%</td>
                    <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                      {s.cumPct.toFixed(1)}%
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{s.cv.toFixed(1)}%</td>
                    <td className="py-2.5 text-center">
                      <CVBadge cv={s.cv} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  )
}
