"use client"

import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from "recharts"
import PageShell from "@/components/layout/PageShell"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useSTL, useSTLStrengths, useAnomalies, useStats, useStationarity } from "@/lib/hooks/useApi"

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className}`} />
}

function StatRow({ label, value, unit = "" }: { label: string; value: number; unit?: string }) {
  return (
    <div className="flex justify-between py-1.5 text-sm border-b last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums font-medium">{value.toFixed(2)}{unit}</span>
    </div>
  )
}

export default function AnalyticsPage() {
  const { data: stl, isLoading: stlLoading } = useSTL()
  const { data: strengths, isLoading: strengthsLoading } = useSTLStrengths()
  const { data: anomalies, isLoading: anomaliesLoading } = useAnomalies()
  const { data: stats, isLoading: statsLoading } = useStats()
  const { data: stationarity, isLoading: statLoading } = useStationarity()

  const sigma2 = stats ? 2 * stats.std : 0
  const mean = stats?.mean ?? 0

  // Sample every other point to keep charts readable
  const stlSample = stl?.filter((_, i) => i % 2 === 0) ?? []

  return (
    <PageShell
      title="Analytique"
      description="Décomposition STL · Statistiques descriptives · Détection d'anomalies"
    >
      {/* Stats + STL */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Statistiques descriptives</CardTitle>
            <CardDescription>Distribution des coûts quotidiens (€)</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            {(statsLoading || !stats) ? (
              <Skeleton className="h-[260px]" />
            ) : (
              <>
                <StatRow label="Moyenne"               value={stats!.mean}     unit=" €" />
                <StatRow label="Médiane"               value={stats!.median}   unit=" €" />
                <StatRow label="Écart-type"            value={stats!.std}      unit=" €" />
                <StatRow label="Coef. de variation"   value={stats!.cv}       unit="%" />
                <StatRow label="Asymétrie (skew)"     value={stats!.skewness} />
                <StatRow label="Aplatissement (kurt)" value={stats!.kurtosis} />
                <StatRow label="IQR"                   value={stats!.iqr}      unit=" €" />
                <StatRow label="MAD"                   value={stats!.mad}      unit=" €" />
                <StatRow label="Min"                   value={stats!.min}      unit=" €" />
                <StatRow label="Max"                   value={stats!.max}      unit=" €" />
              </>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Décomposition STL</CardTitle>
            <CardDescription>
              Tendance · Saisonnalité (période 7j) · Résidus
              {strengths && !strengthsLoading && ` — Ft=${strengths.ft.toFixed(2)}, Fs=${strengths.fs.toFixed(2)}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(stlLoading || !stl) ? (
              <Skeleton className="h-[260px]" />
            ) : (
              <>
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
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Anomaly chart ±2σ */}
      <Card>
        <CardHeader>
          <CardTitle>Détection d&apos;anomalies — bandes ±2σ</CardTitle>
          <CardDescription>
            {stats && !statsLoading
              ? `Points rouges = Z-score > 2 (au-delà de ${(mean + sigma2).toFixed(1)} €). Bandes grises = ±2σ autour de la moyenne.`
              : "Chargement…"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(anomaliesLoading || statsLoading || !anomalies || !stats) ? (
            <Skeleton className="h-[300px]" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={anomalies} margin={{ left: -8, right: 8 }}>
                <defs>
                  <linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#64748b" stopOpacity={0.08} />
                    <stop offset="95%" stopColor="#64748b" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} tick={{ fontSize: 11 }} tickLine={false} interval={14} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} unit=" €" />
                <Tooltip
                  formatter={(v: number, name: string) => [`${v.toFixed(2)} €`, name === "cost" ? "Coût" : name]}
                  labelFormatter={(l) => `Date : ${l}`}
                />
                <ReferenceLine y={mean + sigma2} stroke="#dc2626" strokeDasharray="4 2" label={{ value: "+2σ", position: "right", fontSize: 10, fill: "#dc2626" }} />
                <ReferenceLine y={mean} stroke="#64748b" strokeDasharray="2 2" label={{ value: "μ", position: "right", fontSize: 10, fill: "#64748b" }} />
                <ReferenceLine y={Math.max(0, mean - sigma2)} stroke="#dc2626" strokeDasharray="4 2" label={{ value: "-2σ", position: "right", fontSize: 10, fill: "#dc2626" }} />
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
                      <circle key={payload.date} cx={cx} cy={cy} r={5} fill="#dc2626" stroke="#fff" strokeWidth={1.5} />
                    )
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Stationarity + STL summary */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tests de stationnarité</CardTitle>
            <CardDescription>ADF + KPSS</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            {(statLoading || !stationarity) ? (
              <Skeleton className="h-[160px]" />
            ) : (
              <>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm">ADF (Augmented Dickey-Fuller)</span>
                    <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${stationarity!.adf.isStationary ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                      {stationarity!.adf.isStationary ? "Stationnaire ✓" : "Non-stationnaire ✗"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    p-value = {stationarity!.adf.pValue.toFixed(4)} — stat = {stationarity!.adf.statistic.toFixed(4)} — lags = {stationarity!.adf.lagsUsed}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm">KPSS</span>
                    <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${stationarity!.kpss.isStationary ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                      {stationarity!.kpss.isStationary ? "Stationnaire ✓" : "Non-stationnaire ⚠"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    p-value = {stationarity!.kpss.pValue.toFixed(4)} — stat = {stationarity!.kpss.statistic.toFixed(4)} — lags = {stationarity!.kpss.lagsUsed}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                  <strong className="text-foreground">Verdict :</strong>{" "}
                  {stationarity!.adf.isStationary && !stationarity!.kpss.isStationary
                    ? "Résultats contradictoires → série probablement trend-stationnaire. Un détrending peut améliorer les modèles ARIMA."
                    : stationarity!.adf.isStationary && stationarity!.kpss.isStationary
                    ? "Série stationnaire selon les deux tests."
                    : "Série non-stationnaire — différenciation recommandée."}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Résumé STL</CardTitle>
            <CardDescription>Force de tendance et saisonnalité</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            {(strengthsLoading || !strengths) ? (
              <Skeleton className="h-[160px]" />
            ) : (
              <>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm">Force de tendance (Ft)</span>
                    <span className="tabular-nums font-semibold">{strengths!.ft.toFixed(2)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-blue-500" style={{ width: `${strengths!.ft * 100}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {strengths!.ft < 0.3 ? "Tendance faible" : strengths!.ft < 0.6 ? "Tendance modérée" : "Tendance forte"}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm">Force saisonnière (Fs)</span>
                    <span className="tabular-nums font-semibold">{strengths!.fs.toFixed(2)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-green-500" style={{ width: `${strengths!.fs * 100}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Cycle hebdomadaire (période {strengths!.period}j) — {strengths!.fs < 0.3 ? "faible" : strengths!.fs < 0.6 ? "modéré" : "fort"}
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  )
}
