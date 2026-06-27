import type {
  DailyPoint,
  ServiceShare,
  AnomalyPoint,
  STLPoint,
  ForecastPoint,
  ModelBenchmark,
  KPIData,
  DescriptiveStats,
} from "./types"

function addDays(base: Date, n: number): string {
  const d = new Date(base)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

const START = new Date("2026-01-05")

const RAW_COSTS = [
  14.2, 16.8, 13.5, 18.3, 22.1, 15.7, 17.4, 19.2, 21.5, 16.3,
  18.7, 14.9, 20.1, 23.4, 17.8, 15.2, 19.6, 22.8, 16.5, 18.1,
  14.7, 21.3, 25.6, 17.2, 19.8, 16.4, 18.9, 22.3, 15.8, 20.7,
  17.5, 19.1, 23.7, 16.9, 21.4, 18.6, 15.3, 20.2, 24.1, 17.7,
  19.3, 16.1, 21.8, 25.2, 18.4, 20.5, 17.1, 22.6, 26.3, 19.7,
  21.9, 16.8, 23.1, 27.4, 20.3, 22.7, 18.2, 24.5, 28.9, 21.6,
  23.8, 17.9, 25.7, 29.2, 22.1, 24.6, 19.5, 26.8, 30.1, 23.4,
  25.9, 18.7, 27.3, 31.5, 24.2, 26.5, 20.8, 28.7, 32.6, 25.1,
  27.4, 19.6, 29.8, 33.2, 25.9, 28.3, 22.1, 30.6, 34.7, 26.8,
  13.5, 16.2, 14.8, 19.4, 23.7, 17.1, 20.3, 44.5, 22.6, 18.9,
  21.7, 25.4, 19.2, 22.8, 17.5, 24.1, 28.6, 20.7, 23.5, 18.3,
  25.8, 29.7, 21.4, 24.9, 19.1, 27.2, 31.3, 22.6, 26.1, 20.4,
  28.5, 32.8, 23.9, 27.4, 21.7, 29.8, 34.1, 25.2, 28.7, 22.9,
  31.2, 35.6, 26.5, 30.1, 24.3, 32.7, 37.2, 27.8, 31.4, 25.7,
  34.3, 39.1, 29.2, 33.8, 27.1, 36.5, 41.2, 30.7, 35.1, 28.4,
  37.8, 43.5, 32.1, 36.4, 29.9, 39.2, 45.1, 33.6, 37.9, 31.2,
  40.7, 46.8, 35.1, 39.3, 32.5, 42.3, 48.5, 36.7, 41.2, 33.8,
]

function computeMA7(costs: number[]): number[] {
  return costs.map((_, i) => {
    const slice = costs.slice(Math.max(0, i - 3), Math.min(costs.length, i + 4))
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
}

const ma7 = computeMA7(RAW_COSTS)
const n = RAW_COSTS.length
const mean = RAW_COSTS.reduce((a, b) => a + b, 0) / n
const std = Math.sqrt(RAW_COSTS.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1))
const tCrit = 1.96

export const DAILY_DATA: DailyPoint[] = RAW_COSTS.map((cost, i) => ({
  date: addDays(START, i),
  cost,
  ma7: Math.round(ma7[i] * 100) / 100,
  ciLow: Math.round((ma7[i] - tCrit * (std / Math.sqrt(7))) * 100) / 100,
  ciHigh: Math.round((ma7[i] + tCrit * (std / Math.sqrt(7))) * 100) / 100,
}))

export const SERVICE_SHARES: ServiceShare[] = [
  { service: "Cloud SQL", cost: 1124.8, pct: 33.1, cv: 4.2, cumPct: 33.1 },
  { service: "BigQuery", cost: 646.3, pct: 19.0, cv: 111.3, cumPct: 52.1 },
  { service: "Claude Sonnet 4.6", cost: 476.2, pct: 14.0, cv: 52.8, cumPct: 66.1 },
  { service: "Cloud Spanner", cost: 408.1, pct: 12.0, cv: 2.1, cumPct: 78.1 },
  { service: "Cloud Run", cost: 340.1, pct: 10.0, cv: 89.4, cumPct: 88.1 },
  { service: "Vertex AI", cost: 306.1, pct: 9.0, cv: 67.2, cumPct: 97.1 },
  { service: "Cloud Storage", cost: 68.0, pct: 2.0, cv: 18.5, cumPct: 99.1 },
  { service: "Autres", cost: 30.6, pct: 0.9, cv: 45.3, cumPct: 100 },
]

const anomalyDates = new Set(["2026-02-16", "2026-03-10", "2026-03-11", "2026-06-02"])

export const ANOMALY_DATA: AnomalyPoint[] = RAW_COSTS.map((cost, i) => {
  const date = addDays(START, i)
  const z = (cost - mean) / std
  return { date, cost, zscore: Math.round(z * 100) / 100, isAnomaly: anomalyDates.has(date) }
})

export const STL_DATA: STLPoint[] = RAW_COSTS.map((cost, i) => {
  const t = i / (n - 1)
  const trend = 13 + t * 22 + Math.sin(t * Math.PI * 2) * 2
  const seasonal = Math.sin((i / 7) * 2 * Math.PI) * 3.2 + Math.cos((i / 30) * 2 * Math.PI) * 1.1
  const residual = cost - trend - seasonal
  return {
    date: addDays(START, i),
    trend: Math.round(trend * 100) / 100,
    seasonal: Math.round(seasonal * 100) / 100,
    residual: Math.round(residual * 100) / 100,
  }
})

const FORECAST_START = new Date("2026-05-25")
const ACTUAL_ENDS_AT = 29

export const FORECAST_DATA: ForecastPoint[] = Array.from({ length: 60 }, (_, i) => {
  const base = 35 + (i / 60) * 8
  const noise = Math.sin(i * 1.3) * 2.1 + Math.cos(i * 0.7) * 1.4
  const forecast = base + noise
  const ci80 = 4.5 + i * 0.06
  const ci95 = 7.2 + i * 0.09
  const isActual = i < ACTUAL_ENDS_AT
  return {
    date: addDays(FORECAST_START, i),
    forecast: Math.round(forecast * 100) / 100,
    low80: Math.round((forecast - ci80) * 100) / 100,
    high80: Math.round((forecast + ci80) * 100) / 100,
    low95: Math.round((forecast - ci95) * 100) / 100,
    high95: Math.round((forecast + ci95) * 100) / 100,
    actual: isActual ? Math.round((forecast + Math.sin(i * 2.7) * 2.8) * 100) / 100 : undefined,
  }
})

export const MODEL_BENCHMARKS: ModelBenchmark[] = [
  { rank: 1, model: "AutoETS", family: "Exp. Smoothing", mae: 5.65, rmse: 8.03, mape: 23.9, r2: 0.0495, score: 2.0, winner: true },
  { rank: 2, model: "AutoTheta", family: "Theta method", mae: 5.66, rmse: 7.88, mape: 24.8, r2: 0.0849, score: 2.0, winner: false },
  { rank: 3, model: "Prophet", family: "Additif", mae: 5.75, rmse: 7.58, mape: 26.9, r2: 0.1523, score: 2.0, winner: false },
  { rank: 4, model: "TimesNet", family: "Deep Learning", mae: 6.46, rmse: 8.81, mape: 29.6, r2: -0.1453, score: 4.25, winner: false },
  { rank: 5, model: "AutoARIMA", family: "ARIMA", mae: 6.94, rmse: 9.20, mape: 27.8, r2: -0.2478, score: 4.75, winner: false },
  { rank: 6, model: "N-HiTS", family: "Deep Learning", mae: 8.08, rmse: 10.83, mape: 35.3, r2: -0.7304, score: 6.0, winner: false },
]

export const KPI_DATA: KPIData = {
  totalSpend: 3400.2,
  dailyAvg: 19.57,
  trendSlope: 0.0782,
  forecastNext30: 677,
  anomalyCount: 4,
  topService: "Cloud SQL",
  topServicePct: 33.1,
  dataPoints: 170,
  periodStart: "2026-01-05",
  periodEnd: "2026-06-23",
}

export const DESCRIPTIVE_STATS: DescriptiveStats = {
  mean: 19.57,
  median: 17.77,
  std: 9.83,
  cv: 50.2,
  skewness: 0.75,
  kurtosis: 3.3,
  iqr: 11.84,
  mad: 7.14,
  min: 13.5,
  max: 48.5,
}
