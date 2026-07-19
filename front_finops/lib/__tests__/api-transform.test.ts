/**
 * Contract tests for the snake_case → camelCase response transformer.
 *
 * CLAUDE.md documents this as the most fragile piece of the data layer: a
 * Record<string, …> field whose keys are DATA (service names, GCP labels,
 * model names, filenames) must NOT be recursed into, otherwise a key like
 * "cloud_sql" silently becomes "cloudSql" and every lookup in the UI misses.
 */
import { afterEach, describe, expect, it, vi } from "vitest"

import { DATA_RECORD_FIELDS, transformKeys } from "../api"

describe("transformKeys — camelisation", () => {
  it("camelises flat snake_case keys", () => {
    expect(
      transformKeys({ total_spend: 12.5, daily_avg: 3, period_start: "2026-01-01" }),
    ).toEqual({ totalSpend: 12.5, dailyAvg: 3, periodStart: "2026-01-01" })
  })

  it("camelises multi-word and digit-bearing keys like the forecast summary", () => {
    expect(
      transformKeys({
        horizon_days: 90,
        total_forecast: 100,
        daily_avg_forecast: 1.1,
        best_model_mae: null,
        cv_horizon: 28,
      }),
    ).toEqual({
      horizonDays: 90,
      totalForecast: 100,
      dailyAvgForecast: 1.1,
      bestModelMae: null,
      cvHorizon: 28,
    })
  })

  it("recurses into nested objects and arrays", () => {
    expect(
      transformKeys([
        { ph_stat: 1, change_detected: false },
        { ph_stat: 2, change_detected: true },
      ]),
    ).toEqual([
      { phStat: 1, changeDetected: false },
      { phStat: 2, changeDetected: true },
    ])

    expect(transformKeys({ normality_tests: [{ p_value: 0.2, is_normal: true }] })).toEqual({
      normalityTests: [{ pValue: 0.2, isNormal: true }],
    })
  })

  it("passes primitives and null through untouched", () => {
    expect(transformKeys(null)).toBeNull()
    expect(transformKeys(42)).toBe(42)
    expect(transformKeys("cloud_sql")).toBe("cloud_sql")
    expect(transformKeys([1, 2, 3])).toEqual([1, 2, 3])
  })
})

describe("transformKeys — data-record preservation", () => {
  it("camelises the field name but never the keys of a data record", () => {
    const input = {
      per_service_missing_pct: { "Cloud SQL": 0.1, cloud_run: 0.2, "BigQuery": 0 },
    }
    expect(transformKeys(input)).toEqual({
      perServiceMissingPct: { "Cloud SQL": 0.1, cloud_run: 0.2, "BigQuery": 0 },
    })
  })

  it("preserves model-name keys in ensemble weights", () => {
    const input = { weights: { "ARIMA(1,1,1)": 0.3, "Seasonal Naive": 0.2, snaive_x: 0.5 } }
    expect(transformKeys(input)).toEqual({
      weights: { "ARIMA(1,1,1)": 0.3, "Seasonal Naive": 0.2, snaive_x: 0.5 },
    })
  })

  it("preserves filename keys in per_file upload summaries", () => {
    const input = { per_file: { "export_gcp_2026-01.csv": 120, "facture finale.xlsx": 3 } }
    expect(transformKeys(input)).toEqual({
      perFile: { "export_gcp_2026-01.csv": 120, "facture finale.xlsx": 3 },
    })
  })

  it("covers every declared data-record field", () => {
    // If someone removes an entry from DATA_RECORD_FIELDS without migrating
    // the API, this catches the drift.
    expect([...DATA_RECORD_FIELDS].sort()).toEqual(
      ["labels", "per_file", "per_service_missing_pct", "top_loadings", "weights"].sort(),
    )
  })
})

describe("transformKeys — dev heuristic for untracked data records", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("warns when an untracked field looks like a data record", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    // Keys contain spaces/uppercase → data-style keys under an untracked field.
    transformKeys({ suspicious_field: { "Cloud SQL": 1, "Compute Engine": 2 } })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain("suspicious_field")
  })

  it("does not warn for tracked fields or ordinary API objects", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    transformKeys({ weights: { "Cloud SQL": 1 } })
    transformKeys({ summary: { total_spend: 1, daily_avg: 2 } })
    expect(warn).not.toHaveBeenCalled()
  })
})
