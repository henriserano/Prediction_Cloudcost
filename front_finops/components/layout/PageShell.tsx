"use client"

import React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu, ChevronRight } from "lucide-react"
import { useSidebar } from "@/lib/context/sidebar-context"
import { Badge } from "@/components/ui/badge"

interface PageShellProps {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  eyebrow?: React.ReactNode
  showBreadcrumbs?: boolean
  children: React.ReactNode
}

const ROUTE_LABELS: Record<string, string> = {
  dashboard: "Vue d'ensemble",
  forecast: "Prévision",
  services: "Services",
  analytics: "Analytique",
  "data-sources": "Sources de données",
  "gcp-connect": "GCP Connect",
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
          className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground hover:bg-muted transition-colors focus-visible:ring-2 focus-visible:ring-[color:var(--accent-coral)]/40"
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
        <Badge variant="live" className="animate-pulse-slow">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-[color:var(--success)]"
          />
          Live
        </Badge>
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
              href="/dashboard"
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

        <div className="px-8 py-5 flex items-start justify-between gap-6">
          <div className="min-w-0">
            {eyebrow && (
              <div className="mb-1.5 flex items-center gap-2">
                {typeof eyebrow === "string" ? (
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-[color:var(--accent-coral)]">
                    {eyebrow}
                  </span>
                ) : (
                  eyebrow
                )}
              </div>
            )}
            <h1 className="font-heading text-[26px] font-semibold tracking-tight text-foreground leading-tight text-balance">
              {title}
            </h1>
            {description && (
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl text-pretty">
                {description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {actions}
            <Badge variant="live">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-[color:var(--success)] animate-pulse"
              />
              Live
            </Badge>
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className="flex-1 px-4 py-4 lg:px-8 lg:py-6 space-y-4 lg:space-y-5"
      >
        {children}
      </main>

      <footer className="hidden lg:flex items-center justify-between border-t border-border bg-card/50 px-8 py-3 text-[11px] text-muted-foreground">
        <span>© {new Date().getFullYear()} Sia · FinOps Analytics</span>
        <span className="tabular-nums">v1.0 · Sia Design System</span>
      </footer>
    </div>
  )
}
