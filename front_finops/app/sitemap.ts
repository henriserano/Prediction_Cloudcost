import type { MetadataRoute } from "next"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://finopsgcp.vercel.app"

const ROUTES = [
  { path: "/dashboard", priority: 1.0, changeFrequency: "daily" as const },
  { path: "/forecast", priority: 0.9, changeFrequency: "daily" as const },
  { path: "/services", priority: 0.8, changeFrequency: "daily" as const },
  { path: "/analytics", priority: 0.8, changeFrequency: "daily" as const },
  { path: "/diagnostics", priority: 0.85, changeFrequency: "daily" as const },
  { path: "/data-sources", priority: 0.7, changeFrequency: "weekly" as const },
  { path: "/gcp-connect", priority: 0.6, changeFrequency: "weekly" as const },
]

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return ROUTES.map(({ path, priority, changeFrequency }) => ({
    url: `${APP_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }))
}
