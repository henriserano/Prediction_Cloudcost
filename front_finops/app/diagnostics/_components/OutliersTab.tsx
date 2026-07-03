"use client"

import { useMemo, useState } from "react"
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Scatter, Cell,
} from "recharts"
import { AlertTriangle, ShieldCheck, Sigma } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { KpiCard } from "@/components/ui/kpi-card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { useOutliers } from "@/lib/hooks/useApi"
import { cn } from "@/lib/utils"
import { CHART_COLORS, COLOR_CORAL, COLOR_MUTED, chartTooltipStyle, num } from "./shared"
import { Explain, Verdict } from "@/components/ui/explain"

const METHOD_LABEL: Record<string, string> = {
  zscore:            "Z-score",
  modified_zscore:   "Z modifié (MAD)",
  iqr:               "IQR / Tukey",
  isolation_forest:  "Isolation Forest",
  lof:               "LOF",
}

function methodExplain(method: string, count: number, pct: number): React.ReactNode {
  const verdictTone = pct === 0 ? "success" : pct > 20 ? "warning" : "info"
  const verdictText =
    pct === 0
      ? `Aucun point ne dépasse le seuil. La série est propre selon ce test.`
      : pct > 20
        ? `${count} points flaggés (${pct.toFixed(1)}%). Beaucoup pour un détecteur strict — le seuil est peut-être trop bas ou vos données ont des queues épaisses.`
        : `${count} points flaggés (${pct.toFixed(1)}%). Quantité raisonnable — inspectez chaque date pour comprendre.`
  switch (method) {
    case "zscore":
      return (
        <>
          <p><strong>Z-score</strong> mesure de combien d&apos;écarts-types une valeur s&apos;éloigne de la moyenne. Un |z| supérieur à 2 signale une donnée &laquo; inhabituelle &raquo; (5% des cas dans une loi normale).</p>
          <p className="text-muted-foreground">Sensible aux outliers eux-mêmes : la moyenne et l&apos;écart-type sont biaisés par les points extrêmes.</p>
          <Verdict tone={verdictTone as "info" | "success" | "warning"}>{verdictText}</Verdict>
        </>
      )
    case "modified_zscore":
      return (
        <>
          <p><strong>Z modifié (Iglewicz-Hoaglin)</strong> utilise la médiane et le MAD (Median Absolute Deviation) au lieu de la moyenne et de l&apos;écart-type. Beaucoup plus robuste aux outliers.</p>
          <p className="text-muted-foreground">Seuil classique : |mod-z| supérieur à 3.5.</p>
          <Verdict tone={verdictTone as "info" | "success" | "warning"}>{verdictText}</Verdict>
        </>
      )
    case "iqr":
      return (
        <>
          <p><strong>IQR / méthode de Tukey</strong> : un point est un outlier s&apos;il tombe hors de [Q1 − k·IQR, Q3 + k·IQR] avec k=1.5 par défaut.</p>
          <p className="text-muted-foreground">Non paramétrique, ne présuppose aucune loi.</p>
          <Verdict tone={verdictTone as "info" | "success" | "warning"}>{verdictText}</Verdict>
        </>
      )
    case "isolation_forest":
      return (
        <>
          <p><strong>Isolation Forest</strong> isole récursivement chaque point via des arbres aléatoires. Les points anomaux nécessitent moins de splits pour être isolés → score plus bas.</p>
          <p className="text-muted-foreground">Multivarié, capture des anomalies subtiles que les tests univariés ratent.</p>
          <Verdict tone={verdictTone as "info" | "success" | "warning"}>{verdictText}</Verdict>
        </>
      )
    case "lof":
      return (
        <>
          <p><strong>LOF (Local Outlier Factor)</strong> compare la densité locale autour d&apos;un point à celle de ses voisins. Un LOF supérieur à 1 = point moins dense que ses voisins → probablement isolé.</p>
          <p className="text-muted-foreground">Efficace pour les outliers &laquo; contextuels &raquo; qui semblent normaux globalement.</p>
          <Verdict tone={verdictTone as "info" | "success" | "warning"}>{verdictText}</Verdict>
        </>
      )
  }
  return null
}

export default function OutliersTab() {
  const [zThreshold, setZThreshold] = useState(2.0)
  const [iqrMultiplier, setIqrMultiplier] = useState(1.5)
  const { data, isLoading, error } = useOutliers(zThreshold, iqrMultiplier)

  // Consensus: how many detectors flag each date
  const consensusRows = useMemo(() => {
    if (!data) return []
    return data.rows.map((r) => {
      const flags =
        (Math.abs(r.zscore) >= zThreshold ? 1 : 0) +
        (Math.abs(r.modifiedZscore) >= 3.5 ? 1 : 0) +
        (r.iqrFlag ? 1 : 0) +
        (r.isolationFlag ? 1 : 0) +
        (r.lofFlag ? 1 : 0)
      return { date: r.date, cost: r.cost, consensus: flags }
    })
  }, [data, zThreshold])

  const flaggedRows = useMemo(() => {
    if (!data) return []
    return data.rows.filter(
      (r) =>
        Math.abs(r.zscore) >= zThreshold ||
        Math.abs(r.modifiedZscore) >= 3.5 ||
        r.iqrFlag ||
        r.isolationFlag ||
        r.lofFlag
    )
  }, [data, zThreshold])

  const mahalanobisFlagged = data?.mahalanobis.filter((m) => m.isOutlier).length ?? 0

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-[300px]" />
        <Skeleton className="h-[220px]" />
      </div>
    )
  }
  if (error || !data) {
    return <EmptyState title="Impossible de charger les analyses d'outliers" />
  }

  return (
    <div className="space-y-4 lg:space-y-5">
      {/* Method summary cards */}
      <section aria-label="Détecteurs" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {data.summary.map((s) => (
          <KpiCard
            key={s.method}
            label={METHOD_LABEL[s.method] ?? s.method}
            value={s.flaggedCount}
            sub={`${s.flaggedPct.toFixed(1)}% flaggé${s.flaggedCount > 1 ? "s" : ""}${s.threshold != null ? ` · seuil ${s.threshold}` : ""}`}
            icon={s.flaggedCount === 0 ? ShieldCheck : AlertTriangle}
            tone={s.flaggedCount === 0 ? "success" : "coral"}
            info={
              <Explain
                title={METHOD_LABEL[s.method] ?? s.method}
                tone={s.flaggedCount === 0 ? "success" : "warning"}
              >
                {methodExplain(s.method, s.flaggedCount, s.flaggedPct)}
              </Explain>
            }
          />
        ))}
        <KpiCard
          label="Mahalanobis (MCD)"
          value={mahalanobisFlagged}
          sub={`${data.mahalanobis.length > 0 ? ((mahalanobisFlagged / data.mahalanobis.length) * 100).toFixed(1) : "0"}% · matrice par service`}
          icon={Sigma}
          tone={mahalanobisFlagged === 0 ? "success" : "destructive"}
          info={
            <Explain
              title="Distance de Mahalanobis (MCD)"
              tone={mahalanobisFlagged === 0 ? "success" : "destructive"}
            >
              <p>
                <strong>Mahalanobis</strong> mesure la distance d&apos;un point à un centre de nuage, en tenant compte de la <em>corrélation entre variables</em>. Ici, la matrice est bâtie <strong>par service</strong>.
              </p>
              <p className="text-muted-foreground">
                <strong>MCD (Minimum Covariance Determinant)</strong> est la version robuste : la covariance est estimée sur un sous-ensemble représentatif, insensible aux outliers extrêmes.
              </p>
              <Verdict tone={mahalanobisFlagged === 0 ? "success" : "destructive"}>
                {mahalanobisFlagged === 0
                  ? "Aucun point n'est significativement éloigné du centre robuste."
                  : `${mahalanobisFlagged} jours détectés — vérifiez la corrélation entre services ces jours-là (bug de synchronisation ? incident global ?).`}
              </Verdict>
            </Explain>
          }
        />
      </section>

      {/* Controls */}
      <SectionCard
        title="Paramètres des détecteurs"
        description="Ajustez les seuils · les résultats se recalculent"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ThresholdSlider
            label="Seuil Z-score"
            value={zThreshold}
            min={1}
            max={4}
            step={0.1}
            onChange={setZThreshold}
          />
          <ThresholdSlider
            label="Multiplicateur IQR"
            value={iqrMultiplier}
            min={1}
            max={3}
            step={0.1}
            onChange={setIqrMultiplier}
          />
        </div>
      </SectionCard>

      {/* Consensus chart */}
      <SectionCard
        title="Consensus multi-détecteurs"
        description="Coût brut · nombre de détecteurs qui flaggent chaque date (0 à 5)"
        info={
          <Explain title="Consensus multi-détecteurs" tone="info">
            <p>
              Chaque méthode a ses forces et ses angles morts. Le <strong>consensus</strong> compte combien de détecteurs (sur 5) sont d&apos;accord pour flagger une date donnée.
            </p>
            <p>
              Une date flaggée par <strong>3 méthodes ou plus</strong> est une anomalie de forte confiance (barre corail). Flaggée par 1-2 méthodes seulement (barre ambre) : à investiguer, potentiellement un faux positif d&apos;un détecteur trop sensible.
            </p>
          </Explain>
        }
      >
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={consensusRows} margin={{ left: -18, right: 8, top: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0 0 0 / 0.06)" />
            <XAxis
              dataKey="date"
              tickFormatter={(v: string) => v.slice(5)}
              tick={{ fontSize: 10, fill: COLOR_MUTED }}
              tickLine={false}
              axisLine={false}
              interval={Math.max(1, Math.floor(consensusRows.length / 12))}
            />
            <YAxis yAxisId="cost" tick={{ fontSize: 10, fill: COLOR_MUTED }} tickLine={false} axisLine={false} unit=" €" width={56} />
            <YAxis yAxisId="cons" orientation="right" tick={{ fontSize: 10, fill: COLOR_MUTED }} tickLine={false} axisLine={false} domain={[0, 5]} width={26} />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(v: unknown, name: string) => {
                const n = v as number
                return name === "consensus"
                  ? [`${n} détecteur${n > 1 ? "s" : ""}`, "Consensus"]
                  : [`${n.toFixed(2)} €`, "Coût"]
              }}
              labelFormatter={(l) => `Date · ${l}`}
            />
            <Bar yAxisId="cons" dataKey="consensus" name="consensus" barSize={6} radius={[2, 2, 0, 0]}>
              {consensusRows.map((r, i) => (
                <Cell
                  key={i}
                  fill={
                    r.consensus === 0
                      ? "oklch(0.90 0.010 250)"
                      : r.consensus <= 2
                        ? "oklch(0.75 0.15 78)"
                        : COLOR_CORAL
                  }
                />
              ))}
            </Bar>
            <Line yAxisId="cost" type="monotone" dataKey="cost" stroke={COLOR_MUTED} strokeWidth={1.5} dot={false} name="Coût" />
          </ComposedChart>
        </ResponsiveContainer>
      </SectionCard>

      {/* Detail table */}
      <SectionCard
        title="Dates flaggées"
        description={`${flaggedRows.length} date${flaggedRows.length > 1 ? "s" : ""} détectée${flaggedRows.length > 1 ? "s" : ""} par au moins un détecteur`}
      >
        {flaggedRows.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="Aucune anomalie détectée" />
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs min-w-[640px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="pb-2.5 text-left font-medium pl-1">Date</th>
                  <th className="pb-2.5 text-right font-medium">Coût</th>
                  <th className="pb-2.5 text-right font-medium">Z</th>
                  <th className="pb-2.5 text-right font-medium">Mod-Z</th>
                  <th className="pb-2.5 text-center font-medium">IQR</th>
                  <th className="pb-2.5 text-right font-medium">IsoForest</th>
                  <th className="pb-2.5 text-right font-medium">LOF</th>
                  <th className="pb-2.5 text-center font-medium pr-1">Sync</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {flaggedRows.slice(0, 50).map((r) => {
                  const flags =
                    (Math.abs(r.zscore) >= zThreshold ? 1 : 0) +
                    (Math.abs(r.modifiedZscore) >= 3.5 ? 1 : 0) +
                    (r.iqrFlag ? 1 : 0) +
                    (r.isolationFlag ? 1 : 0) +
                    (r.lofFlag ? 1 : 0)
                  return (
                    <tr key={r.date} className="hover:bg-muted/40 transition-colors">
                      <td className="py-2 pl-1 tabular-nums font-medium">{r.date}</td>
                      <td className="py-2 text-right tabular-nums">{num(r.cost)} €</td>
                      <td className={cn("py-2 text-right tabular-nums", Math.abs(r.zscore) >= zThreshold && "text-destructive font-semibold")}>
                        {num(r.zscore)}
                      </td>
                      <td className={cn("py-2 text-right tabular-nums", Math.abs(r.modifiedZscore) >= 3.5 && "text-destructive font-semibold")}>
                        {num(r.modifiedZscore)}
                      </td>
                      <td className="py-2 text-center">
                        {r.iqrFlag ? <span className="text-destructive">●</span> : <span className="text-muted-foreground">○</span>}
                      </td>
                      <td className={cn("py-2 text-right tabular-nums", r.isolationFlag && "text-destructive font-semibold")}>
                        {num(r.isolationScore, 3)}
                      </td>
                      <td className={cn("py-2 text-right tabular-nums", r.lofFlag && "text-destructive font-semibold")}>
                        {num(r.lofScore, 3)}
                      </td>
                      <td className="py-2 text-center pr-1">
                        <Badge variant={flags >= 3 ? "destructive" : flags >= 1 ? "warning" : "muted"} size="sm">
                          {flags}/5
                        </Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {flaggedRows.length > 50 && (
              <p className="text-[11px] text-muted-foreground mt-2 italic">
                + {flaggedRows.length - 50} autre{flaggedRows.length - 50 > 1 ? "s" : ""} · limité à 50 lignes
              </p>
            )}
          </div>
        )}
      </SectionCard>

      {/* Mahalanobis chart */}
      <SectionCard
        title="Distance de Mahalanobis (MCD)"
        description="Distance robuste basée sur la matrice de covariance par service · échelle log"
      >
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart
            data={data.mahalanobis.map((m) => ({
              date: m.date,
              distance: Math.max(m.distance, 0.01),
              isOutlier: m.isOutlier,
            }))}
            margin={{ left: -18, right: 8, top: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0 0 0 / 0.06)" />
            <XAxis
              dataKey="date"
              tickFormatter={(v: string) => v.slice(5)}
              tick={{ fontSize: 10, fill: COLOR_MUTED }}
              tickLine={false}
              axisLine={false}
              interval={Math.max(1, Math.floor(data.mahalanobis.length / 12))}
            />
            <YAxis
              scale="log"
              domain={[0.1, "auto"]}
              tick={{ fontSize: 10, fill: COLOR_MUTED }}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(v: unknown) => {
                const n = v as number
                return [n.toExponential(2), "Distance²"]
              }}
              labelFormatter={(l) => `Date · ${l}`}
            />
            <Line type="monotone" dataKey="distance" stroke={COLOR_CORAL} strokeWidth={1.5} dot={false} name="distance" />
            <Scatter
              dataKey="distance"
              data={data.mahalanobis.filter((m) => m.isOutlier).map((m) => ({
                date: m.date,
                distance: Math.max(m.distance, 0.01),
              }))}
              shape={(props: unknown) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { cx, cy } = props as any
                return <circle cx={cx} cy={cy} r={4} fill={CHART_COLORS[1]} stroke="white" strokeWidth={1.5} />
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </SectionCard>
    </div>
  )
}

function ThresholdSlider({
  label, value, min, max, step, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          {label}
        </label>
        <span className="text-sm font-bold tabular-nums text-foreground">{value.toFixed(1)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-[color:var(--accent-coral)]"
        aria-label={label}
      />
    </div>
  )
}
