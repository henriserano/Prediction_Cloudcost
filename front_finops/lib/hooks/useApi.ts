"use client"

import { useQuery, useMutation } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type {
  DailyPoint,
  ServiceShare,
  AnomalyPoint,
  STLPoint,
  STLStrengths,
  ForecastPoint,
  ForecastSummary,
  ModelBenchmark,
  KPIData,
  DescriptiveStats,
  StationarityResult,
  ACFPoint,
  GCPAuthStatus,
  GCPProject,
  GCPBillingResponse,
  GCPLogEntry,
  GCPServiceInfo,
  GCPSyncResponse,
  EventsIngestRequest,
  EventsIngestResponse,
  EventsUploadResponse,
  HealthStatus,
  OutliersResponse,
  DriftResponse,
  DistributionResponse,
  ScalingResponse,
  MissingResponse,
  DimReductionResponse,
  EnsembleForecastResponse,
} from "@/lib/types"

// --------------------------------------------------------------------------
// Stale time — data doesn't change between deploys, 5 min cache is fine
// --------------------------------------------------------------------------
const STALE = 5 * 60 * 1000

// Backend liveness — proxied by the Next rewrite /health → backend /health.
// Short staleTime + periodic refetch so the header badge reflects reality.
export function useHealth() {
  return useQuery<HealthStatus>({
    queryKey: ["health"],
    queryFn: () => api.get("/health").then((r) => r.data),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  })
}

export function useKPI() {
  return useQuery<KPIData>({
    queryKey: ["kpi"],
    queryFn: () => api.get("/api/kpi").then((r) => r.data),
    staleTime: STALE,
  })
}

export function useDaily(lastN?: number) {
  return useQuery<DailyPoint[]>({
    queryKey: ["daily", lastN],
    queryFn: () =>
      api.get("/api/daily", { params: lastN ? { last_n: lastN } : {} }).then((r) => r.data),
    staleTime: STALE,
  })
}

export function useServices() {
  return useQuery<ServiceShare[]>({
    queryKey: ["services"],
    queryFn: () => api.get("/api/services").then((r) => r.data),
    staleTime: STALE,
  })
}

export function useAnomalies(zThreshold = 2.0) {
  return useQuery<AnomalyPoint[]>({
    queryKey: ["anomalies", zThreshold],
    queryFn: () =>
      api.get("/api/anomalies", { params: { z_threshold: zThreshold } }).then((r) => r.data),
    staleTime: STALE,
  })
}

export function useStats() {
  return useQuery<DescriptiveStats>({
    queryKey: ["stats"],
    queryFn: () => api.get("/api/stats").then((r) => r.data),
    staleTime: STALE,
  })
}

export function useStationarity() {
  return useQuery<StationarityResult>({
    queryKey: ["stationarity"],
    queryFn: () => api.get("/api/stationarity").then((r) => r.data),
    staleTime: STALE,
  })
}

export function useSTL() {
  return useQuery<STLPoint[]>({
    queryKey: ["stl"],
    queryFn: () => api.get("/api/stl").then((r) => r.data),
    staleTime: STALE,
  })
}

export function useSTLStrengths() {
  return useQuery<STLStrengths>({
    queryKey: ["stl-strengths"],
    queryFn: () => api.get("/api/stl/strengths").then((r) => r.data),
    staleTime: STALE,
  })
}

export function useACF(nlags = 28) {
  return useQuery<ACFPoint[]>({
    queryKey: ["acf", nlags],
    queryFn: () => api.get("/api/acf", { params: { nlags } }).then((r) => r.data),
    staleTime: STALE,
  })
}

export function useForecast(horizon = 60, model: string | null = "AutoETS") {
  return useQuery<ForecastPoint[]>({
    queryKey: ["forecast", horizon, model],
    queryFn: () =>
      api.get("/api/forecast", { params: { horizon, model } }).then((r) => r.data),
    staleTime: STALE,
    enabled: model != null,
  })
}

export function useForecastSummary(horizon = 60, model: string | null = "AutoETS") {
  return useQuery<ForecastSummary>({
    queryKey: ["forecast-summary", horizon, model],
    queryFn: () =>
      api.get("/api/forecast/summary", { params: { horizon, model } }).then((r) => r.data),
    staleTime: STALE,
    enabled: model != null,
  })
}

export function useModelBenchmarks() {
  return useQuery<ModelBenchmark[]>({
    queryKey: ["model-benchmarks"],
    queryFn: () => api.get("/api/forecast/models").then((r) => r.data),
    staleTime: STALE,
  })
}

// --------------------------------------------------------------------------
// GCP hooks
// --------------------------------------------------------------------------

export function useGCPStatus() {
  return useQuery<GCPAuthStatus>({
    queryKey: ["gcp-status"],
    queryFn: () => api.get("/api/gcp/status").then((r) => r.data),
    staleTime: 30_000,
  })
}

export function useGCPProjects() {
  const { data: status } = useGCPStatus()
  return useQuery<GCPProject[]>({
    queryKey: ["gcp-projects"],
    queryFn: () => api.get("/api/gcp/projects").then((r) => r.data),
    staleTime: STALE,
    enabled: status?.authenticated === true,
  })
}

export function useGCPBilling(projectId?: string, months = 6) {
  return useQuery<GCPBillingResponse>({
    queryKey: ["gcp-billing", projectId, months],
    queryFn: () =>
      api.get("/api/gcp/billing", { params: { project_id: projectId, months } }).then((r) => r.data),
    staleTime: STALE,
    enabled: !!projectId,
  })
}

export function useGCPLogs(projectId?: string, limit = 50, severity?: string) {
  return useQuery<GCPLogEntry[]>({
    queryKey: ["gcp-logs", projectId, limit, severity],
    queryFn: () =>
      api
        .get("/api/gcp/logs", {
          params: { project_id: projectId, limit, ...(severity ? { severity } : {}) },
        })
        .then((r) => r.data),
    staleTime: STALE,
    enabled: !!projectId,
  })
}

export function useGCPServices(projectId?: string) {
  return useQuery<GCPServiceInfo[]>({
    queryKey: ["gcp-services", projectId],
    queryFn: () =>
      api.get("/api/gcp/services", { params: { project_id: projectId } }).then((r) => r.data),
    staleTime: STALE,
    enabled: !!projectId,
  })
}

export function useIngestEvents() {
  return useMutation<EventsIngestResponse, Error, EventsIngestRequest>({
    mutationFn: (body: EventsIngestRequest) =>
      api.post("/api/events", body).then((r) => r.data),
  })
}

// Pulls the BigQuery Billing Export into the shared events store. On success,
// the whole dashboard (KPI, daily, services, forecast, analytics, diagnostics)
// must be invalidated so every page reflects the freshly ingested GCP data —
// the backend already clears app_cache + data.loader cache, but TanStack Query
// keeps its own client-side cache, hence the mandatory invalidateQueries() at
// the call site (same pattern as useAWSSync).
export function useGCPSync() {
  return useMutation<GCPSyncResponse, Error, { projectId: string; months?: number }>({
    mutationFn: ({ projectId, months = 6 }) =>
      api
        .post("/api/gcp/sync", null, { params: { project_id: projectId, months } })
        .then((r) => r.data),
  })
}

// Multipart upload of raw billing files (Excel notably — parsed backend-side
// via openpyxl so ALL rows are ingested, not just the preview sample).
export function useUploadEvents() {
  return useMutation<EventsUploadResponse, Error, { files: File[]; replace?: boolean }>({
    mutationFn: ({ files, replace = false }) => {
      const form = new FormData()
      files.forEach((f) => form.append("files", f))
      form.append("replace", String(replace))
      return api
        .post("/api/events/upload", form, {
          headers: { "Content-Type": "multipart/form-data" },
        })
        .then((r) => r.data)
    },
  })
}

// ─── Advanced diagnostics (/api/analysis/*) ─────────────────────────────────

export function useOutliers(zThreshold = 2.0, iqrMultiplier = 1.5) {
  return useQuery<OutliersResponse>({
    queryKey: ["outliers", zThreshold, iqrMultiplier],
    queryFn: () =>
      api
        .get("/api/analysis/outliers", {
          params: { z_threshold: zThreshold, iqr_multiplier: iqrMultiplier },
        })
        .then((r) => r.data),
    staleTime: STALE,
  })
}

export function useDrift(referenceFrac = 0.5, psiBins = 10) {
  return useQuery<DriftResponse>({
    queryKey: ["drift", referenceFrac, psiBins],
    queryFn: () =>
      api
        .get("/api/analysis/drift", {
          params: { reference_frac: referenceFrac, psi_bins: psiBins },
        })
        .then((r) => r.data),
    staleTime: STALE,
  })
}

export function useDistribution() {
  return useQuery<DistributionResponse>({
    queryKey: ["distribution"],
    queryFn: () => api.get("/api/analysis/distribution").then((r) => r.data),
    staleTime: STALE,
  })
}

export function useScaling() {
  return useQuery<ScalingResponse>({
    queryKey: ["scaling"],
    queryFn: () => api.get("/api/analysis/scaling").then((r) => r.data),
    staleTime: STALE,
  })
}

export function useMissing() {
  return useQuery<MissingResponse>({
    queryKey: ["missing"],
    queryFn: () => api.get("/api/analysis/missing").then((r) => r.data),
    staleTime: STALE,
  })
}

export function useDimReduction(nComponents = 5, runTsne = true) {
  return useQuery<DimReductionResponse>({
    queryKey: ["dim-reduction", nComponents, runTsne],
    queryFn: () =>
      api
        .get("/api/analysis/dim-reduction", {
          params: { n_components: nComponents, run_tsne: runTsne },
        })
        .then((r) => r.data),
    staleTime: STALE,
  })
}

export function useEnsembleForecast(horizon = 60) {
  return useQuery<EnsembleForecastResponse>({
    queryKey: ["ensemble-forecast", horizon],
    queryFn: () =>
      api
        .get("/api/analysis/ensemble-forecast", { params: { horizon } })
        .then((r) => r.data),
    staleTime: STALE,
  })
}
