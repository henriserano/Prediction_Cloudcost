"use client"

import { useMemo, useState } from "react"
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell, LabelList,
} from "recharts"
import { Trophy, Layers3, Target, Clock } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { KpiCard } from "@/components/ui/kpi-card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { useEnsembleForecast } from "@/lib/hooks/useApi"
import {
  CHART_COLORS, COLOR_BRAND, COLOR_CORAL, COLOR_MUTED, chartTooltipStyle, num,
} from "./shared"
import { cn } from "@/lib/utils"
import { Explain } from "@/components/ui/explain"

const HORIZONS: { label: string; value: number }[] = [
  { label: "30 j", value: 30 },
  { label: "60 j", value: 60 },
  { label: "90 j", value: 90 },
]

export default function EnsembleTab() {
  const [horizon, setHorizon] = useState(60)
  const { data, isLoading, error } = useEnsembleForecast(horizon)

  const weightRows = useMemo(() => {
    if (!data) return []
    return Object.entries(data.weights)
      .map(([model, weight]) => ({ model, weight }))
      .sort((a, b) => b.weight - a.weight)
  }, [data])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-[300px]" />
        <Skeleton className="h-[260px]" />
      </div>
    )
  }
  if (error || !data) {
    return <EmptyState title="Impossible de charger la prévision d'ensemble" />
  }

  const bestBase = [...data.biasVariance].sort((a, b) => a.totalError - b.totalError)[0]
  const totalForecast = data.points.reduce((s, p) => s + p.weightedEnsemble, 0)

  return (
    <div className="space-y-4 lg:space-y-5">
      {/* KPIs */}
      <section aria-label="Vue synthétique" className="grid grid-cols-1 sm:grid-cols-4 gap-3 lg:gap-4">
        <KpiCard
          label={`Prévision ${horizon} j (stacking)`}
          value={`${totalForecast.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`}
          sub={`Moyenne pondérée · ${data.points.length} points`}
          icon={Target}
          tone="coral"
          info={
            <Explain title="Prévision stacking" tone="warning">
              <p>
                La <strong>prévision stacking</strong> est une moyenne pondérée des 6 modèles de base, où chaque modèle reçoit un poids <em>proportionnel à l&apos;inverse de son MAE</em> (mesuré en cross-validation).
              </p>
              <p className="text-muted-foreground">
                Résultat : les modèles précis pèsent plus lourd, les modèles imprécis sont &laquo; noyés &raquo; mais gardent une petite voix — c&apos;est ce qui rend le stacking robuste.
              </p>
            </Explain>
          }
        />
        <KpiCard
          label="Modèles agrégés"
          value={data.baseModels.length}
          sub="Bagging + Stacking"
          icon={Layers3}
          tone="default"
          info={
            <Explain title="Bagging vs Stacking" tone="info" size="lg">
              <p>
                <strong>Bagging</strong> = <em>bootstrap aggregation</em> · moyenne simple non pondérée des prédictions. Simple, robuste au bruit, mais accorde autant d&apos;importance à un mauvais modèle qu&apos;à un bon.
              </p>
              <p>
                <strong>Stacking</strong> = <em>stacked generalization</em> · combinaison pondérée où les poids sont appris. Ici, poids ∝ 1/MAE (méthode simple). Version avancée : entraîner un &laquo; meta-model &raquo; sur les prédictions out-of-fold.
              </p>
              <p className="text-muted-foreground">
                Dans le graphique ci-dessous, la ligne <strong>navy pointillée</strong> est le bagging, la ligne <strong>corail pleine</strong> est le stacking. Comparez les deux pour voir si la pondération apporte quelque chose.
              </p>
            </Explain>
          }
        />
        <KpiCard
          label="Meilleur modèle base"
          value={<span className="text-base">{bestBase?.model ?? "—"}</span>}
          sub={bestBase ? `Erreur totale ${num(bestBase.totalError)}` : undefined}
          icon={Trophy}
          tone="success"
        />
        <KpiCard
          label="Horizon actif"
          value={`${horizon} j`}
          sub="Modifiable ci-dessous"
          icon={Clock}
          tone="default"
        />
      </section>

      {/* Horizon picker */}
      <div className="flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 gap-0.5">
          {HORIZONS.map((h) => (
            <button
              key={h.value}
              onClick={() => setHorizon(h.value)}
              aria-pressed={horizon === h.value}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-semibold tabular-nums transition-all",
                horizon === h.value
                  ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {h.label}
            </button>
          ))}
        </div>
      </div>

      {/* Ensemble chart */}
      <SectionCard
        title="Prévision ensemble"
        description="Bagging (moyenne simple) vs Stacking (pondération inverse MAE) · bande cross-model IC 80%"
      >
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data.points} margin={{ left: -18, right: 8, top: 8 }}>
            <defs>
              <linearGradient id="ensBand" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLOR_CORAL} stopOpacity={0.25} />
                <stop offset="95%" stopColor={COLOR_CORAL} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0 0 0 / 0.06)" />
            <XAxis
              dataKey="date"
              tickFormatter={(v: string) => v.slice(5)}
              tick={{ fontSize: 10, fill: COLOR_MUTED }}
              tickLine={false}
              axisLine={false}
              interval={Math.max(1, Math.floor(data.points.length / 10))}
            />
            <YAxis tick={{ fontSize: 10, fill: COLOR_MUTED }} tickLine={false} axisLine={false} unit=" €" width={56} />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(v: unknown, name: string) => {
                const n = v as number
                const labels: Record<string, string> = {
                  actual: "Réel",
                  meanEnsemble: "Bagging",
                  weightedEnsemble: "Stacking",
                  hi80: "IC hi",
                  lo80: "IC lo",
                }
                return [`${n.toFixed(2)} €`, labels[name] ?? name]
              }}
              labelFormatter={(l) => `Date · ${l}`}
            />
            <Area type="monotone" dataKey="hi80" stroke="none" fill="url(#ensBand)" name="hi80" isAnimationActive={false} />
            <Area type="monotone" dataKey="lo80" stroke="none" fill="white" isAnimationActive={false} />
            <Line type="monotone" dataKey="actual" stroke={COLOR_MUTED} strokeWidth={1.5} dot={false} name="actual" connectNulls={false} />
            <Line type="monotone" dataKey="meanEnsemble" stroke={COLOR_BRAND} strokeWidth={1.5} dot={false} name="meanEnsemble" strokeDasharray="6 3" />
            <Line type="monotone" dataKey="weightedEnsemble" stroke={COLOR_CORAL} strokeWidth={2.5} dot={false} name="weightedEnsemble" />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-2 flex-wrap text-[11px]">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-4" style={{ backgroundColor: COLOR_MUTED }} />
            Historique
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-4 border-t border-dashed" style={{ borderColor: COLOR_BRAND }} />
            Bagging (moyenne)
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-4" style={{ backgroundColor: COLOR_CORAL }} />
            Stacking (pondéré)
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2 w-4 rounded-sm" style={{ background: `${COLOR_CORAL}22` }} />
            IC 80% cross-model
          </span>
        </div>
      </SectionCard>

      {/* Weights */}
      <SectionCard
        title="Poids du stacking (inverse MAE)"
        description="Un modèle avec un MAE plus faible reçoit un poids plus important"
      >
        <ResponsiveContainer width="100%" height={Math.max(200, 40 + weightRows.length * 34)}>
          <BarChart
            data={weightRows}
            layout="vertical"
            margin={{ left: 8, right: 32, top: 8, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="oklch(0 0 0 / 0.06)" />
            <XAxis
              type="number"
              tick={{ fontSize: 10, fill: COLOR_MUTED }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
            />
            <YAxis
              type="category"
              dataKey="model"
              tick={{ fontSize: 10, fill: COLOR_MUTED }}
              tickLine={false}
              axisLine={false}
              width={140}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(v: unknown) => [`${((v as number) * 100).toFixed(2)}%`, "Poids"]}
            />
            <Bar dataKey="weight" radius={[0, 6, 6, 0]}>
              {weightRows.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
              <LabelList dataKey="weight" position="right" formatter={(v: unknown) => `${((v as number) * 100).toFixed(1)}%`} style={{ fontSize: 10, fill: COLOR_MUTED }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      {/* Bias/variance table */}
      <SectionCard
        title="Décomposition bias² / variance / total error"
        description="Sur les folds de walk-forward CV · plus la variance est haute, plus le modèle sur-apprend"
        info={
          <Explain title="Le tradeoff bias-variance" tone="info" size="lg">
            <p>
              L&apos;erreur totale d&apos;un modèle se décompose en trois termes indépendants :
            </p>
            <p>
              <strong>Erreur totale = Bias² + Variance + Bruit irréductible</strong>
            </p>
            <ul className="space-y-1.5 pl-3 list-disc marker:text-[color:var(--accent-coral)]">
              <li><strong>Bias²</strong> · erreur systématique due à un modèle trop simple qui ne capture pas la vraie relation. Un bias élevé = <em>sous-apprentissage</em>.</li>
              <li><strong>Variance</strong> · sensibilité aux fluctuations des données d&apos;entraînement. Une variance élevée = <em>sur-apprentissage</em>.</li>
              <li><strong>Bruit irréductible</strong> · limite théorique liée à l&apos;imprédictibilité intrinsèque du phénomène.</li>
            </ul>
            <p className="text-muted-foreground">
              <strong>Le compromis</strong> : réduire le bias augmente typiquement la variance et vice-versa. L&apos;objectif est de minimiser la somme des deux, pas l&apos;un des deux.
            </p>
          </Explain>
        }
      >
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs">
                <th className="pb-2.5 text-left font-medium pl-1">Modèle</th>
                <th className="pb-2.5 text-right font-medium">Bias²</th>
                <th className="pb-2.5 text-right font-medium">Variance</th>
                <th className="pb-2.5 text-right font-medium">Erreur totale</th>
                <th className="pb-2.5 text-right font-medium">Poids stacking</th>
                <th className="pb-2.5 text-center font-medium pr-1">Profil</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[...data.biasVariance]
                .sort((a, b) => a.totalError - b.totalError)
                .map((r, idx) => {
                  const ratio = r.variance > 0 ? r.biasSquared / r.variance : Infinity
                  const profile =
                    ratio > 5 ? { label: "Under-fit", variant: "coral" as const }
                    : ratio < 0.2 ? { label: "Over-fit", variant: "destructive" as const }
                    : { label: "Équilibré", variant: "success" as const }
                  const weight = data.weights[r.model] ?? 0
                  return (
                    <tr key={r.model} className="hover:bg-muted/40">
                      <td className="py-2.5 pl-1 font-medium">
                        <div className="flex items-center gap-1.5">
                          {idx === 0 && <Trophy className="h-3 w-3 text-[color:var(--accent-gold)]" aria-label="Meilleur" />}
                          {r.model}
                        </div>
                      </td>
                      <td className="py-2.5 text-right tabular-nums">{num(r.biasSquared)}</td>
                      <td className="py-2.5 text-right tabular-nums">{num(r.variance)}</td>
                      <td className="py-2.5 text-right tabular-nums font-bold">{num(r.totalError)}</td>
                      <td className="py-2.5 text-right tabular-nums">{(weight * 100).toFixed(1)}%</td>
                      <td className="py-2.5 text-center pr-1">
                        <Badge variant={profile.variant} size="sm">{profile.label}</Badge>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Erreur totale ≈ Bias² + Variance + bruit irréductible. Ratio bias²/variance élevé = sous-apprentissage, faible = sur-apprentissage.
        </p>
      </SectionCard>
    </div>
  )
}
