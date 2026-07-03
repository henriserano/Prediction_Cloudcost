"use client"

import { useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts"
import { CheckCircle2, XCircle, AlertTriangle, ChevronDown } from "lucide-react"
import PageShell from "@/components/layout/PageShell"
import { SectionCard } from "@/components/ui/section-card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { cn } from "@/lib/utils"
import {
  useGCPStatus,
  useGCPProjects,
  useGCPBilling,
  useGCPLogs,
  useGCPServices,
  useIngestEvents,
} from "@/lib/hooks/useApi"
import { useSelectedGCPProject } from "@/lib/hooks/useSelectedGCPProject"
import type { GCPBillingByMonth, GCPBillingByService, GCPLogEntry, GCPServiceInfo } from "@/lib/types"

// ---------------------------------------------------------------------------
// Chart palette — aligned with Sia design system
// ---------------------------------------------------------------------------

const CHART_COLORS = [
  "oklch(0.22 0.055 258)",
  "oklch(0.66 0.185 28)",
  "oklch(0.60 0.11 195)",
  "oklch(0.52 0.19 295)",
  "oklch(0.75 0.15 78)",
  "oklch(0.62 0.14 155)",
  "oklch(0.48 0.02 250)",
  "oklch(0.42 0.15 320)",
]

const COLOR_MUTED = "oklch(0.65 0.02 250)"

const SEVERITY_VARIANT: Record<string, "destructive" | "warning" | "default" | "muted"> = {
  ERROR: "destructive",
  WARNING: "warning",
  INFO: "default",
}

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/6 px-3.5 py-3 text-sm text-destructive">
      <XCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
      <span>{message}</span>
    </div>
  )
}

function SuccessBanner({ message }: { message: string }) {
  return (
    <div role="status" className="flex items-start gap-2.5 rounded-lg border border-[color:var(--success)]/20 bg-[color:var(--success)]/10 px-3.5 py-3 text-sm text-[color:var(--success)]">
      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
      <span>{message}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Google logo
// ---------------------------------------------------------------------------

function GoogleLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Not authenticated — connect card
// ---------------------------------------------------------------------------

function ConnectCard() {
  return (
    <SectionCard accent="brand">
      <div className="flex flex-col items-center justify-center py-10 px-6 text-center gap-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-card border border-border shadow-sm">
          <GoogleLogo size={32} />
        </div>
        <div className="space-y-2 max-w-md">
          <h2 className="font-heading text-xl font-semibold text-foreground">
            Connectez votre compte Google Cloud
          </h2>
          <p className="text-sm text-muted-foreground text-pretty">
            L&apos;autorisation demande un accès en lecture seule à votre facturation GCP,
            vos journaux d&apos;audit et la liste de vos projets. Aucune donnée n&apos;est modifiée.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Badge variant="outline">Facturation · lecture</Badge>
          <Badge variant="outline">Journaux · lecture</Badge>
          <Badge variant="outline">Projets · lecture</Badge>
        </div>
        <Button
          className="gap-2 px-6"
          onClick={() => { window.location.href = "/api/gcp/auth" }}
        >
          <GoogleLogo size={16} />
          Se connecter avec Google
        </Button>
      </div>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Auth status + project selector
// ---------------------------------------------------------------------------

function AuthStatusCard({
  email,
  projects,
  projectsLoading,
  selectedProject,
  onSelectProject,
}: {
  email: string
  projects: { projectId: string; name: string }[] | undefined
  projectsLoading: boolean
  selectedProject: string
  onSelectProject: (id: string) => void
}) {
  return (
    <SectionCard accent="none">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--success)]/12 border border-[color:var(--success)]/20">
            <CheckCircle2 className="h-4 w-4 text-[color:var(--success)]" aria-hidden />
          </div>
          <div>
            <p className="text-sm font-semibold">Connecté</p>
            <p className="text-xs text-muted-foreground">{email}</p>
          </div>
        </div>
        <Badge variant="success">Authentifié</Badge>
      </div>

      <div className="space-y-2">
        <label htmlFor="project-select" className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Projet actif
        </label>
        {projectsLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <div className="relative">
            <select
              id="project-select"
              value={selectedProject}
              onChange={(e) => onSelectProject(e.target.value)}
              className="w-full appearance-none rounded-lg border border-border bg-card px-3 py-2.5 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-coral)]/40 focus:border-[color:var(--accent-coral)]/50 transition-shadow"
            >
              <option value="">— Choisir un projet —</option>
              {projects?.map((p) => (
                <option key={p.projectId} value={p.projectId}>
                  {p.name} ({p.projectId})
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
          </div>
        )}
      </div>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Billing overview
// ---------------------------------------------------------------------------

function BillingSection({ projectId }: { projectId: string }) {
  const { data: billing, isLoading, error } = useGCPBilling(projectId, 6)
  const { mutate: ingest, isPending: ingesting, isSuccess: ingestSuccess, error: ingestError } = useIngestEvents()

  function handleImport() {
    if (!billing) return
    const events = billing.byMonth.flatMap((monthRow: GCPBillingByMonth) =>
      billing.byService.map((svc: GCPBillingByService) => ({
        date: monthRow.month + "-01",
        service: svc.service,
        cost: parseFloat(((monthRow.cost * svc.pct) / 100).toFixed(4)),
        description: `Import GCP ${billing.projectId}`,
      }))
    )
    ingest({ events, replace: false })
  }

  if (isLoading) {
    return (
      <SectionCard title="Aperçu facturation" contentClassName="space-y-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-[200px]" />
      </SectionCard>
    )
  }

  if (error || !billing) {
    return (
      <SectionCard title="Aperçu facturation">
        <ErrorBanner message="Impossible de charger les données de facturation." />
      </SectionCard>
    )
  }

  return (
    <SectionCard
      title="Aperçu facturation"
      description={`${billing.period.start} – ${billing.period.end} · ${billing.currency}`}
      action={
        <div className="text-right">
          <p className="font-heading text-xl font-semibold tabular-nums text-foreground">
            {billing.total.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {billing.currency}
          </p>
          <p className="text-[11px] text-muted-foreground">Dépense totale</p>
        </div>
      }
      contentClassName="space-y-6"
    >
      {/* Monthly chart */}
      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Coût mensuel
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={billing.byMonth} margin={{ left: -18, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0 0 0 / 0.06)" />
            <XAxis
              dataKey="month"
              tickFormatter={(v: string) => v.slice(0, 7)}
              tick={{ fontSize: 10, fill: COLOR_MUTED }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis tick={{ fontSize: 10, fill: COLOR_MUTED }} tickLine={false} axisLine={false} unit=" €" width={60} />
            <Tooltip
              cursor={{ fill: "oklch(0 0 0 / 0.03)" }}
              contentStyle={{
                borderRadius: 10,
                border: "1px solid oklch(0.90 0.010 250)",
                fontSize: 12,
              }}
              formatter={(v: unknown) => {
                const x = v as number
                return [`${x.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} ${billing.currency}`, "Coût"]
              }}
              labelFormatter={(l: string) => `Mois · ${l}`}
            />
            <Bar dataKey="cost" radius={[6, 6, 0, 0]}>
              {billing.byMonth.map((_: GCPBillingByMonth, i: number) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Top services */}
      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Top services
        </p>
        <ul className="space-y-2.5">
          {billing.byService.slice(0, 8).map((svc: GCPBillingByService, i: number) => (
            <li key={svc.service} className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="truncate max-w-[240px] text-foreground/80">{svc.service}</span>
                <div className="flex gap-3 tabular-nums shrink-0">
                  <span className="font-semibold text-foreground">
                    {svc.cost.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} {billing.currency}
                  </span>
                  <span className="text-muted-foreground w-10 text-right">{svc.pct.toFixed(1)}%</span>
                </div>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${svc.pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Import CTA */}
      <div className="border-t border-border pt-4 space-y-3">
        {ingestSuccess && <SuccessBanner message="Données importées avec succès dans l'analyse FinOps." />}
        {ingestError && <ErrorBanner message="Erreur lors de l'import. Veuillez réessayer." />}
        <Button
          onClick={handleImport}
          disabled={ingesting || ingestSuccess}
          className="w-full sm:w-auto"
        >
          {ingesting ? "Import en cours…" : ingestSuccess ? "Importé" : "Importer dans l'analyse"}
        </Button>
      </div>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Logs section
// ---------------------------------------------------------------------------

const SEVERITY_FILTERS = ["ALL", "ERROR", "WARNING", "INFO"] as const
type SeverityFilter = typeof SEVERITY_FILTERS[number]

function LogsSection({ projectId }: { projectId: string }) {
  const [selectedSeverity, setSelectedSeverity] = useState<SeverityFilter>("ALL")
  const severity = selectedSeverity === "ALL" ? undefined : selectedSeverity
  const { data: logs, isLoading, error } = useGCPLogs(projectId, 50, severity)

  return (
    <SectionCard
      title="Journaux récents"
      description="Derniers événements du projet"
      action={
        <div className="flex gap-1 flex-wrap">
          {SEVERITY_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setSelectedSeverity(s)}
              aria-pressed={selectedSeverity === s}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors",
                selectedSeverity === s
                  ? "bg-brand text-brand-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      }
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : error ? (
        <ErrorBanner message="Impossible de charger les journaux." />
      ) : !logs || logs.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="Aucun log trouvé pour ce filtre"
          description="Sélectionnez une sévérité différente ou changez de projet."
        />
      ) : (
        <ul className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
          {logs.map((entry: GCPLogEntry, i: number) => (
            <li
              key={i}
              className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-xs"
            >
              <Badge
                variant={SEVERITY_VARIANT[entry.severity] ?? "muted"}
                size="sm"
                className="shrink-0 mt-0.5"
              >
                {entry.severity}
              </Badge>
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className="tabular-nums shrink-0">
                    {new Date(entry.timestamp).toLocaleString("fr-FR", {
                      dateStyle: "short",
                      timeStyle: "medium",
                    })}
                  </span>
                  <span className="text-muted-foreground/50">·</span>
                  <span className="truncate text-foreground/60">{entry.resourceType}</span>
                </div>
                <p className="text-foreground/85 leading-snug break-words">
                  {entry.message.length > 140 ? entry.message.slice(0, 140) + "…" : entry.message}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Services section
// ---------------------------------------------------------------------------

function ServicesSection({ projectId }: { projectId: string }) {
  const { data: services, isLoading, error } = useGCPServices(projectId)

  const grouped: Record<string, GCPServiceInfo[]> = {}
  if (services) {
    for (const svc of services) {
      const cat = svc.category || "Autre"
      if (!grouped[cat]) grouped[cat] = []
      grouped[cat].push(svc)
    }
  }
  const enabledCount = services?.filter((s) => s.enabled).length ?? 0

  return (
    <SectionCard
      title="Services GCP activés"
      description="APIs et services activés sur ce projet"
      action={
        !isLoading && services ? (
          <Badge variant="coral">
            {enabledCount} activé{enabledCount > 1 ? "s" : ""}
          </Badge>
        ) : null
      }
    >
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : error ? (
        <ErrorBanner message="Impossible de charger la liste des services." />
      ) : !services || services.length === 0 ? (
        <EmptyState title="Aucun service trouvé" />
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([category, svcs]) => (
            <div key={category}>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">
                {category}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {svcs.map((svc) => (
                  <div
                    key={svc.serviceId}
                    className={cn(
                      "flex items-center justify-between rounded-lg border px-3 py-2 text-xs gap-2 transition-colors",
                      svc.enabled
                        ? "border-border bg-card hover:border-[color:var(--accent-coral)]/30"
                        : "border-border/40 bg-muted/10 opacity-60"
                    )}
                  >
                    <span className="truncate text-foreground/85 font-medium">{svc.name}</span>
                    <Badge variant={svc.enabled ? "success" : "muted"} size="sm">
                      {svc.enabled ? "ON" : "OFF"}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Search params banners (Suspense boundary)
// ---------------------------------------------------------------------------

function SearchParamsBanners() {
  const searchParams = useSearchParams()
  const connected = searchParams.get("connected")
  const errorParam = searchParams.get("error")

  if (connected === "1") {
    return <SuccessBanner message="Connexion Google Cloud établie avec succès." />
  }
  if (errorParam) {
    return <ErrorBanner message={`Erreur d'authentification : ${decodeURIComponent(errorParam)}`} />
  }
  return null
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function GCPConnectPage() {
  const { data: status, isLoading: statusLoading } = useGCPStatus()
  const { data: projects, isLoading: projectsLoading } = useGCPProjects()
  const [selectedProject, setSelectedProject] = useSelectedGCPProject()

  const isAuthenticated = status?.authenticated === true
  const email = status?.email ?? ""

  return (
    <PageShell
      eyebrow="Provider"
      title="GCP Connect"
      description="Connexion directe à votre compte Google Cloud Platform"
    >
      <Suspense fallback={null}>
        <SearchParamsBanners />
      </Suspense>

      {statusLoading ? (
        <Skeleton className="h-40" />
      ) : !isAuthenticated ? (
        <ConnectCard />
      ) : (
        <>
          <AuthStatusCard
            email={email}
            projects={projects}
            projectsLoading={projectsLoading}
            selectedProject={selectedProject}
            onSelectProject={setSelectedProject}
          />

          {selectedProject && (
            <>
              <BillingSection projectId={selectedProject} />
              <LogsSection projectId={selectedProject} />
              <ServicesSection projectId={selectedProject} />
            </>
          )}
        </>
      )}
    </PageShell>
  )
}
