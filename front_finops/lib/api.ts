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

function transformKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(transformKeys)
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        toCamel(k),
        transformKeys(v),
      ])
    )
  }
  return obj
}

api.interceptors.response.use((response) => {
  response.data = transformKeys(response.data)
  return response
})
