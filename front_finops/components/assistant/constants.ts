// SEC-028 (F-H2): the active thread id is scoped per-user in localStorage so
// a shared workstation doesn't hand user B's chat history to user A after a
// re-login. Anonymous callers get the fixed key below — they never reach
// authenticated conversation endpoints anyway. Consumers must call
// ``threadStorageKey(user?.userId)`` instead of using the raw constant.
export const THREAD_KEY_PREFIX = "sia-finops-chat-thread"

export function threadStorageKey(userId: string | null | undefined): string {
  return userId ? `${THREAD_KEY_PREFIX}:${userId}` : `${THREAD_KEY_PREFIX}:_anon`
}

/**
 * Wipe every stored chat-thread key. Called on logout so the next user
 * lands on a clean state even when they share the machine.
 */
export function clearAllStoredThreadKeys(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(THREAD_KEY_PREFIX)) keys.push(k)
    }
    for (const k of keys) localStorage.removeItem(k)
  } catch {
    /* localStorage unavailable — nothing to clean */
  }
}

export const STARTER_PROMPTS = [
  {
    label: "Résumé exécutif",
    prompt:
      "Fais un résumé exécutif de la situation FinOps actuelle : dépense totale, tendance, top services, anomalies et prévision à 30 jours.",
  },
  {
    label: "Meilleur modèle de prévision",
    prompt:
      "Quel modèle de prévision performe le mieux et pourquoi ? Compare les 6 modèles benchmarkés.",
  },
  {
    label: "Anomalies récentes",
    prompt: "Liste les anomalies détectées et estime leur impact financier.",
  },
  {
    label: "Analyse de drift",
    prompt:
      "Y a-t-il un drift de distribution entre la période de référence et la période actuelle ?",
  },
]

export const TOOL_LABELS: Record<string, string> = {
  get_kpi_snapshot: "KPI",
  get_data_status: "État données",
  get_daily_costs: "Coûts quotidiens",
  get_services_breakdown: "Services",
  get_anomalies: "Anomalies",
  get_descriptive_stats: "Stats",
  get_stationarity: "Stationnarité",
  get_stl_strengths: "STL",
  get_forecast_summary: "Prévision",
  get_model_benchmarks: "Benchmark",
  get_forecast_points: "Points prévision",
  get_drift_analysis: "Drift",
  get_outliers: "Outliers",
  get_missing_data: "Données manquantes",
  get_ensemble_forecast: "Ensemble",
}
