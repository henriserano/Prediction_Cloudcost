import Link from "next/link"
import { ArrowUpRight, Cpu, Lightbulb, PauseCircle, Sparkles } from "lucide-react"
import PageShell from "@/components/layout/PageShell"
import { SectionCard } from "@/components/ui/section-card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

// Step 5 of the FinOps journey. Live surface is a placeholder because the
// recommendation engine is not built yet. The three teasers describe what will
// ship — kept in sync with the sidebar hint "Recommandations".

const TEASERS = [
  {
    icon: Cpu,
    title: "Choix de modèles",
    description:
      "Comparaison automatique entre familles (STL·ARIMA, Prophet, N-HiTS…) pour trancher sur la précision attendue vs. le coût de calcul.",
  },
  {
    icon: PauseCircle,
    title: "Projets à ralentir ou à stopper",
    description:
      "Détection des workloads dont la trajectoire de coût dépasse la valeur métier, avec seuils déclenchant une alerte à l'engagement partner.",
  },
  {
    icon: Lightbulb,
    title: "Arbitrages d'architecture",
    description:
      "Suggestions de rightsizing, de commitments (Savings Plans, CUDs) et de migrations de service. Priorisées par gain net estimé.",
  },
] as const

export default function OptimiserPage() {
  return (
    <PageShell
      eyebrow="Étape 5 · Optimiser"
      title="Recommandations FinOps"
      description="Formulation de recommandations concrètes à partir de l'analyse et de la projection : modèles, projets, arbitrages d'infrastructure."
      actions={
        <Badge variant="warning">
          <Sparkles className="h-3 w-3" aria-hidden />
          Bientôt
        </Badge>
      }
    >
      <SectionCard
        title="Cette section arrive dans une prochaine itération"
        description="Elle s'appuiera sur l'analyse et la projection déjà en place — pas besoin de re-brancher vos données."
        accent="green"
        contentClassName="space-y-5"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {TEASERS.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="flex flex-col gap-2 rounded-xl border border-border bg-muted/20 p-4"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-card border border-border">
                <Icon className="h-4 w-4 text-[color:var(--accent-green)]" aria-hidden />
              </div>
              <p className="font-heading text-sm font-semibold text-foreground">
                {title}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Link href="/analyse">
            <Button variant="outline" className="gap-2">
              Continuer l&apos;analyse
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
          <Link href="/projection">
            <Button variant="outline" className="gap-2">
              Voir la projection
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </SectionCard>
    </PageShell>
  )
}
