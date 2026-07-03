"use client"

import { useMemo } from "react"
import {
  BarChart, Bar, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LabelList,
} from "recharts"
import { Grid3x3, Sparkles, Component } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { KpiCard } from "@/components/ui/kpi-card"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { useDimReduction } from "@/lib/hooks/useApi"
import {
  CHART_COLORS, COLOR_BRAND, COLOR_CORAL, COLOR_MUTED, chartTooltipStyle, num,
} from "./shared"
import { Explain, Verdict } from "@/components/ui/explain"

export default function DimReductionTab() {
  const { data, isLoading, error } = useDimReduction()

  const screeData = useMemo(
    () =>
      data?.pcaComponents.map((c) => ({
        component: `PC${c.component}`,
        variance: c.varianceRatio * 100,
        cumulative: c.cumulativeRatio * 100,
      })) ?? [],
    [data]
  )

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
        <Skeleton className="h-[280px]" />
        <Skeleton className="h-[400px]" />
      </div>
    )
  }
  if (error || !data) {
    return <EmptyState title="Impossible de charger l'analyse de réduction de dimensions" />
  }

  return (
    <div className="space-y-4 lg:space-y-5">
      {/* KPIs */}
      <section aria-label="Vue synthétique" className="grid grid-cols-1 sm:grid-cols-3 gap-3 lg:gap-4">
        <KpiCard
          label="Services analysés"
          value={data.nServices}
          sub="Dimensions d'entrée"
          icon={Grid3x3}
          tone="default"
        />
        <KpiCard
          label="Observations"
          value={data.nDays}
          sub="Points temporels"
          icon={Component}
          tone="default"
        />
        <KpiCard
          label="Variance expliquée"
          value={`${(data.totalVarianceExplained * 100).toFixed(1)}%`}
          sub={`Cumulé sur ${data.pcaComponents.length} composantes`}
          icon={Sparkles}
          tone={data.totalVarianceExplained > 0.8 ? "success" : "coral"}
          info={
            <Explain
              title="Variance expliquée cumulée"
              tone={data.totalVarianceExplained > 0.8 ? "success" : "warning"}
            >
              <p>
                La PCA projette les <strong>n services</strong> sur des axes orthogonaux qui capturent le plus de variance. La variance cumulée mesure combien d&apos;information est <em>préservée</em> par les k premières composantes.
              </p>
              <p className="text-muted-foreground">
                Règle du pouce : viser <strong>&gt; 80%</strong> pour une bonne fidélité, <strong>&gt; 95%</strong> pour du reporting sans perte.
              </p>
              <Verdict tone={data.totalVarianceExplained > 0.8 ? "success" : "warning"}>
                {data.totalVarianceExplained > 0.8
                  ? `${(data.totalVarianceExplained * 100).toFixed(1)}% : compression efficace, on peut travailler dans un espace réduit sans perte majeure.`
                  : `${(data.totalVarianceExplained * 100).toFixed(1)}% : vos ${data.nServices} services ont des dynamiques largement indépendantes — augmenter n_components révélera plus de structure.`}
              </Verdict>
            </Explain>
          }
        />
      </section>

      {/* Scree plot */}
      <SectionCard
        title="Variance expliquée par composante (scree plot)"
        description="Barres = variance par PC · courbe = variance cumulée"
      >
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={screeData} margin={{ left: -18, right: 32, top: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0 0 0 / 0.06)" />
            <XAxis
              dataKey="component"
              tick={{ fontSize: 10, fill: COLOR_MUTED }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: COLOR_MUTED }}
              tickLine={false}
              axisLine={false}
              unit="%"
              width={40}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(v: unknown, name: string) => [
                `${(v as number).toFixed(1)}%`,
                name === "variance" ? "Variance" : "Cumulé",
              ]}
            />
            <Bar dataKey="variance" radius={[6, 6, 0, 0]}>
              {screeData.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
              <LabelList dataKey="cumulative" position="top" formatter={(v: unknown) => `${(v as number).toFixed(0)}%`} style={{ fontSize: 10, fill: COLOR_MUTED }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      {/* Top loadings per component */}
      <SectionCard
        title="Contributions par composante (loadings)"
        description="Poids des services dans chaque composante principale · signe indique la direction"
        info={
          <Explain title="Comment lire les loadings" tone="info">
            <p>
              Chaque composante principale est une <strong>combinaison linéaire</strong> des services. Le loading = coefficient du service dans cette combinaison.
            </p>
            <p className="text-muted-foreground">
              <strong>Loading positif</strong> (barre navy à droite) → le service augmente quand cette PC augmente. <strong>Loading négatif</strong> (barre corail à gauche) → le service diminue quand cette PC augmente. |loading| élevé = service <em>déterminant</em> pour cette PC.
            </p>
            <p className="text-muted-foreground">
              Utilité : nommer les composantes (&laquo; axe compute vs stockage &raquo;, &laquo; axe LLM vs infrastructure &raquo;, etc.).
            </p>
          </Explain>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.pcaComponents.map((c, cIdx) => {
            const entries = Object.entries(c.topLoadings)
              .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
            const maxAbs = Math.max(...entries.map(([, v]) => Math.abs(v)))
            return (
              <div key={c.component} className="rounded-xl border border-border bg-card p-4 space-y-2 relative overflow-hidden">
                <span
                  aria-hidden
                  className="absolute top-0 left-0 h-0.5 w-full"
                  style={{ backgroundColor: CHART_COLORS[cIdx % CHART_COLORS.length] }}
                />
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-heading text-sm font-semibold">PC{c.component}</h3>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {(c.varianceRatio * 100).toFixed(1)}% variance
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {entries.map(([service, value]) => {
                    const width = Math.abs(value) / maxAbs
                    return (
                      <li key={service}>
                        <div className="flex items-center justify-between text-[11px] mb-0.5">
                          <span className="truncate max-w-[130px]" title={service}>{service}</span>
                          <span className="tabular-nums font-semibold">
                            {value >= 0 ? "+" : ""}{num(value, 3)}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden relative">
                          <div
                            className="absolute inset-y-0 top-0"
                            style={{
                              width: `${width * 50}%`,
                              [value >= 0 ? "left" : "right"]: "50%",
                              backgroundColor: value >= 0 ? COLOR_BRAND : COLOR_CORAL,
                              transition: "width 500ms",
                            }}
                          />
                          <span
                            aria-hidden
                            className="absolute inset-y-0 w-px bg-border"
                            style={{ left: "50%" }}
                          />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      </SectionCard>

      {/* t-SNE scatter */}
      <SectionCard
        title="Projection t-SNE 2D des services"
        description={
          data.tsne2d.length > 0
            ? "Chaque point représente un service dans un espace 2D préservant les proximités locales"
            : "Non disponible pour ce dataset (moins de 3 services distincts, ou service qui n'a pas produit d'embeddings)"
        }
        info={
          <Explain title="t-SNE vs PCA" tone="info">
            <p>
              <strong>t-SNE</strong> est une projection <em>non linéaire</em> qui préserve les <strong>voisinages locaux</strong>. Deux services proches sur le plan t-SNE ont des profils temporels similaires.
            </p>
            <p className="text-muted-foreground">
              À l&apos;inverse, <strong>les distances globales n&apos;ont pas de sens</strong> en t-SNE. Ne vous fiez pas aux clusters éloignés — un service isolé n&apos;est pas &laquo; l&apos;opposé &raquo; d&apos;un cluster central.
            </p>
            <p className="text-muted-foreground">
              Usage : identifier des <em>groupes de services co-évoluant</em> qu&apos;on pourrait modéliser ensemble.
            </p>
          </Explain>
        }
      >
        {data.tsne2d.length === 0 ? (
          <EmptyState
            title="Projection t-SNE indisponible"
            description="Le calcul t-SNE nécessite au moins 3 services avec suffisamment de points. Il sera automatiquement calculé après ingestion de plus de données."
          />
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <ScatterChart margin={{ left: -18, right: 8, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0 0 0 / 0.06)" />
              <XAxis
                type="number"
                dataKey="x"
                name="t-SNE X"
                tick={{ fontSize: 10, fill: COLOR_MUTED }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="t-SNE Y"
                tick={{ fontSize: 10, fill: COLOR_MUTED }}
                tickLine={false}
                axisLine={false}
                width={50}
              />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                contentStyle={chartTooltipStyle}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                content={({ payload }: any) => {
                  if (!payload || payload.length === 0) return null
                  const p = payload[0].payload
                  return (
                    <div style={chartTooltipStyle} className="bg-card px-2 py-1.5">
                      <p className="text-xs font-semibold">{p.service}</p>
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        ({p.x.toFixed(2)}, {p.y.toFixed(2)})
                      </p>
                    </div>
                  )
                }}
              />
              <Scatter data={data.tsne2d} fill={COLOR_CORAL}>
                {data.tsne2d.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
                <LabelList
                  dataKey="service"
                  position="top"
                  style={{ fontSize: 9, fill: COLOR_MUTED }}
                />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </SectionCard>
    </div>
  )
}
