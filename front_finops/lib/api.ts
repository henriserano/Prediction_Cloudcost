import axios from "axios"

// --------------------------------------------------------------------------
// Axios instance pointing at the FastAPI backend
// --------------------------------------------------------------------------

export const api = axios.create({
  baseURL: "",
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
})

// --------------------------------------------------------------------------
// snake_case → camelCase transformer (recursive)
// The Python API returns snake_case; TypeScript interfaces use camelCase.
// --------------------------------------------------------------------------

function toCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
}

// Fields whose VALUE is a Record where the keys are DATA (service names, GCP
// labels, model names, filenames…), not API field names. The field name itself
// is camelCased, but we must NOT recurse into the value: a service key like
// "cloud_sql" or a GCP label "compute_instance_id" would be corrupted.
// Exhaustive list of the Record<string, …> data dictionaries in lib/types.ts:
// - per_service_missing_pct → MissingResponse.perServiceMissingPct (keys = services)
// - labels                  → GCPLogEntry.labels                   (keys = GCP labels)
// - weights                 → EnsembleForecastResponse.weights     (keys = model names)
// - top_loadings            → PCAComponent.topLoadings             (keys = services)
// - per_file                → upload/preview responses .perFile    (keys = filenames)
const DATA_RECORD_FIELDS = new Set([
  "per_service_missing_pct",
  "labels",
  "weights",
  "top_loadings",
  "per_file",
])

function transformKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(transformKeys)
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        toCamel(k),
        DATA_RECORD_FIELDS.has(k) ? v : transformKeys(v),
      ])
    )
  }
  return obj
}

api.interceptors.response.use((response) => {
  response.data = transformKeys(response.data)
  return response
})
