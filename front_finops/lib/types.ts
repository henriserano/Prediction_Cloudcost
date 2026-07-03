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

// ─── Advanced analysis (/api/analysis/*) ─────────────────────────────────────

export interface OutlierRow {
  date: string
  cost: number
  zscore: number
  modifiedZscore: number
  iqrFlag: boolean
  isolationScore: number
  isolationFlag: boolean
  lofScore: number
  lofFlag: boolean
}
export interface OutlierMethodSummary {
  method: string
  flaggedCount: number
  flaggedPct: number
  threshold: number | null
}
export interface MahalanobisPoint {
  date: string
  distance: number
  pValue: number
  isOutlier: boolean
}
export interface OutliersResponse {
  rows: OutlierRow[]
  summary: OutlierMethodSummary[]
  mahalanobis: MahalanobisPoint[]
}

export interface KSResult {
  statistic: number
  pValue: number
  driftDetected: boolean
  referencePeriod: string
  currentPeriod: string
  nRef: number
  nCur: number
}
export interface PSIBin {
  lower: number
  upper: number
  refPct: number
  curPct: number
  contribution: number
}
export interface PSIResult {
  psi: number
  verdict: "stable" | "moderate" | "significant"
  bins: PSIBin[]
}
export interface PageHinkleyPoint {
  date: string
  phStat: number
  changeDetected: boolean
}
export interface DriftResponse {
  ks: KSResult
  psi: PSIResult
  pageHinkley: PageHinkleyPoint[]
  nChangepointsDetected: number
}

export interface NormalityTest {
  name: string
  statistic: number
  pValue: number
  isNormal: boolean
}
export interface DistributionResponse {
  skewness: number
  kurtosis: number
  boxcoxLambda: number | null
  normalityTests: NormalityTest[]
  qqPoints: [number, number][]
}

export interface ScalingPoint {
  date: string
  standard: number
  minmax: number
  robust: number
}
export interface ScalingResponse {
  points: ScalingPoint[]
  stats: {
    standard: { mean: number; std: number }
    minmax:   { min: number;  max: number }
    robust:   { median: number; iqr: number }
  }
}

export interface MissingGap {
  start: string
  end: string
  days: number
}
export interface MissingResponse {
  calendarDaysExpected: number
  actualDays: number
  missingDays: number
  gaps: MissingGap[]
  perServiceMissingPct: Record<string, number>
  mechanismHint: string
}

export interface PCAComponent {
  component: number
  varianceRatio: number
  cumulativeRatio: number
  topLoadings: Record<string, number>
}
export interface TSNEPoint {
  service: string
  x: number
  y: number
}
export interface DimReductionResponse {
  nServices: number
  nDays: number
  totalVarianceExplained: number
  pcaComponents: PCAComponent[]
  tsne2d: TSNEPoint[]
}

export interface EnsemblePoint {
  date: string
  actual: number | null
  meanEnsemble: number
  weightedEnsemble: number
  lo80: number
  hi80: number
}
export interface BiasVarianceRow {
  model: string
  biasSquared: number
  variance: number
  totalError: number
}
export interface EnsembleForecastResponse {
  horizon: number
  baseModels: string[]
  weights: Record<string, number>
  points: EnsemblePoint[]
  biasVariance: BiasVarianceRow[]
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
