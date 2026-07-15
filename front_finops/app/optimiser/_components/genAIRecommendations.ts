// Rule-based recommendations for the GenAI model-choice audit.
//
// The catalog itself is fetched from GET /api/simulation/reference (backend
// mirrors vendor rate cards). This module contains pure functions that turn a
// projected workload + a set of candidate models into concrete "consider this,
// avoid that" hints — nothing here calls a network. That way the workshop
// lead can tweak thresholds in one place and the UI stays testable.

export interface LLMEntry {
  id: string
  label: string
  vendor: string
  provider: string
  inputPerMillion: number
  outputPerMillion: number
  contextWindow: number
  notes?: string | null
}

export interface Volumetry {
  users: number
  requestsPerUserPerMonth: number
  avgInputTokensPerTurn: number
  avgOutputTokensPerTurn: number
}

export interface MonthlyProjection {
  model: LLMEntry
  monthlyCostUsd: number
  monthlyInputTokens: number
  monthlyOutputTokens: number
}

// Bedrock default configured in back/agent/graph.py. The catalog id drops the
// cross-region ``eu.`` prefix, so a normaliser lets us match transparently.
export const CURRENT_MODEL_ID = "claude-sonnet-4-6"

export function stripInferenceProfile(id: string): string {
  return id.replace(/^eu\./, "").replace(/^us\./, "").replace(/^apac\./, "")
}

export function projectCost(model: LLMEntry, v: Volumetry): MonthlyProjection {
  const totalRequests = v.users * v.requestsPerUserPerMonth
  const inputTokens = totalRequests * v.avgInputTokensPerTurn
  const outputTokens = totalRequests * v.avgOutputTokensPerTurn
  const monthlyCostUsd =
    (inputTokens * model.inputPerMillion + outputTokens * model.outputPerMillion) /
    1_000_000
  return {
    model,
    monthlyCostUsd,
    monthlyInputTokens: inputTokens,
    monthlyOutputTokens: outputTokens,
  }
}

export interface Recommendation {
  id: string
  severity: "info" | "opportunity" | "warning"
  title: string
  body: string
  potentialMonthlyUsd: number
}

// Given the current projection and the projections for every other model,
// surface the top actionable levers. Deterministic — a workshop lead can share
// screenshots knowing they'll be reproducible.
export function buildRecommendations(
  current: MonthlyProjection,
  others: MonthlyProjection[],
  v: Volumetry,
): Recommendation[] {
  const out: Recommendation[] = []
  const monthlyRequests = v.users * v.requestsPerUserPerMonth

  // Cheapest same-vendor alternative
  const sameVendor = others
    .filter((p) => p.model.vendor === current.model.vendor && p.model.id !== current.model.id)
    .sort((a, b) => a.monthlyCostUsd - b.monthlyCostUsd)[0]
  if (sameVendor && sameVendor.monthlyCostUsd < current.monthlyCostUsd * 0.7) {
    const gain = current.monthlyCostUsd - sameVendor.monthlyCostUsd
    out.push({
      id: "cheaper-same-vendor",
      severity: "opportunity",
      title: `Passer sur ${sameVendor.model.label} pour la volumétrie courante`,
      body: `Même famille (${sameVendor.model.vendor}) — coût projeté ${sameVendor.monthlyCostUsd.toFixed(
        0,
      )} $ contre ${current.monthlyCostUsd.toFixed(
        0,
      )} $ aujourd'hui. À valider sur un échantillon de conversations : la baisse en raisonnement multi-étape peut être sensible.`,
      potentialMonthlyUsd: gain,
    })
  }

  // Absolute cheapest option (any vendor)
  const cheapest = [...others, current].sort(
    (a, b) => a.monthlyCostUsd - b.monthlyCostUsd,
  )[0]
  if (
    cheapest &&
    cheapest.model.id !== current.model.id &&
    cheapest.monthlyCostUsd < current.monthlyCostUsd * 0.4
  ) {
    out.push({
      id: "cheapest-any-vendor",
      severity: "info",
      title: `Option low-cost : ${cheapest.model.label}`,
      body: `${cheapest.model.vendor} — division par ${(
        current.monthlyCostUsd / Math.max(cheapest.monthlyCostUsd, 1)
      ).toFixed(1)} du coût. Pertinent pour du routing, du classement ou de la génération courte. Bench nécessaire avant tout basculement.`,
      potentialMonthlyUsd: current.monthlyCostUsd - cheapest.monthlyCostUsd,
    })
  }

  // Prompt caching lever — matters when the prefix is repeated across turns.
  if (v.avgInputTokensPerTurn >= 2000 && monthlyRequests >= 5_000) {
    const cachedShare = 0.5 // conservative assumption on cacheable prefix
    const cachedInputTokens =
      monthlyRequests * v.avgInputTokensPerTurn * cachedShare
    const saving = (cachedInputTokens * current.model.inputPerMillion * 0.9) / 1_000_000
    out.push({
      id: "prompt-caching",
      severity: "opportunity",
      title: "Activer le prompt caching Bedrock",
      body: `À ${v.avgInputTokensPerTurn.toLocaleString(
        "fr-FR",
      )} tokens/entrée sur ${monthlyRequests.toLocaleString(
        "fr-FR",
      )} requêtes/mois, un préfixe stable (system prompt, catalogue d'outils, few-shots) réduit jusqu'à 90 % le coût des tokens cachés. Vérifiez que l'agent n'insère pas d'horodatage en tête.`,
      potentialMonthlyUsd: saving,
    })
  }

  // Reserved throughput / provisioned lever
  if (monthlyRequests >= 200_000) {
    out.push({
      id: "provisioned-throughput",
      severity: "info",
      title: "Envisager Provisioned Throughput / commit Bedrock",
      body: `Volume mensuel élevé (${monthlyRequests.toLocaleString(
        "fr-FR",
      )} requêtes). Un commit d'unités de modèle sur 1 mois lisse le coût unitaire de 20 à 40 %, au prix d'un engagement. Aligné avec un profil de trafic stable ou prévisible.`,
      potentialMonthlyUsd: current.monthlyCostUsd * 0.25,
    })
  }

  // Output-heavy warning
  if (v.avgOutputTokensPerTurn > v.avgInputTokensPerTurn * 1.5) {
    out.push({
      id: "output-heavy",
      severity: "warning",
      title: "Sortie plus lourde que l'entrée",
      body: `${v.avgOutputTokensPerTurn.toLocaleString(
        "fr-FR",
      )} tokens en sortie contre ${v.avgInputTokensPerTurn.toLocaleString(
        "fr-FR",
      )} en entrée : les tokens de sortie sont facturés 4 à 5x plus cher chez la plupart des vendeurs. Vérifiez que l'agent ne génère pas de préambules ou de réponses trop verbeuses.`,
      potentialMonthlyUsd: 0,
    })
  }

  // Sort: highest saving first, warnings last so they don't crowd the KPIs
  out.sort((a, b) => {
    if (a.severity === "warning" && b.severity !== "warning") return 1
    if (b.severity === "warning" && a.severity !== "warning") return -1
    return b.potentialMonthlyUsd - a.potentialMonthlyUsd
  })
  return out
}
