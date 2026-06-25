"use client"

import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from "recharts"
import PageShell from "@/components/layout/PageShell"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { STL_DATA, ANOMALY_DATA, DESCRIPTIVE_STATS } from "@/lib/mockData"

const SIGMA_2 = 2 * 9.83
const MEAN = 19.57

const stlSample = STL_DATA.filter((_, i) => i % 2 === 0)
const anomalySample = ANOMALY_DATA.filter((_, i) => i % 1 === 0)

function StatRow({ label, value, unit = "" }: { label: string; value: number; unit?: string }) {
  return (
    <div className="flex justify-between py-1.5 text-sm border-b last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums font-medium">
        {value.toFixed(2)}{unit}
      </span>
    </div>
  )
}

export default function AnalyticsPage() {
  return (
    <PageShell
      title="Analytique"
      description="Décomposition STL · Statistiques descriptives · Détection d'anomalies"
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Statistiques descriptives</CardTitle>
            <CardDescription>Distribution des coûts quotidiens (€)</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <StatRow label="Moyenne" value={DESCRIPTIVE_STATS.mean} unit=" €" />
            <StatRow label="Médiane" value={DESCRIPTIVE_STATS.median} unit=" €" />
            <StatRow label="Écart-type" value={DESCRIPTIVE_STATS.std} unit=" €" />
            <StatRow label="Coef. de variation" value={DESCRIPTIVE_STATS.cv} unit="%" />
            <StatRow label="Asymétrie (skew)" value={DESCRIPTIVE_STATS.skewness} />
            <StatRow label="Aplatissement (kurt)" value={DESCRIPTIVE_STATS.kurtosis} />
            <StatRow label="IQR" value={DESCRIPTIVE_STATS.iqr} unit=" €" />
            <StatRow label="MAD" value={DESCRIPTIVE_STATS.mad} unit=" €" />
            <StatRow label="Min" value={DESCRIPTIVE_STATS.min} unit=" €" />
            <StatRow label="Max" value={DESCRIPTIVE_STATS.max} unit=" €" />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Décomposition STL</CardTitle>
            <CardDescription>
              Tendance · Saisonnalité (période 7j) · Résidus — Ft=0.47, Fs=0.34
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Tendance</p>
              <ResponsiveContainer width="100%" height={90}>
                <LineChart data={stlSample} margin={{ left: -8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} tick={{ fontSize: 10 }} tickLine={false} interval={14} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} unit=" €" />
                  <Tooltip formatter={(v: number) => [`${v.toFixed(2)} €`, "Tendance"]} labelFormatter={(l) => `Date : ${l}`} />
                  <Line type="monotone" dataKey="trend" stroke="#2563eb" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Saisonnalité (cycle hebdomadaire)</p>
              <ResponsiveContainer width="100%" height={90}>
                <AreaChart data={stlSample} margin={{ left: -8, right: 8 }}>
                  <defs>
                    <linearGradient id="seasGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#16a34a" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} tick={{ fontSize: 10 }} tickLine={false} interval={14} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} unit=" €" />
                  <Tooltip formatter={(v: number) => [`${v.toFixed(2)} €`, "Saisonnier"]} labelFormatter={(l) => `Date : ${l}`} />
                  <ReferenceLine y={0} stroke="#64748b" strokeDasharray="2 2" />
                  <Area type="monotone" dataKey="seasonal" stroke="#16a34a" strokeWidth={1.5} fill="url(#seasGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Résidus</p>
              <ResponsiveContainer width="100%" height={80}>
                <AreaChart data={stlSample} margin={{ left: -8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} tick={{ fontSize: 10 }} tickLine={false} interval={14} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} unit=" €" />
                  <Tooltip formatter={(v: number) => [`${v.toFixed(2)} €`, "Résidu"]} labelFormatter={(l) => `Date : ${l}`} />
                  <ReferenceLine y={0} stroke="#64748b" strokeDasharray="2 2" />
                  <Area type="monotone" dataKey="residual" stroke="#ea580c" strokeWidth={1} fill="#ea580c" fillOpacity={0.1} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Détection d&apos;anomalies — bandes ±2σ</CardTitle>
          <CardDescription>
            Points rouges = Z-score &gt; 2 (au-delà de {(MEAN + SIGMA_2).toFixed(1)} €).
            Bandes grises = ±2σ autour de la moyenne.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={anomalySample} margin={{ left: -8, right: 8 }}>
              <defs>
                <linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#64748b" stopOpacity={0.08} />
                  <stop offset="95%" stopColor="#64748b" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="date"
                tickFormatter={(v) => v.slice(5)}
                tick={{ fontSize: 11 }}
                tickLine={false}
                interval={14}
              />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} unit=" €" />
              <Tooltip
                formatter={(v: number, name: string) => [
                  `${v.toFixed(2)} €`,
                  name === "cost" ? "Coût" : name,
                ]}
                labelFormatter={(l) => `Date : ${l}`}
              />
              <ReferenceLine y={MEAN + SIGMA_2} stroke="#dc2626" strokeDasharray="4 2" label={{ value: "+2σ", position: "right", fontSize: 10, fill: "#dc2626" }} />
              <ReferenceLine y={MEAN} stroke="#64748b" strokeDasharray="2 2" label={{ value: "μ", position: "right", fontSize: 10, fill: "#64748b" }} />
              <ReferenceLine y={Math.max(0, MEAN - SIGMA_2)} stroke="#dc2626" strokeDasharray="4 2" label={{ value: "-2σ", position: "right", fontSize: 10, fill: "#dc2626" }} />
              <Area
                type="monotone"
                dataKey="cost"
                stroke="#94a3b8"
                strokeWidth={1}
                fill="url(#bandGrad)"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                dot={(props: any) => {
                  const { cx, cy, payload } = props
                  if (!payload.isAnomaly) return <g key={payload.date} />
                  return (
                    <circle
                      key={payload.date}
                      cx={cx}
                      cy={cy}
                      r={5}
                      fill="#dc2626"
                      stroke="#fff"
                      strokeWidth={1.5}
                    />
                  )
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tests de stationnarité</CardTitle>
            <CardDescription>ADF + KPSS — résultats du notebook</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm">ADF (Augmented Dickey-Fuller)</span>
                <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-medium">Stationnaire ✓</span>
              </div>
              <p className="text-xs text-muted-foreground">p-value = 0.0162 &lt; 0.05 — on rejette H₀ (racine unitaire)</p>
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm">KPSS</span>
                <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-medium">Non-stationnaire ⚠</span>
              </div>
              <p className="text-xs text-muted-foreground">p-value = 0.01 — on rejette H₀ (stationnarité)</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              <strong className="text-foreground">Verdict :</strong> Résultats contradictoires → série probablement
              <strong className="text-foreground"> trend-stationnaire</strong>. Un différenciation ou détrending peut améliorer les modèles ARIMA.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Résumé STL</CardTitle>
            <CardDescription>Forçage de tendance et saisonnalité</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm">Force de tendance (Ft)</span>
                <span className="tabular-nums font-semibold">0.47</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-blue-500" style={{ width: "47%" }} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Tendance modérée — ~47% de la variance expliquée</p>
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm">Force saisonnière (Fs)</span>
                <span className="tabular-nums font-semibold">0.34</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-green-500" style={{ width: "34%" }} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Cycle hebdomadaire (7j) faible à modéré</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              <strong className="text-foreground">ACF/PACF :</strong> Lags significatifs à 1, 7 et 14 — confirme
              la saisonnalité hebdomadaire et bi-mensuelle.
            </div>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  )
}
