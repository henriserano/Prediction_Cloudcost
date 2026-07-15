// Rule-based ROI verdicts for a portfolio member: given its monthly cost and
// declared active-user volume, we bucket into Continuer / Ralentir / Stopper.
// Thresholds are deliberately expressed as constants so a workshop lead can
// override them per client without touching the component.

export type Verdict = "keep" | "slow" | "stop"

export interface VerdictThresholds {
  // A dormant project is "stopper" when it costs at least this much per month.
  dormantMinMonthlyCost: number
  // A project costing more than this per active user/month is "ralentir".
  expensivePerUser: number
  // A high absolute spend with very few users also triggers "ralentir".
  highSpendMonthly: number
  highSpendMaxUsers: number
  // Rough savings assumption when a project is "ralentir": right-sizing +
  // schedule optimisation typically frees this share of the current bill.
  slowSavingsShare: number
}

export const DEFAULT_THRESHOLDS: VerdictThresholds = {
  dormantMinMonthlyCost: 10,
  expensivePerUser: 50,
  highSpendMonthly: 500,
  highSpendMaxUsers: 10,
  slowSavingsShare: 0.3,
}

export interface VerdictInput {
  monthlyCost: number
  users: number | null
  thresholds?: VerdictThresholds
}

export interface VerdictResult {
  verdict: Verdict
  costPerUser: number | null
  potentialSavings: number
  reason: string
  next: string
}

export function classifyProject(input: VerdictInput): VerdictResult {
  const t = input.thresholds ?? DEFAULT_THRESHOLDS
  const { monthlyCost, users } = input

  const costPerUser =
    users != null && users > 0 ? monthlyCost / users : null

  // Dormant: no declared users and a non-negligible bill.
  if ((users == null || users === 0) && monthlyCost >= t.dormantMinMonthlyCost) {
    return {
      verdict: "stop",
      costPerUser: null,
      potentialSavings: monthlyCost,
      reason: "Aucun utilisateur déclaré alors que le projet continue de facturer.",
      next: "Décommissionner l'environnement ou l'archiver (snapshot puis stop).",
    }
  }

  // Expensive per-user: the ratio is out of band for the value delivered.
  if (costPerUser != null && costPerUser > t.expensivePerUser) {
    return {
      verdict: "slow",
      costPerUser,
      potentialSavings: monthlyCost * t.slowSavingsShare,
      reason: `Coût par utilisateur élevé (${costPerUser.toFixed(0)} €/user/mois).`,
      next: "Rightsizing, planification off-hours, revoir les choix d'architecture.",
    }
  }

  // Heavy absolute spend with tiny audience.
  if (
    monthlyCost >= t.highSpendMonthly &&
    users != null &&
    users > 0 &&
    users < t.highSpendMaxUsers
  ) {
    return {
      verdict: "slow",
      costPerUser,
      potentialSavings: monthlyCost * t.slowSavingsShare,
      reason: "Dépense mensuelle importante concentrée sur peu d'utilisateurs.",
      next: "Consolider avec un autre projet, revoir la volumétrie d'infra.",
    }
  }

  return {
    verdict: "keep",
    costPerUser,
    potentialSavings: 0,
    reason:
      users == null
        ? "Renseigner la volumétrie pour affiner le verdict."
        : "Coût aligné avec l'usage déclaré.",
    next: "Suivre la trajectoire de coût mensuelle sur l'onglet Projection.",
  }
}

export function memberKey(provider: string, id: string): string {
  return `${provider}::${id}`
}
