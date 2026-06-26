"use client"

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts"
import PageShell from "@/components/layout/PageShell"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useServices, useKPI } from "@/lib/hooks/useApi"

const SERVICE_COLORS = [
  "#1a6cf6", "#0891b2", "#7c3aed", "#059669", "#d97706", "#dc2626", "#64748b", "#0d9488",
]

function CVBadge({ cv }: { cv: number }) {
  const label = cv < 20 ? "Stable" : cv < 60 ? "Modéré" : "Volatile"
  const cls =
    cv < 20 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
    : cv < 60 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
    : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  )
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-muted ${className}`} />
}

export default function ServicesPage() {
  const { data: services, isLoading: servicesLoading } = useServices()
  const { data: kpi, isLoading: kpiLoading } = useKPI()

  const top5Pct = services
    ? services.slice(0, 5).reduce((s, svc) => s + svc.pct, 0).toFixed(0)
    : "—"

  return (
    <PageShell
      title="Services"
      description="Analyse Pareto 80/20 — répartition et volatilité par service GCP"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4">
        {(servicesLoading || kpiLoading || !services || !kpi) ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <Card className="relative overflow-hidden">
              <div className="absolute top-0 left-0 h-0.5 w-full bg-gradient-to-r from-[oklch(0.48_0.24_264)] to-transparent" />
              <CardHeader><CardDescription className="text-xs font-medium uppercase tracking-wider">Services analysés</CardDescription></CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{services.length}</p>
                <p className="text-xs text-muted-foreground mt-1">sur la période complète</p>
              </CardContent>
            </Card>
            <Card className="relative overflow-hidden">
              <div className="absolute top-0 left-0 h-0.5 w-full bg-gradient-to-r from-[oklch(0.48_0.24_264)] to-transparent" />
              <CardHeader><CardDescription className="text-xs font-medium uppercase tracking-wider">Service dominant</CardDescription></CardHeader>
              <CardContent>
                <p className="text-lg font-bold leading-tight">{kpi.topService}</p>
                <p className="text-xs text-muted-foreground mt-1">{kpi.topServicePct}% du total</p>
              </CardContent>
            </Card>
            <Card className="relative overflow-hidden col-span-2 lg:col-span-1">
              <div className="absolute top-0 left-0 h-0.5 w-full bg-gradient-to-r from-[oklch(0.48_0.24_264)] to-transparent" />
              <CardHeader><CardDescription className="text-xs font-medium uppercase tracking-wider">Loi de Pareto</CardDescription></CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{top5Pct}%</p>
                <p className="text-xs text-muted-foreground mt-1">concentrés sur 5 services</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Analyse Pareto 80/20</CardTitle>
          <CardDescription>Coût total (barres) · % cumulé (ligne) · Seuil 80% (rouge)</CardDescription>
        </CardHeader>
        <CardContent>
          {(servicesLoading || !services) ? (
            <Skeleton className="h-[280px]" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={services} margin={{ left: -20, right: 32 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="service" tick={{ fontSize: 9 }} tickLine={false} />
                <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickLine={false} unit=" €" width={56} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickLine={false} unit="%" domain={[0, 100]} width={36} />
                <Tooltip formatter={(v: number, name: string) =>
                  name === "cumPct" ? [`${v.toFixed(1)}%`, "% cumulé"] : [`${v.toFixed(0)} €`, "Coût"]} />
                <ReferenceLine yAxisId="right" y={80} stroke="#dc2626" strokeDasharray="4 2"
                  label={{ value: "80%", position: "right", fontSize: 10, fill: "#dc2626" }} />
                <Bar yAxisId="left" dataKey="cost" radius={[4, 4, 0, 0]} name="Coût">
                  {services.map((_, i) => (
                    <Cell key={i} fill={SERVICE_COLORS[i % SERVICE_COLORS.length]} />
                  ))}
                </Bar>
                <Line yAxisId="right" type="monotone" dataKey="cumPct" stroke="#64748b"
                  strokeWidth={2} dot={{ r: 3, fill: "#64748b" }} name="% cumulé" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Desktop table */}
      <Card className="hidden sm:block">
        <CardHeader>
          <CardTitle>Détail par service</CardTitle>
          <CardDescription>Coût, part, volatilité (CV) et profil de risque</CardDescription>
        </CardHeader>
        <CardContent>
          {(servicesLoading || !services) ? (
            <Skeleton className="h-[180px]" />
          ) : (
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
                  {services.map((s, i) => (
                    <tr key={s.service} className="hover:bg-muted/40 transition-colors">
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2">
                          <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: SERVICE_COLORS[i] }} />
                          <span className="text-sm">{s.service}</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right tabular-nums font-semibold">{s.cost.toLocaleString("fr-FR", { minimumFractionDigits: 0 })} €</td>
                      <td className="py-2.5 text-right tabular-nums">{s.pct.toFixed(1)}%</td>
                      <td className="py-2.5 text-right tabular-nums text-muted-foreground">{s.cumPct.toFixed(1)}%</td>
                      <td className="py-2.5 text-right tabular-nums">{s.cv.toFixed(1)}%</td>
                      <td className="py-2.5 text-center"><CVBadge cv={s.cv} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mobile cards */}
      <div className="sm:hidden space-y-3">
        {(servicesLoading || !services) ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)
        ) : (
          services.map((s, i) => (
            <Card key={s.service}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: SERVICE_COLORS[i] }} />
                    <span className="text-sm font-medium truncate">{s.service}</span>
                  </div>
                  <CVBadge cv={s.cv} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Coût</p>
                    <p className="font-bold tabular-nums">{s.cost.toLocaleString("fr-FR", { minimumFractionDigits: 0 })} €</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Part</p>
                    <p className="font-semibold tabular-nums">{s.pct.toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">CV</p>
                    <p className="font-semibold tabular-nums">{s.cv.toFixed(1)}%</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </PageShell>
  )
}
