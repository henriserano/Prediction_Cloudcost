export interface DailyPoint {
  date: string
  cost: number
  ma7: number
  ciLow: number
  ciHigh: number
}

export interface ServiceShare {
  service: string
  cost: number
  pct: number
  cv: number
  cumPct: number
}

export interface AnomalyPoint {
  date: string
  cost: number
  zscore: number
  isAnomaly: boolean
}

export interface STLPoint {
  date: string
  trend: number
  seasonal: number
  residual: number
}

export interface ForecastPoint {
  date: string
  forecast: number
  low80: number
  high80: number
  low95: number
  high95: number
  actual?: number
}

export interface ModelBenchmark {
  rank: number
  model: string
  family: string
  mae: number
  rmse: number
  mape: number
  r2: number
  score: number
  winner: boolean
}

export interface KPIData {
  totalSpend: number
  dailyAvg: number
  trend: number
  forecastNext30: number
  anomalyCount: number
  topService: string
  topServicePct: number
  dataPoints: number
}

export interface DescriptiveStats {
  mean: number
  median: number
  std: number
  cv: number
  skewness: number
  kurtosis: number
  iqr: number
  mad: number
  min: number
  max: number
}
