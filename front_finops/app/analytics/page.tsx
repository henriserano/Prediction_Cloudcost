"use client"

import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from "recharts"
import PageShell from "@/components/layout/PageShell"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useSTL, useSTLStrengths, useAnomalies, useStats, useStationarity } from "@/lib/hooks/useApi"

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-muted ${className}`} />
}

function StatRow({ label, value, unit = "" }: { label: string; value: number; unit?: string }) {
  return (
    <div className="flex justify-between py-2 text-xs border-b last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums font-semibold">{value.toFixed(2)}{unit}</span>
    </div>
  )
}

function StrengthBar({ label, value, color }: { label: string; value: number; color: string }) {
  const desc = value < 0.3 ? "Faible" : value < 0.6 ? "Modérée" : "Forte"
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="tabular-nums font-bold text-sm">{value.toFixed(2)}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(value * 100, 100)}%`, backgroundColor: color }} />
      </div>
      <p className="text-xs text-muted-foreground mt-1">{desc}</p>
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
  const stlSample = stl?.filter((_, i) => i % 2 === 0) ?? []

  return (
    <PageShell
      title="Analytique"
      description="Décomposition STL · Statistiques descriptives · Tests de stationnarité"
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Statistiques descriptives</CardTitle>
            <CardDescription>Distribution des coûts quotidiens</CardDescription>
          </CardHeader>
          <CardContent className="pt-1">
            {(statsLoading || !stats) ? (
              <Skeleton className="h-[240px]" />
            ) : (
              <>
                <StatRow label="Moyenne"             value={stats.mean}     unit=" €" />
                <StatRow label="Médiane"             value={stats.median}   unit=" €" />
                <StatRow label="Écart-type"          value={stats.std}      unit=" €" />
                <StatRow label="Coef. variation"     value={stats.cv}       unit="%" />
                <StatRow label="Asymétrie"           value={stats.skewness} />
                <StatRow label="Aplatissement"       value={stats.kurtosis} />
                <StatRow label="IQR"                 value={stats.iqr}      unit=" €" />
                <StatRow label="MAD"                 value={stats.mad}      unit=" €" />
                <StatRow label="Min"                 value={stats.min}      unit=" €" />
                <StatRow label="Max"                 value={stats.max}      unit=" €" />
              </>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Décomposition STL</CardTitle>
            <CardDescription>
              Tendance · Saisonnalité (7j) · Résidus
              {strengths && !strengthsLoading && ` — Ft=${strengths.ft.toFixed(2)}, Fs=${strengths.fs.toFixed(2)}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(stlLoading || !stl) ? (
              <Skeleton className="h-[260px]" />
            ) : (
              <>
                {[
                  { key: "trend", label: "Tendance", color: "#1a6cf6" },
                  { key: "seasonal", label: "Saisonnalité (cycle hebdo)", color: "#059669" },
                  { key: "residual", label: "Résidus", color: "#ea580c" },
                ].map(({ key, label, color }) => (
                  <div key={key}>
                    <p className="text-xs text-muted-foreground mb-1 font-medium">{label}</p>
                    <ResponsiveContainer width="100%" height={80}>
                      <AreaChart data={stlSample} margin={{ left: -20, right: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} tick={{ fontSize: 9 }} tickLine={false} interval={14} />
                        <YAxis tick={{ fontSize: 9 }} tickLine={false} unit=" €" width={52} />
                        <Tooltip formatter={(v: number) => [`${v.toFixed(2)} €`, label]} labelFormatter={(l) => `Date : ${l}`} />
                        {key !== "trend" && <ReferenceLine y={0} stroke="#64748b" strokeDasharray="2 2" />}
                        <Area type="monotone" dataKey={key} stroke={color} strokeWidth={1.5} fill={color} fillOpacity={0.1} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Détection d&apos;anomalies — bandes ±2σ</CardTitle>
          <CardDescription>
            {stats && !statsLoading
              ? `Seuil supérieur : ${(mean + sigma2).toFixed(1)} €. Points rouges = Z-score > 2.`
              : "Chargement…"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(anomaliesLoading || statsLoading || !anomalies || !stats) ? (
            <Skeleton className="h-[260px]" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={anomalies} margin={{ left: -20, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} tick={{ fontSize: 10 }} tickLine={false} interval={14} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} unit=" €" width={56} />
                <Tooltip formatter={(v: number, name: string) => [`${v.toFixed(2)} €`, name === "cost" ? "Coût" : name]} labelFormatter={(l) => `Date : ${l}`} />
                <ReferenceLine y={mean + sigma2} stroke="#dc2626" strokeDasharray="4 2" label={{ value: "+2σ", position: "right", fontSize: 9, fill: "#dc2626" }} />
                <ReferenceLine y={mean} stroke="#64748b" strokeDasharray="2 2" label={{ value: "μ", position: "right", fontSize: 9, fill: "#64748b" }} />
                <ReferenceLine y={Math.max(0, mean - sigma2)} stroke="#dc2626" strokeDasharray="4 2" label={{ value: "-2σ", position: "right", fontSize: 9, fill: "#dc2626" }} />
                <Area
                  type="monotone"
                  dataKey="cost"
                  stroke="#94a3b8"
                  strokeWidth={1.5}
                  fill="#1a6cf6"
                  fillOpacity={0.05}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  dot={(props: any) => {
                    const { cx, cy, payload } = props
                    if (!payload.isAnomaly) return <g key={payload.date} />
                    return <circle key={payload.date} cx={cx} cy={cy} r={5} fill="#dc2626" stroke="#fff" strokeWidth={1.5} />
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tests de stationnarité</CardTitle>
            <CardDescription>ADF + KPSS</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-1">
            {(statLoading || !stationarity) ? (
              <Skeleton className="h-[160px]" />
            ) : (
              <>
                {[
                  { key: "adf" as const, label: "ADF (Augmented Dickey-Fuller)" },
                  { key: "kpss" as const, label: "KPSS" },
                ].map(({ key, label }) => (
                  <div key={key} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">{label}</span>
                      <span className={`text-xs rounded-full px-2 py-0.5 font-semibold ${stationarity[key].isStationary ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {stationarity[key].isStationary ? "Stationnaire ✓" : "Non-stationnaire ✗"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      p={stationarity[key].pValue.toFixed(4)} · stat={stationarity[key].statistic.toFixed(4)} · lags={stationarity[key].lagsUsed}
                    </p>
                  </div>
                ))}
                <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                  <strong className="text-foreground">Verdict : </strong>
                  {stationarity.adf.isStationary && !stationarity.kpss.isStationary
                    ? "Résultats contradictoires → série trend-stationnaire. Détrending recommandé."
                    : stationarity.adf.isStationary && stationarity.kpss.isStationary
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
            <CardDescription>Force de tendance et saisonnalité (Wang et al.)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-1">
            {(strengthsLoading || !strengths) ? (
              <Skeleton className="h-[160px]" />
            ) : (
              <>
                <StrengthBar label={`Force de tendance (Ft)`} value={strengths.ft} color="#1a6cf6" />
                <StrengthBar label={`Force saisonnière (Fs) — période ${strengths.period}j`} value={strengths.fs} color="#059669" />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  )
}
