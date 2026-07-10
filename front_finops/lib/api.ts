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
//
// ⚠️  When adding a new endpoint that returns Record<string, X> whose keys are
// data (service names, labels, filenames, resource IDs, …), you MUST add the
// snake_case field name here — otherwise `useApi` lookups against those keys
// will silently miss because the transformer converted "cloud_sql" → "cloudSql".
// The `assertDataRecordCoverage` helper below runs a dev-time heuristic that
// warns when a suspicious untracked field slips through.
export const DATA_RECORD_FIELDS: ReadonlySet<string> = new Set([
  "per_service_missing_pct",
  "labels",
  "weights",
  "top_loadings",
  "per_file",
])

// Dev-only heuristic: a value that is a plain object whose keys contain
// characters we do not use in API field names (dots, hyphens, uppercase,
// spaces) is almost certainly a data-record and its parent key should be in
// DATA_RECORD_FIELDS. False positives are cheap (one console.warn); a false
// negative silently corrupts the UI.
const NON_FIELD_KEY_RE = /[.\-\s]|[A-Z]/
function looksLikeDataRecord(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const keys = Object.keys(value as Record<string, unknown>)
  if (keys.length === 0) return false
  // If ANY key contains a data-style character, treat the whole value as data.
  return keys.some((k) => NON_FIELD_KEY_RE.test(k))
}

function transformKeys(obj: unknown, parentKey?: string): unknown {
  if (Array.isArray(obj)) return obj.map((v) => transformKeys(v, parentKey))
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => {
        const preserve = DATA_RECORD_FIELDS.has(k)
        if (
          !preserve &&
          process.env.NODE_ENV !== "production" &&
          looksLikeDataRecord(v)
        ) {
          console.warn(
            `[api] Response field "${k}" looks like a data-record (its keys ` +
              `contain characters not used in API field names). If keys are ` +
              `data (service names, GCP labels, filenames…), add "${k}" to ` +
              `DATA_RECORD_FIELDS in lib/api.ts.`,
          )
        }
        return [toCamel(k), preserve ? v : transformKeys(v, k)]
      }),
    )
  }
  return obj
}

api.interceptors.response.use((response) => {
  response.data = transformKeys(response.data)
  return response
})
