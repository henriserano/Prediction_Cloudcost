"use client"

import { useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts"
import { CheckCircle2, XCircle, AlertTriangle, ChevronDown } from "lucide-react"
import PageShell from "@/components/layout/PageShell"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  useGCPStatus,
  useGCPProjects,
  useGCPBilling,
  useGCPLogs,
  useGCPServices,
  useIngestEvents,
} from "@/lib/hooks/useApi"
import type { GCPBillingByMonth, GCPBillingByService, GCPLogEntry, GCPServiceInfo } from "@/lib/types"

// ---------------------------------------------------------------------------
// Design constants
// ---------------------------------------------------------------------------

const SERVICE_COLORS = [
  "#1a6cf6", "#0891b2", "#7c3aed", "#059669", "#d97706", "#dc2626", "#64748b", "#0d9488",
]

const SEVERITY_COLORS: Record<string, string> = {
  ERROR: "bg-red-100 text-red-700 border-red-200",
  WARNING: "bg-orange-100 text-orange-700 border-orange-200",
  INFO: "bg-blue-100 text-blue-700 border-blue-200",
  DEFAULT: "bg-gray-100 text-gray-600 border-gray-200",
}

function severityClass(severity: string) {
  return SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.DEFAULT
}

// ---------------------------------------------------------------------------
// Small reusable helpers
// ---------------------------------------------------------------------------

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-muted ${className}`} />
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-destructive/8 border border-destructive/15 px-4 py-3 text-sm text-destructive">
      <XCircle className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

function SuccessBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
      <CheckCircle2 className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Google SVG logo (inline, no external dep)
// ---------------------------------------------------------------------------

function GoogleLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Section: Not authenticated — connect card
// ---------------------------------------------------------------------------

function ConnectCard() {
  return (
    <Card className="relative overflow-hidden">
      <div className="absolute top-0 left-0 h-0.5 w-full bg-gradient-to-r from-[oklch(0.48_0.24_264)] via-[oklch(0.60_0.18_195)] to-transparent" />
      <CardContent className="flex flex-col items-center justify-center py-14 px-6 text-center gap-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white border border-border shadow-sm">
          <GoogleLogo size={32} />
        </div>
        <div className="space-y-2 max-w-md">
          <h2 className="text-xl font-bold text-foreground">Connectez votre compte Google Cloud</h2>
          <p className="text-sm text-muted-foreground">
            {"L'autorisation demande un accès en lecture seule à votre facturation GCP, vos journaux d'audit et la liste de vos projets. Aucune donnée n'est modifiée."}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-muted px-3 py-1">Facturation (lecture)</span>
          <span className="rounded-full bg-muted px-3 py-1">Journaux (lecture)</span>
          <span className="rounded-full bg-muted px-3 py-1">Projets (lecture)</span>
        </div>
        <Button
          className="gap-2 px-6"
          onClick={() => { window.location.href = "/api/gcp/auth" }}
        >
          <GoogleLogo size={16} />
          Se connecter avec Google
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section: Authenticated — status + project selector
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
    <Card className="relative overflow-hidden">
      <div className="absolute top-0 left-0 h-0.5 w-full bg-gradient-to-r from-green-500 to-transparent" />
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 border border-green-200">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            </div>
            <div>
              <CardTitle className="text-sm">Connecté</CardTitle>
              <CardDescription className="text-xs">{email}</CardDescription>
            </div>
          </div>
          <span className="text-xs rounded-full bg-green-100 text-green-700 border border-green-200 px-3 py-1 font-medium">
            Authentifié
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <label htmlFor="project-select" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Sélectionner un projet
          </label>
          {projectsLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <div className="relative">
              <select
                id="project-select"
                value={selectedProject}
                onChange={(e) => onSelectProject(e.target.value)}
                className="w-full appearance-none rounded-lg border border-border bg-background px-3 py-2.5 pr-9 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[oklch(0.48_0.24_264)]/40 transition-shadow"
              >
                <option value="">— Choisir un projet —</option>
                {projects?.map((p) => (
                  <option key={p.projectId} value={p.projectId}>
                    {p.name} ({p.projectId})
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section: Billing overview
// ---------------------------------------------------------------------------

function BillingSection({
  projectId,
}: {
  projectId: string
}) {
  const { data: billing, isLoading, error } = useGCPBilling(projectId, 6)
  const { mutate: ingest, isPending: ingesting, isSuccess: ingestSuccess, error: ingestError } = useIngestEvents()

  function handleImport() {
    if (!billing) return
    // Build BillingEvent[] from byService × byMonth cross-product (approximate)
    // For each month, distribute total proportionally by service share
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
      <Card>
        <CardHeader>
          <CardTitle>Aperçu facturation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-[200px]" />
        </CardContent>
      </Card>
    )
  }

  if (error || !billing) {
    return (
      <Card>
        <CardHeader><CardTitle>Aperçu facturation</CardTitle></CardHeader>
        <CardContent>
          <ErrorBanner message="Impossible de charger les données de facturation." />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="relative overflow-hidden">
      <div className="absolute top-0 left-0 h-0.5 w-full bg-gradient-to-r from-[oklch(0.48_0.24_264)] via-[oklch(0.60_0.18_195)] to-transparent" />
      <CardHeader>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <CardTitle>Aperçu facturation</CardTitle>
            <CardDescription>
              {billing.period.start} – {billing.period.end} · {billing.currency}
            </CardDescription>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold tabular-nums text-foreground">
              {billing.total.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {billing.currency}
            </p>
            <p className="text-xs text-muted-foreground">Dépense totale sur la période</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Monthly chart */}
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Coût mensuel</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={billing.byMonth} margin={{ left: -20, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="month"
                tickFormatter={(v: string) => v.slice(0, 7)}
                tick={{ fontSize: 10 }}
                tickLine={false}
              />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} unit=" €" width={60} />
              <Tooltip
                formatter={(v: unknown) => {
                  const x = v as number
                  return [`${x.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} ${billing.currency}`, "Coût"]
                }}
                labelFormatter={(l: string) => `Mois : ${l}`}
              />
              <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                {billing.byMonth.map((_: GCPBillingByMonth, i: number) => (
                  <Cell key={i} fill={SERVICE_COLORS[i % SERVICE_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top services table */}
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Top services</p>
          <div className="space-y-2">
            {billing.byService.slice(0, 8).map((svc: GCPBillingByService, i: number) => (
              <div key={svc.service} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="truncate max-w-[240px] text-muted-foreground">{svc.service}</span>
                  <div className="flex gap-3 tabular-nums shrink-0">
                    <span className="font-semibold text-foreground">
                      {svc.cost.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} {billing.currency}
                    </span>
                    <span className="text-muted-foreground w-10 text-right">{svc.pct.toFixed(1)}%</span>
                  </div>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${svc.pct}%`, backgroundColor: SERVICE_COLORS[i % SERVICE_COLORS.length] }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Import button */}
        <div className="border-t border-border pt-4 space-y-3">
          {ingestSuccess && (
            <SuccessBanner message="Données importées avec succès dans l'analyse FinOps." />
          )}
          {ingestError && (
            <ErrorBanner message="Erreur lors de l'import. Veuillez réessayer." />
          )}
          <Button
            onClick={handleImport}
            disabled={ingesting || ingestSuccess}
            className="w-full sm:w-auto"
          >
            {ingesting ? "Import en cours…" : ingestSuccess ? "Importé" : "Importer dans l'analyse"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section: Recent logs
// ---------------------------------------------------------------------------

const SEVERITY_FILTERS = ["ALL", "ERROR", "WARNING", "INFO"] as const
type SeverityFilter = typeof SEVERITY_FILTERS[number]

function LogsSection({ projectId }: { projectId: string }) {
  const [selectedSeverity, setSelectedSeverity] = useState<SeverityFilter>("ALL")
  const severity = selectedSeverity === "ALL" ? undefined : selectedSeverity
  const { data: logs, isLoading, error } = useGCPLogs(projectId, 50, severity)

  return (
    <Card className="relative overflow-hidden">
      <div className="absolute top-0 left-0 h-0.5 w-full bg-gradient-to-r from-[oklch(0.48_0.24_264)] via-[oklch(0.60_0.18_195)] to-transparent" />
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle>Journaux récents</CardTitle>
            <CardDescription>Derniers événements du projet</CardDescription>
          </div>
          {/* Severity filter buttons */}
          <div className="flex gap-1 flex-wrap">
            {SEVERITY_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setSelectedSeverity(s)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  selectedSeverity === s
                    ? "bg-[oklch(0.48_0.24_264)] text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : error ? (
          <ErrorBanner message="Impossible de charger les journaux." />
        ) : !logs || logs.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-6 text-sm text-muted-foreground justify-center">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Aucun log trouvé pour ce filtre</span>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
            {logs.map((entry: GCPLogEntry, i: number) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-xs"
              >
                <span
                  className={`shrink-0 mt-0.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${severityClass(entry.severity)}`}
                >
                  {entry.severity}
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span className="tabular-nums shrink-0">
                      {new Date(entry.timestamp).toLocaleString("fr-FR", {
                        dateStyle: "short",
                        timeStyle: "medium",
                      })}
                    </span>
                    <span className="truncate">·</span>
                    <span className="truncate text-foreground/60">{entry.resourceType}</span>
                  </div>
                  <p className="text-foreground/80 leading-snug break-words">
                    {entry.message.length > 120 ? entry.message.slice(0, 120) + "…" : entry.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section: Enabled services
// ---------------------------------------------------------------------------

function ServicesSection({ projectId }: { projectId: string }) {
  const { data: services, isLoading, error } = useGCPServices(projectId)

  // Group by category
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
    <Card className="relative overflow-hidden">
      <div className="absolute top-0 left-0 h-0.5 w-full bg-gradient-to-r from-[oklch(0.48_0.24_264)] via-[oklch(0.60_0.18_195)] to-transparent" />
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Services GCP activés</CardTitle>
            <CardDescription>APIs et services activés sur ce projet</CardDescription>
          </div>
          {!isLoading && services && (
            <span className="text-xs rounded-full bg-[oklch(0.48_0.24_264)]/10 text-[oklch(0.35_0.18_264)] border border-[oklch(0.48_0.24_264)]/20 px-3 py-1 font-medium">
              {enabledCount} activé{enabledCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : error ? (
          <ErrorBanner message="Impossible de charger la liste des services." />
        ) : !services || services.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-6 text-sm text-muted-foreground justify-center">
            <span>Aucun service trouvé</span>
          </div>
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
                      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs gap-2 ${
                        svc.enabled
                          ? "border-border bg-muted/30"
                          : "border-border/40 bg-muted/10 opacity-60"
                      }`}
                    >
                      <span className="truncate text-foreground/80 font-medium">{svc.name}</span>
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                          svc.enabled
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {svc.enabled ? "ON" : "OFF"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Banner reader (needs Suspense because useSearchParams requires it in Next 15)
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
  const [selectedProject, setSelectedProject] = useState("")

  const isAuthenticated = status?.authenticated === true
  const email = status?.email ?? ""

  return (
    <PageShell
      title="GCP Connect"
      description="Connexion directe à votre compte Google Cloud"
    >
      {/* Search params banners (Suspense required by Next.js 15) */}
      <Suspense fallback={null}>
        <SearchParamsBanners />
      </Suspense>

      {/* Section 1 — Connection status */}
      {statusLoading ? (
        <Skeleton className="h-40" />
      ) : !isAuthenticated ? (
        <ConnectCard />
      ) : (
        <>
          {/* Section 2 — Auth status + project selector */}
          <AuthStatusCard
            email={email}
            projects={projects}
            projectsLoading={projectsLoading}
            selectedProject={selectedProject}
            onSelectProject={setSelectedProject}
          />

          {/* Sections below only when a project is selected */}
          {selectedProject && (
            <>
              {/* Section 3 — Billing overview */}
              <BillingSection projectId={selectedProject} />

              {/* Section 4 — Recent logs */}
              <LogsSection projectId={selectedProject} />

              {/* Section 5 — Enabled services */}
              <ServicesSection projectId={selectedProject} />
            </>
          )}
        </>
      )}
    </PageShell>
  )
}
