"use client"

import { useMemo, useState } from "react"
import { Cpu, Gauge, Layers } from "lucide-react"
import PageShell from "@/components/layout/PageShell"
import {
  SourceSelector,
  type DataSource,
} from "@/components/data-source/source-selector"
import { cn } from "@/lib/utils"
import {
  usePortfolios,
  LOCAL_MEMBER_ID,
  LOCAL_MEMBER_LABEL,
  type Portfolio,
} from "@/lib/hooks/usePortfolios"
import { ProjectsRoiAudit } from "./_components/ProjectsRoiAudit"
import { ArchitectureArbitrage } from "./_components/ArchitectureArbitrage"
import { GenAIModelAudit } from "./_components/GenAIModelAudit"

// Synthetic portfolio for the "Vue projet" source. Wraps the singleton events
// store so usePortfolioAggregate transparently routes to /api/events/billing —
// same trick as the local-only portfolio branch in the Analyse page.
const PROJET_PORTFOLIO_ID = "__projet-events__"
const PROJET_PORTFOLIO_NAME = "Fichiers importés"

function buildProjetPortfolio(): Portfolio {
  const now = new Date(0).toISOString()
  return {
    id: PROJET_PORTFOLIO_ID,
    name: PROJET_PORTFOLIO_NAME,
    members: [
      { provider: "local", id: LOCAL_MEMBER_ID, label: LOCAL_MEMBER_LABEL },
    ],
    createdAt: now,
    updatedAt: now,
  }
}

// One tab per audit lever. Same visual language as the Collecte source nav
// (icon + label + technical hint) so users switching pages don't relearn a
// second tab pattern.
const TABS = [
  {
    id: "projects",
    label: "Audit projets",
    icon: Gauge,
    hint: "Continuer · Ralentir · Stopper",
  },
  {
    id: "architecture",
    label: "Architecture",
    icon: Layers,
    hint: "EC2 · ECS · Lambda · RDS",
  },
  {
    id: "genai",
    label: "GenAI",
    icon: Cpu,
    hint: "Bedrock · Claude · Nova",
  },
] as const

type TabId = (typeof TABS)[number]["id"]

export default function OptimiserPage() {
  const { portfolios } = usePortfolios()

  const [tab, setTab] = useState<TabId>("projects")
  const [source, setSource] = useState<DataSource>("projet")
  const [portfolioId, setPortfolioId] = useState<string | null>(null)

  const projetPortfolio = useMemo(() => buildProjetPortfolio(), [])
  const effectivePortfolioId = portfolioId ?? portfolios[0]?.id ?? null
  const portfolio = useMemo<Portfolio | null>(() => {
    if (source === "projet") return projetPortfolio
    return portfolios.find((p) => p.id === effectivePortfolioId) ?? null
  }, [source, portfolios, effectivePortfolioId, projetPortfolio])

  const handleSourceChange = (s: DataSource) => {
    setSource(s)
    if (s === "projet") setPortfolioId(null)
  }

  // The source selector is meaningless for the GenAI audit (which drives a
  // simulator, not a portfolio scan). Hide it there so the header stays
  // focused on what actually applies.
  const showSourceSelector = tab !== "genai"

  return (
    <PageShell
      eyebrow="Diagnostic · Optimiser"
      title="Recommandations FinOps"
      description="Formulation de recommandations concrètes à partir de l'analyse et de la projection : projets à ralentir, arbitrages d'infrastructure, choix de modèles GenAI."
      actions={
        showSourceSelector ? (
          <SourceSelector
            source={source}
            onSourceChange={handleSourceChange}
            portfolios={portfolios}
            portfolioId={effectivePortfolioId}
            onPortfolioIdChange={setPortfolioId}
            variant="header"
            ariaLabel="Source de l'audit"
          />
        ) : null
      }
    >
      {/* Audit selector — visual clone of the Collecte source nav so the two
          pages share a consistent tab pattern. */}
      <nav
        aria-label="Type d'audit"
        className="inline-flex rounded-xl border border-border bg-card p-1 gap-1 flex-wrap shadow-sm"
      >
        {TABS.map(({ id, label, icon: Icon, hint }) => {
          const active = tab === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={active}
              className={cn(
                "group inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all",
                active
                  ? "bg-brand text-brand-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon
                className={cn(
                  "h-3.5 w-3.5",
                  active
                    ? "text-[color:var(--accent-green)]"
                    : "text-muted-foreground",
                )}
                aria-hidden
              />
              <span>{label}</span>
              <span
                className={cn(
                  "text-[10px] font-medium",
                  active ? "text-white/60" : "text-muted-foreground/60",
                )}
              >
                {hint}
              </span>
            </button>
          )
        })}
      </nav>

      {/* Mobile fallback for the source picker — PageShell hides ``actions``
          on the narrow top bar. Only shown for tabs that actually use it. */}
      {showSourceSelector && (
        <div className="lg:hidden">
          <SourceSelector
            source={source}
            onSourceChange={handleSourceChange}
            portfolios={portfolios}
            portfolioId={effectivePortfolioId}
            onPortfolioIdChange={setPortfolioId}
            variant="inline"
            ariaLabel="Source de l'audit"
          />
        </div>
      )}

      {/* Active audit body — remounts on tab change so intra-audit state
          (usage inputs, dropdowns) resets cleanly. */}
      <div key={tab}>
        {tab === "projects" && <ProjectsRoiAudit portfolio={portfolio} />}
        {tab === "architecture" && (
          <ArchitectureArbitrage portfolio={portfolio} />
        )}
        {tab === "genai" && <GenAIModelAudit />}
      </div>
    </PageShell>
  )
}
