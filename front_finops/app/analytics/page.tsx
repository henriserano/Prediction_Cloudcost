"use client"

import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from "recharts"
import PageShell from "@/components/layout/PageShell"
import { SectionCard } from "@/components/ui/section-card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { useSTL, useSTLStrengths, useAnomalies, useStats, useStationarity } from "@/lib/hooks/useApi"

const COLOR_BRAND = "oklch(0.22 0.055 258)"
const COLOR_CORAL = "oklch(0.66 0.185 28)"
const COLOR_TEAL  = "oklch(0.60 0.11 195)"
const COLOR_DEST  = "oklch(0.60 0.22 25)"
const COLOR_MUTED = "oklch(0.65 0.02 250)"

function StatRow({ label, value, unit = "" }: { label: string; value: number; unit?: string }) {
  return (
    <div className="flex justify-between py-2 text-xs border-b border-border last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums font-semibold text-foreground">{value.toFixed(2)}{unit}</span>
    </div>
  )
}

function StrengthBar({ label, value, color }: { label: string; value: number; color: string }) {
  const desc = value < 0.3 ? "Faible" : value < 0.6 ? "Modérée" : "Forte"
  return (
    <div className="rounded-lg border border-border p-3.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="tabular-nums font-bold text-sm">{value.toFixed(2)}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${Math.min(value * 100, 100)}%`, backgroundColor: color }}
        />
      </div>
      <p className="text-[11px] text-muted-foreground mt-1.5">{desc}</p>
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
      eyebrow="Statistical analysis"
      title="Analytique"
      description="Décomposition STL · Statistiques descriptives · Détection d'anomalies · Tests de stationnarité"
    >
      {/* Descriptive + STL */}
      <section aria-label="Décomposition" className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard
          title="Statistiques descriptives"
          description="Distribution des coûts quotidiens"
          className="lg:col-span-1"
        >
          {(statsLoading || !stats) ? (
            <Skeleton className="h-[260px]" />
          ) : (
            <div className="pt-1">
              <StatRow label="Moyenne"         value={stats.mean}     unit=" €" />
              <StatRow label="Médiane"         value={stats.median}   unit=" €" />
              <StatRow label="Écart-type"      value={stats.std}      unit=" €" />
              <StatRow label="Coef. variation" value={stats.cv}       unit="%" />
              <StatRow label="Asymétrie"       value={stats.skewness} />
              <StatRow label="Aplatissement"   value={stats.kurtosis} />
              <StatRow label="IQR"             value={stats.iqr}      unit=" €" />
              <StatRow label="MAD"             value={stats.mad}      unit=" €" />
              <StatRow label="Min"             value={stats.min}      unit=" €" />
              <StatRow label="Max"             value={stats.max}      unit=" €" />
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Décomposition STL"
          description={
            <>
              Tendance · Saisonnalité (7 j) · Résidus
              {strengths && !strengthsLoading && (
                <span className="text-muted-foreground">
                  {" — Ft="}
                  <span className="text-foreground font-medium tabular-nums">{strengths.ft.toFixed(2)}</span>
                  {", Fs="}
                  <span className="text-foreground font-medium tabular-nums">{strengths.fs.toFixed(2)}</span>
                </span>
              )}
            </>
          }
          className="lg:col-span-2"
          contentClassName="space-y-3"
        >
          {(stlLoading || !stl) ? (
            <Skeleton className="h-[280px]" />
          ) : (
            <>
              {[
                { key: "trend",    label: "Tendance",                        color: COLOR_BRAND },
                { key: "seasonal", label: "Saisonnalité (cycle hebdo)",      color: COLOR_TEAL },
                { key: "residual", label: "Résidus",                         color: COLOR_CORAL },
              ].map(({ key, label, color }) => (
                <div key={key}>
                  <p className="text-[11px] text-muted-foreground mb-1 font-semibold uppercase tracking-wider">{label}</p>
                  <ResponsiveContainer width="100%" height={82}>
                    <AreaChart data={stlSample} margin={{ left: -18, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="oklch(0 0 0 / 0.06)" />
                      <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} tick={{ fontSize: 9, fill: COLOR_MUTED }} tickLine={false} axisLine={false} interval={14} />
                      <YAxis tick={{ fontSize: 9, fill: COLOR_MUTED }} tickLine={false} axisLine={false} unit=" €" width={52} />
                      <Tooltip
                        contentStyle={{
                          borderRadius: 10,
                          border: "1px solid oklch(0.90 0.010 250)",
                          fontSize: 12,
                        }}
                        formatter={(v: number) => [`${v.toFixed(2)} €`, label]}
                        labelFormatter={(l) => `Date · ${l}`}
                      />
                      {key !== "trend" && (
                        <ReferenceLine y={0} stroke={COLOR_MUTED} strokeDasharray="2 2" />
                      )}
                      <Area type="monotone" dataKey={key} stroke={color} strokeWidth={1.5} fill={color} fillOpacity={0.12} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ))}
            </>
          )}
        </SectionCard>
      </section>

      {/* Anomalies ±2σ */}
      <SectionCard
        title="Détection d'anomalies · bandes ±2σ"
        description={
          stats && !statsLoading
            ? `Seuil supérieur ${(mean + sigma2).toFixed(0)} € · points corail = z-score > 2`
            : "Chargement…"
        }
      >
        {(anomaliesLoading || statsLoading || !anomalies || !stats) ? (
          <Skeleton className="h-[280px]" />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={anomalies} margin={{ left: -18, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0 0 0 / 0.06)" />
              <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} tick={{ fontSize: 10, fill: COLOR_MUTED }} tickLine={false} axisLine={false} interval={14} />
              <YAxis tick={{ fontSize: 10, fill: COLOR_MUTED }} tickLine={false} axisLine={false} unit=" €" width={56} />
              <Tooltip
                contentStyle={{
                  borderRadius: 10,
                  border: "1px solid oklch(0.90 0.010 250)",
                  fontSize: 12,
                }}
                formatter={(v: number, name: string) => [`${v.toFixed(2)} €`, name === "cost" ? "Coût" : name]}
                labelFormatter={(l) => `Date · ${l}`}
              />
              <ReferenceLine y={mean + sigma2} stroke={COLOR_DEST} strokeDasharray="4 2"
                label={{ value: "+2σ", position: "right", fontSize: 9, fill: COLOR_DEST }} />
              <ReferenceLine y={mean} stroke={COLOR_MUTED} strokeDasharray="2 2"
                label={{ value: "μ", position: "right", fontSize: 9, fill: COLOR_MUTED }} />
              <ReferenceLine y={Math.max(0, mean - sigma2)} stroke={COLOR_DEST} strokeDasharray="4 2"
                label={{ value: "-2σ", position: "right", fontSize: 9, fill: COLOR_DEST }} />
              <Area
                type="monotone"
                dataKey="cost"
                stroke={COLOR_BRAND}
                strokeWidth={1.5}
                fill={COLOR_BRAND}
                fillOpacity={0.06}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                dot={(props: any) => {
                  const { cx, cy, payload } = props
                  if (!payload.isAnomaly) return <g key={payload.date} />
                  return (
                    <g key={payload.date}>
                      <circle cx={cx} cy={cy} r={7} fill={COLOR_CORAL} fillOpacity={0.18} />
                      <circle cx={cx} cy={cy} r={4} fill={COLOR_CORAL} stroke="white" strokeWidth={1.5} />
                    </g>
                  )
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </SectionCard>

      {/* Stationarity + STL strengths */}
      <section aria-label="Diagnostic" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Tests de stationnarité" description="ADF + KPSS" contentClassName="space-y-3">
          {(statLoading || !stationarity) ? (
            <Skeleton className="h-[180px]" />
          ) : (
            <>
              {[
                { key: "adf" as const,  label: "ADF (Augmented Dickey-Fuller)" },
                { key: "kpss" as const, label: "KPSS" },
              ].map(({ key, label }) => (
                <div key={key} className="rounded-lg border border-border p-3.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-medium text-sm">{label}</span>
                    {stationarity[key].isStationary ? (
                      <Badge variant="success">Stationnaire ✓</Badge>
                    ) : (
                      <Badge variant="destructive">Non-stationnaire ✗</Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    p = {stationarity[key].pValue.toFixed(4)} · stat = {stationarity[key].statistic.toFixed(4)} · lags = {stationarity[key].lagsUsed}
                  </p>
                </div>
              ))}
              <div className="rounded-lg bg-brand/6 border border-brand/12 p-3.5 text-xs text-foreground/85">
                <strong className="text-foreground">Verdict · </strong>
                {stationarity.adf.isStationary && !stationarity.kpss.isStationary
                  ? "Résultats contradictoires → série trend-stationnaire. Détrending recommandé."
                  : stationarity.adf.isStationary && stationarity.kpss.isStationary
                  ? "Série stationnaire selon les deux tests."
                  : "Série non-stationnaire — différenciation recommandée."}
              </div>
            </>
          )}
        </SectionCard>

        <SectionCard title="Force STL" description="Force de tendance et saisonnalité (Wang et al.)" contentClassName="space-y-3">
          {(strengthsLoading || !strengths) ? (
            <Skeleton className="h-[180px]" />
          ) : (
            <>
              <StrengthBar label="Force de tendance (Ft)" value={strengths.ft} color={COLOR_BRAND} />
              <StrengthBar
                label={`Force saisonnière (Fs) · période ${strengths.period} j`}
                value={strengths.fs}
                color={COLOR_TEAL}
              />
            </>
          )}
        </SectionCard>
      </section>
    </PageShell>
  )
}
