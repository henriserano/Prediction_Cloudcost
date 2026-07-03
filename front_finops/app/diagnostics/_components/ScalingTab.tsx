"use client"

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts"
import { SectionCard } from "@/components/ui/section-card"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { useScaling } from "@/lib/hooks/useApi"
import { COLOR_BRAND, COLOR_CORAL, COLOR_TEAL, COLOR_MUTED, chartTooltipStyle, num } from "./shared"

interface ScalerDefinition {
  key: "standard" | "minmax" | "robust"
  label: string
  color: string
  description: string
  formula: string
}

const SCALERS: ScalerDefinition[] = [
  {
    key: "standard",
    label: "Standard Scaler",
    color: COLOR_BRAND,
    description: "Centre autour de 0, écart-type unitaire",
    formula: "(x − μ) / σ",
  },
  {
    key: "minmax",
    label: "Min-Max Scaler",
    color: COLOR_CORAL,
    description: "Ramène toutes les valeurs dans [0, 1]",
    formula: "(x − min) / (max − min)",
  },
  {
    key: "robust",
    label: "Robust Scaler",
    color: COLOR_TEAL,
    description: "Insensible aux outliers · basé sur médiane et IQR",
    formula: "(x − médiane) / IQR",
  },
]

export default function ScalingTab() {
  const { data, isLoading, error } = useScaling()

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
        <Skeleton className="h-[280px]" />
      </div>
    )
  }
  if (error || !data) {
    return <EmptyState title="Impossible de charger l'analyse de scaling" />
  }

  return (
    <div className="space-y-4 lg:space-y-5">
      {/* Scaler stats */}
      <section aria-label="Paramètres des scalers" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {SCALERS.map((s) => (
          <div key={s.key} className="rounded-xl border border-border bg-card p-4 space-y-2 relative overflow-hidden">
            <span
              aria-hidden
              className="absolute top-0 left-0 h-0.5 w-full"
              style={{ backgroundColor: s.color }}
            />
            <div className="flex items-center gap-2">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              <h3 className="font-heading text-sm font-semibold">{s.label}</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-snug">{s.description}</p>
            <code className="block rounded bg-muted px-2 py-1 text-[11px] font-mono">{s.formula}</code>
            <div className="pt-1 space-y-0.5">
              {s.key === "standard" && (
                <>
                  <p className="text-[11px] flex justify-between"><span className="text-muted-foreground">μ</span><span className="tabular-nums font-semibold">{num(data.stats.standard.mean)}</span></p>
                  <p className="text-[11px] flex justify-between"><span className="text-muted-foreground">σ</span><span className="tabular-nums font-semibold">{num(data.stats.standard.std)}</span></p>
                </>
              )}
              {s.key === "minmax" && (
                <>
                  <p className="text-[11px] flex justify-between"><span className="text-muted-foreground">min</span><span className="tabular-nums font-semibold">{num(data.stats.minmax.min)}</span></p>
                  <p className="text-[11px] flex justify-between"><span className="text-muted-foreground">max</span><span className="tabular-nums font-semibold">{num(data.stats.minmax.max)}</span></p>
                </>
              )}
              {s.key === "robust" && (
                <>
                  <p className="text-[11px] flex justify-between"><span className="text-muted-foreground">médiane</span><span className="tabular-nums font-semibold">{num(data.stats.robust.median)}</span></p>
                  <p className="text-[11px] flex justify-between"><span className="text-muted-foreground">IQR</span><span className="tabular-nums font-semibold">{num(data.stats.robust.iqr)}</span></p>
                </>
              )}
            </div>
          </div>
        ))}
      </section>

      {/* Overlaid line chart */}
      <SectionCard
        title="Séries mises à l'échelle"
        description="Trois transformations superposées · toutes ramenées à des unités comparables"
      >
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={data.points} margin={{ left: -18, right: 8, top: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0 0 0 / 0.06)" />
            <XAxis
              dataKey="date"
              tickFormatter={(v: string) => v.slice(5)}
              tick={{ fontSize: 10, fill: COLOR_MUTED }}
              tickLine={false}
              axisLine={false}
              interval={Math.max(1, Math.floor(data.points.length / 12))}
            />
            <YAxis tick={{ fontSize: 10, fill: COLOR_MUTED }} tickLine={false} axisLine={false} width={50} />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(v: unknown, name: string) => {
                const label = SCALERS.find((s) => s.key === name)?.label ?? name
                return [(v as number).toFixed(3), label]
              }}
              labelFormatter={(l) => `Date · ${l}`}
            />
            {SCALERS.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={1.6}
                dot={false}
                name={s.key}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-2 flex-wrap">
          {SCALERS.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-foreground/80">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </SectionCard>

      {/* Guidance card */}
      <SectionCard title="Quand utiliser quel scaler ?" description="Recommandation basée sur les diagnostics des autres onglets" accent="coral">
        <ul className="space-y-2 text-sm text-foreground/85">
          <li className="flex gap-2">
            <span aria-hidden className="mt-1 inline-block h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: COLOR_BRAND }} />
            <span><strong>Standard</strong> · pour les modèles paramétriques qui supposent des données centrées-réduites (régression linéaire, PCA, SVM à noyau gaussien).</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="mt-1 inline-block h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: COLOR_CORAL }} />
            <span><strong>Min-Max</strong> · pour les algorithmes sensibles aux bornes fixes (réseaux de neurones avec activations bornées, KNN sans standardisation).</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="mt-1 inline-block h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: COLOR_TEAL }} />
            <span><strong>Robust</strong> · si l&apos;onglet Outliers a détecté beaucoup d&apos;anomalies · évite que quelques points extrêmes n&apos;écrasent l&apos;échelle.</span>
          </li>
        </ul>
      </SectionCard>
    </div>
  )
}
