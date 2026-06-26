"use client"

import { useQuery } from "@tanstack/react-query"
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
} from "@/lib/types"

// --------------------------------------------------------------------------
// Stale time — data doesn't change between deploys, 5 min cache is fine
// --------------------------------------------------------------------------
const STALE = 5 * 60 * 1000

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

export function useForecast(horizon = 60, model = "AutoETS") {
  return useQuery<ForecastPoint[]>({
    queryKey: ["forecast", horizon, model],
    queryFn: () =>
      api.get("/api/forecast", { params: { horizon, model } }).then((r) => r.data),
    staleTime: STALE,
  })
}

export function useForecastSummary(horizon = 60, model = "AutoETS") {
  return useQuery<ForecastSummary>({
    queryKey: ["forecast-summary", horizon, model],
    queryFn: () =>
      api.get("/api/forecast/summary", { params: { horizon, model } }).then((r) => r.data),
    staleTime: STALE,
  })
}

export function useModelBenchmarks() {
  return useQuery<ModelBenchmark[]>({
    queryKey: ["model-benchmarks"],
    queryFn: () => api.get("/api/forecast/models").then((r) => r.data),
    staleTime: STALE,
  })
}
