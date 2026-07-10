export const THREAD_KEY = "sia-finops-chat-thread"

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
