"use client"

import { useState } from "react"
import {
  AlertOctagon,
  ActivitySquare,
  BellRing,
  Ruler,
  CircleDashed,
  Layers,
  Sparkles,
  Info,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { isAllLocal } from "@/lib/hooks/usePortfolios"
import { PortfolioUnavailableState } from "../_components/PortfolioUnavailableState"
import type { AnalyseTabProps } from "../page"

import OutliersTab from "./_anomalies/OutliersTab"
import DriftTab from "./_anomalies/DriftTab"
import DistributionTab from "./_anomalies/DistributionTab"
import ScalingTab from "./_anomalies/ScalingTab"
import MissingTab from "./_anomalies/MissingTab"
import DimReductionTab from "./_anomalies/DimReductionTab"
import EnsembleTab from "./_anomalies/EnsembleTab"

// Sub-tab metadata is deliberately verbose:
//   * ``label``   — a plain-French verb-first phrasing an exec can parse at a glance.
//   * ``hint``    — one sentence describing what the tab surfaces (visible under the label).
//   * ``lead``    — the "how to read this" banner shown above the active panel.
//   * ``methods`` — the raw statistical arsenal, exposed via native ``title=``
//                   so specialists still see it on hover without cluttering the UI.
const SUB_TABS = [
  {
    id: "outliers",
    label: "Valeurs atypiques",
    icon: AlertOctagon,
    hint: "Journées dont la facture sort du comportement habituel",
    lead: "Chaque détecteur signale les jours de facturation qui s'écartent fortement du régime observé. À investiguer : pic ponctuel de trafic, incident de production, ou changement de dimensionnement mal calibré.",
    methods: "Z-score · Z modifié (MAD) · IQR/Tukey · Isolation Forest · LOF · Mahalanobis (MCD)",
  },
  {
    id: "drift",
    label: "Ruptures de tendance",
    icon: ActivitySquare,
    hint: "Le régime de dépense a changé, la série ne se comporte plus comme avant",
    lead: "Compare la période courante à une période de référence pour repérer un changement de comportement stable — pas un pic isolé, mais un basculement durable. Typique : mise en production d'un nouveau service, changement de tarif ou d'usage.",
    methods: "Kolmogorov-Smirnov · Population Stability Index (PSI) · Page-Hinkley (online)",
  },
  {
    id: "distribution",
    label: "Forme des dépenses",
    icon: BellRing,
    hint: "Comment les valeurs sont réparties : symétrie, poids des extrêmes, normalité",
    lead: "Décrit la géométrie de vos dépenses journalières : plutôt centrées, plutôt en queue lourde à droite, avec ou sans pic. Sert à choisir les bons seuils de vigilance et à préparer les transformations pour la prévision.",
    methods: "Skewness · Excess kurtosis · Box-Cox lambda · Jarque-Bera · Shapiro-Wilk",
  },
  {
    id: "scaling",
    label: "Échelles comparables",
    icon: Ruler,
    hint: "Rendre les services comparables entre eux, pas juste sur le montant absolu",
    lead: "Ramène chaque service sur une échelle commune pour comparer les dynamiques (croissance, saisonnalité) plutôt que les niveaux. Utile quand un gros service masque les tendances des plus petits.",
    methods: "Standard scaler (z) · MinMax scaler · Robust scaler (médiane / IQR)",
  },
  {
    id: "missing",
    label: "Données manquantes",
    icon: CircleDashed,
    hint: "Jours sans facturation par service — trou de collecte ou service inactif",
    lead: "Recense les jours sans donnée par service et diagnostique s'ils sont aléatoires ou concentrés. Un motif structurel signale un incident d'ingestion ou une pause volontaire du service — les deux affectent directement la fiabilité des prévisions.",
    methods: "MCAR (aléatoire) · MAR (conditionnel) · MNAR (structurel) · heuristique de bloc",
  },
  {
    id: "dim",
    label: "Structures cachées",
    icon: Layers,
    hint: "Regroupe les services qui varient ensemble (grappes de dépenses corrélées)",
    lead: "Projette l'ensemble des services dans un espace réduit pour faire ressortir les grappes qui coévoluent (par exemple Compute + Network qui montent ensemble). Aide à identifier les couplages sous-jacents et à concentrer l'effort d'optimisation.",
    methods: "PCA (variance expliquée, loadings) · t-SNE (structure locale)",
  },
  {
    id: "ensemble",
    label: "Prévision consolidée",
    icon: Sparkles,
    hint: "Combine plusieurs modèles pour obtenir une bande d'incertitude plus fiable",
    lead: "Agrège les prévisions de plusieurs modèles (bagging simple + stacking pondéré) et affiche la bande d'incertitude cross-modèle. Plus robuste qu'un modèle unique : les faiblesses des uns compensent celles des autres.",
    methods: "Bagging (moyenne) · Stacking (pondération inverse MAE) · décomposition biais-variance",
  },
] as const

type SubTabId = (typeof SUB_TABS)[number]["id"]

export function AnomaliesTab({ source, portfolio }: AnalyseTabProps) {
  // All-local portfolios have daily data — full anomaly stack works. The
  // unavailable state only fires when the portfolio actually mixes cloud
  // members that only expose monthly aggregates.
  if (source === "portefeuille" && portfolio && !isAllLocal(portfolio)) {
    return <PortfolioUnavailableState tabLabel="Détection d'anomalies" />
  }

  return <AnomaliesProjet />
}

function AnomaliesProjet() {
  const [tab, setTab] = useState<SubTabId>("outliers")
  const activeMeta = SUB_TABS.find((t) => t.id === tab) ?? SUB_TABS[0]

  return (
    <>
      <nav
        aria-label="Type de diagnostic d'anomalie"
        className="flex rounded-xl border border-border bg-card p-1 gap-1 overflow-x-auto shadow-sm scrollbar-hide"
      >
        {SUB_TABS.map(({ id, label, icon: Icon, hint, methods }) => {
          const active = tab === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={active}
              // ``title`` keeps the statistical arsenal accessible to specialists
              // (native tooltip on hover) without pushing jargon onto the UI.
              title={`${label} — méthodes : ${methods}`}
              className={cn(
                // ``basis-0 grow`` shares the available width evenly on desktop
                // while ``min-w`` keeps each tab readable when the row overflows
                // on narrow screens (horizontal scroll takes over).
                // No ``whitespace-nowrap`` here: it prevented the two-line
                // hint from wrapping, so the text bled onto neighbouring tabs.
                "group flex flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-sm font-medium transition-all basis-0 grow min-w-[170px] max-w-[240px]",
                active
                  ? "bg-brand text-brand-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span className="flex items-center gap-2 whitespace-nowrap w-full">
                <Icon
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    active ? "text-[color:var(--accent-green)]" : "text-muted-foreground",
                  )}
                  aria-hidden
                />
                <span className="truncate">{label}</span>
              </span>
              <span
                className={cn(
                  "text-[10.5px] font-medium leading-snug text-left line-clamp-2 normal-case tracking-normal",
                  active ? "text-white/70" : "text-muted-foreground/70",
                )}
              >
                {hint}
              </span>
            </button>
          )
        })}
      </nav>

      {/* "How to read this" banner — swaps with the active tab so the user
          always sees a plain-French intro before the technical panel. */}
      <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3.5 py-3">
        <Info
          className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--accent-green)]"
          aria-hidden
        />
        <div className="space-y-0.5 min-w-0">
          <p className="text-xs font-semibold text-foreground">
            {activeMeta.label} — comment lire cet onglet
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {activeMeta.lead}
          </p>
          <p className="text-[10.5px] text-muted-foreground/70 pt-1">
            Détails techniques : {activeMeta.methods}
          </p>
        </div>
      </div>

      <div key={tab}>
        {tab === "outliers"     && <OutliersTab />}
        {tab === "drift"        && <DriftTab />}
        {tab === "distribution" && <DistributionTab />}
        {tab === "scaling"      && <ScalingTab />}
        {tab === "missing"      && <MissingTab />}
        {tab === "dim"          && <DimReductionTab />}
        {tab === "ensemble"     && <EnsembleTab />}
      </div>
    </>
  )
}
