// ---------------------------------------------------------------------------
// Runtime validation gateway for backend responses.
//
// TypeScript's compile-time types cannot catch a backend that renames a field
// or ships a null where a number was promised. Wrapping the response through a
// zod schema turns "silent undefined at chart render" into a debuggable error
// at the network boundary, one query at a time.
//
// Coverage strategy: schemas ONLY exist for endpoints whose failure would
// break the primary dashboard (KPI, daily, services, forecast, benchmark).
// Add a schema when you (a) rename or add a field on the backend or (b) trace
// a bug to a shape mismatch. Do NOT add schemas for every response — the goal
// is defence at the frontier, not a second type system.
// ---------------------------------------------------------------------------
import { z } from "zod"

// ─── Primary dashboard payloads ─────────────────────────────────────────────

export const KPIDataSchema = z.object({
  totalSpend: z.number(),
  dailyAvg: z.number(),
  trendSlope: z.number(),
  forecastNext30: z.number(),
  anomalyCount: z.number(),
  topService: z.string(),
  topServicePct: z.number(),
  dataPoints: z.number(),
  periodStart: z.string(),
  periodEnd: z.string(),
})

export const DailyPointSchema = z.object({
  date: z.string(),
  cost: z.number(),
  ma7: z.number(),
  ciLow: z.number(),
  ciHigh: z.number(),
})
export const DailyResponseSchema = z.array(DailyPointSchema)

const ServiceCategoryEnum = z.enum([
  "compute",
  "database",
  "storage",
  "analytics",
  "ai_ml",
  "network",
  "security",
  "observability",
  "other",
])

export const ServiceShareSchema = z.object({
  service: z.string(),
  cost: z.number(),
  pct: z.number(),
  cv: z.number(),
  cumPct: z.number(),
  category: ServiceCategoryEnum,
})
export const ServicesResponseSchema = z.array(ServiceShareSchema)

export const ForecastPointSchema = z.object({
  date: z.string(),
  forecast: z.number(),
  low80: z.number(),
  high80: z.number(),
  low95: z.number(),
  high95: z.number(),
  actual: z.number().nullish(),
})
export const ForecastPointsResponseSchema = z.array(ForecastPointSchema)

export const ForecastSummarySchema = z.object({
  horizonDays: z.number(),
  totalForecast: z.number(),
  dailyAvgForecast: z.number(),
  bestModel: z.string(),
  bestModelMae: z.number().nullable(),
  bestModelMape: z.number().nullable(),
  modelsEvaluated: z.number(),
})

export const ModelBenchmarkSchema = z.object({
  rank: z.number(),
  model: z.string(),
  family: z.string(),
  mae: z.number().nullable(),
  rmse: z.number().nullable(),
  mape: z.number().nullable(),
  r2: z.number().nullable(),
  score: z.number().nullable(),
  winner: z.boolean(),
})
export const ModelBenchmarksResponseSchema = z.array(ModelBenchmarkSchema)

// ─── Parse helper ───────────────────────────────────────────────────────────

/**
 * Validate an API response against a Zod schema.
 *
 * - In development: throws a readable error naming the endpoint + the shape
 *   violation so the frontend fails loudly and early.
 * - In production: logs a single console.warn and returns the raw data cast to
 *   T. We deliberately do NOT throw in prod: a downstream chart crashing on
 *   bad data is more debuggable than a whole page falling over.
 */
export function parseApi<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
  endpoint: string,
): z.infer<S> {
  const result = schema.safeParse(data)
  if (result.success) return result.data
  const message = `[api] Response for ${endpoint} did not match its schema: ${result.error.message}`
  if (process.env.NODE_ENV !== "production") {
    throw new Error(message)
  }
  // eslint-disable-next-line no-console
  console.warn(message, { data })
  return data as z.infer<S>
}
