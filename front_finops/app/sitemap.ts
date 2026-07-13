import type { MetadataRoute } from "next"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://finopsgcp.vercel.app"

const ROUTES = [
  { path: "/cadrage", priority: 0.85, changeFrequency: "weekly" as const },
  { path: "/collecte", priority: 0.7, changeFrequency: "weekly" as const },
  { path: "/analyse", priority: 1.0, changeFrequency: "daily" as const },
  { path: "/projection", priority: 0.9, changeFrequency: "daily" as const },
  { path: "/optimiser", priority: 0.6, changeFrequency: "weekly" as const },
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
