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

export interface STLStrengths {
  ft: number
  fs: number
  period: number
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

export interface ForecastSummary {
  horizonDays: number
  totalForecast: number
  dailyAvgForecast: number
  bestModel: string
  bestModelMae: number
  bestModelMape: number
  modelsEvaluated: number
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
  trendSlope: number
  forecastNext30: number
  anomalyCount: number
  topService: string
  topServicePct: number
  dataPoints: number
  periodStart: string
  periodEnd: string
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

export interface StationarityTest {
  statistic: number
  pValue: number
  isStationary: boolean
  lagsUsed: number
}

export interface StationarityResult {
  adf: StationarityTest
  kpss: StationarityTest
}

export interface ACFPoint {
  lag: number
  acf: number
  pacf: number
}

// GCP Connect types
export interface GCPAuthStatus { authenticated: boolean; email: string | null; projectId: string | null }
export interface GCPProject { projectId: string; name: string; projectNumber: string }
export interface GCPBillingByService { service: string; cost: number; pct: number }
export interface GCPBillingByMonth { month: string; cost: number }
export interface GCPBillingResponse { projectId: string; period: { start: string; end: string }; total: number; byService: GCPBillingByService[]; byMonth: GCPBillingByMonth[]; currency: string }
export interface GCPLogEntry { timestamp: string; severity: string; resourceType: string; service: string; message: string; labels: Record<string, string> }
export interface GCPServiceInfo { serviceId: string; name: string; enabled: boolean; category: string }
export interface BillingEvent { date: string; service: string; cost: number; description?: string }
export interface EventsIngestRequest { events: BillingEvent[]; replace?: boolean }
export interface EventsIngestResponse { ingested: number; totalRows: number; dateRange: { start: string; end: string }; previewKpi: { totalSpend: number; dailyAvg: number } }
