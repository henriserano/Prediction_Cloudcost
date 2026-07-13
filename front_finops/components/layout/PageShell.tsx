"use client"

import React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu, ChevronRight } from "lucide-react"
import { useSidebar } from "@/lib/context/sidebar-context"
import { Badge } from "@/components/ui/badge"
import { useHealth } from "@/lib/hooks/useApi"
import { cn } from "@/lib/utils"

interface PageShellProps {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  eyebrow?: React.ReactNode
  showBreadcrumbs?: boolean
  children: React.ReactNode
}

const ROUTE_LABELS: Record<string, string> = {
  cadrage: "Estimation projet",
  collecte: "Collecte",
  portefeuille: "Portefeuille",
  analyse: "Analyse",
  projection: "Projection",
  optimiser: "Optimiser",
  assistant: "Assistant",
  "gcp-connect": "GCP Connect",
  // Legacy paths kept for the (rare) case a redirect chain briefly renders the
  // shell before Next.js resolves the target.
  dashboard: "Tableau de bord",
  forecast: "Projection",
  services: "Répartition",
  analytics: "Tendances",
  diagnostics: "Anomalies",
  "data-sources": "Collecte",
}

// Real backend status via GET /health (useHealth: staleTime 30 s, refetch 60 s).
// Green pulsing "Live" when the backend answers, grey/red "Hors ligne" on error.
function HealthBadge() {
  const { status } = useHealth()

  if (status === "error") {
    return (
      <Badge variant="muted">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-destructive" />
        Hors ligne
      </Badge>
    )
  }

  return (
    <Badge variant="live" className={cn(status === "pending" && "opacity-60")}>
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 rounded-full bg-[color:var(--success)]",
          status === "success" && "animate-pulse"
        )}
      />
      Live
    </Badge>
  )
}

function useCrumbs(): { href: string; label: string }[] {
  const path = usePathname()
  const segments = path.split("/").filter(Boolean)
  if (segments.length === 0) return []
  return segments.map((seg, i) => ({
    href: "/" + segments.slice(0, i + 1).join("/"),
    label: ROUTE_LABELS[seg] ?? seg,
  }))
}

export default function PageShell({
  title,
  description,
  actions,
  eyebrow,
  showBreadcrumbs = true,
  children,
}: PageShellProps) {
  const { toggle } = useSidebar()
  const crumbs = useCrumbs()

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-auto bg-background">
      {/* Mobile top bar */}
      <div className="lg:hidden sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/70 shrink-0">
        <button
          onClick={toggle}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground hover:bg-muted transition-colors focus-visible:ring-2 focus-visible:ring-[color:var(--accent-green)]/40"
          aria-label="Ouvrir la navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-bold text-foreground truncate leading-tight">
            {title}
          </h1>
          {description && (
            <p className="text-[11px] text-muted-foreground truncate leading-tight">
              {typeof description === "string" ? description : "—"}
            </p>
          )}
        </div>
        <HealthBadge />
      </div>

      {/* Desktop header */}
      <header
        className="hidden lg:block sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/70 shrink-0"
        role="banner"
      >
        {/* Breadcrumbs */}
        {showBreadcrumbs && crumbs.length > 0 && (
          <nav
            aria-label="Fil d'Ariane"
            className="px-8 pt-4 pb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <Link
              href="/analyse"
              className="hover:text-foreground transition-colors"
            >
              Sia FinOps
            </Link>
            {crumbs.map((c, i) => (
              <React.Fragment key={c.href}>
                <ChevronRight
                  className="h-3 w-3 text-muted-foreground/50 shrink-0"
                  aria-hidden
                />
                {i === crumbs.length - 1 ? (
                  <span className="font-medium text-foreground truncate">
                    {c.label}
                  </span>
                ) : (
                  <Link
                    href={c.href}
                    className="hover:text-foreground transition-colors truncate"
                  >
                    {c.label}
                  </Link>
                )}
              </React.Fragment>
            ))}
          </nav>
        )}

        <div className="relative px-8 py-6 flex items-start justify-between gap-6">
          {/* Subtle green wick — editorial "Sia" signature on every page header */}
          <span
            aria-hidden
            className="absolute left-8 top-6 h-8 w-0.5 rounded-full bg-[color:var(--accent-green)]"
          />
          <div className="min-w-0 pl-4">
            {eyebrow && (
              <div className="mb-2 flex items-center gap-2">
                {typeof eyebrow === "string" ? (
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-green)]">
                    {eyebrow}
                  </span>
                ) : (
                  eyebrow
                )}
              </div>
            )}
            <h1 className="font-heading text-[28px] font-semibold tracking-[-0.02em] text-foreground leading-[1.1] text-balance lg:text-[32px]">
              {title}
            </h1>
            {description && (
              <p className="text-sm text-muted-foreground mt-2 max-w-2xl text-pretty">
                {description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {actions}
            <HealthBadge />
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className="flex-1 px-4 py-4 lg:px-8 lg:py-6 space-y-4 lg:space-y-5"
      >
        {children}
      </main>
    </div>
  )
}
