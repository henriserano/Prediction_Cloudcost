export interface DailyPoint {
  date: string
  cost: number
  ma7: number
  ciLow: number
  ciHigh: number
}

export type ServiceCategory =
  | "compute"
  | "database"
  | "storage"
  | "analytics"
  | "ai_ml"
  | "network"
  | "security"
  | "observability"
  | "other"

export interface ServiceShare {
  service: string
  cost: number
  pct: number
  cv: number
  cumPct: number
  category: ServiceCategory
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
  /** Horizon (jours) de la CV walk-forward ayant produit ces métriques. */
  cvHorizon?: number
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
  /** "stl_residual" (tests sur résidus STL, p-values valides) ou "raw". */
  basis?: string
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
// POST /api/gcp/sync — pulls BigQuery Billing Export into the events store
export interface GCPSyncResponse { projectId: string; ingestedRows: number; period: { start: string; end: string }; totalCost: number; currency: string; source: string; servicesSeen: number }
export interface GCPLogEntry { timestamp: string; severity: string; resourceType: string; service: string; message: string; labels: Record<string, string> }
export interface GCPServiceInfo { serviceId: string; name: string; enabled: boolean; category: string }
export interface BillingEvent { date: string; service: string; cost: number; description?: string }
export interface EventsIngestRequest { events: BillingEvent[]; replace?: boolean }
export interface EventsIngestResponse { ingested: number; totalRows: number; dateRange: { start: string; end: string }; previewKpi: { totalSpend: number; dailyAvg: number } }
// POST /api/events/upload (multipart) — MultiFileUploadResponse backend-side
export interface EventsUploadResponse { filesProcessed: number; ingested: number; totalRows: number; dateRange: { start: string; end: string }; previewKpi: { totalSpend: number; dailyAvg: number }; perFile: Record<string, number>; warnings: string[] }
// GET /health — backend liveness (also returns cache/data fingerprints, ignored here)
export interface HealthStatus { status: string }

// ─── Azure Cost Management ─────────────────────────────────────────────────
// Mirror of back/schemas/azure.py — keep the two in sync (CLAUDE.md).

export interface AzureAuthStatus {
  authenticated: boolean
  tenantId?: string | null
  subscriptionId?: string | null
  displayName?: string | null
  location?: string | null
  detail?: string | null
}

export interface AzureSubscription {
  subscriptionId: string
  name: string
  state?: string | null
  tenantId?: string | null
}

export interface AzureBillingByService {
  service: string
  cost: number
  pct: number
  category: string
}

export interface AzureBillingByMonth {
  month: string
  cost: number
}

export interface AzureBillingByDay {
  date: string
  cost: number
}

export interface AzureBillingResponse {
  subscriptionId: string | null
  period: { start: string; end: string }
  total: number
  byService: AzureBillingByService[]
  byMonth: AzureBillingByMonth[]
  byDay: AzureBillingByDay[]
  currency: string
  source: string
  granularity: string
}

// POST /api/azure/sync — Cost Management → events store
export interface AzureSyncRequest {
  subscriptionId?: string | null
  months?: number
  replace?: boolean
}

export interface AzureSyncResponse {
  ingested: number
  subscriptionId: string | null
  periodStart: string
  periodEnd: string
  servicesCount: number
  totalCost: number
  currency: string
  replaced: boolean
}
