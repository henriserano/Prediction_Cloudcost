// PERF-005: Bundle analyzer — run `npm run analyze` (or `ANALYZE=true npm run
// build`) to produce a client + server treemap under .next/analyze/. Wrapped
// as a no-op when ANALYZE is unset so normal builds pay zero cost. Used to
// audit heavy deps (recharts, react-markdown, @anthropic-ai/sdk) before code-
// splitting decisions.
import bundleAnalyzer from "@next/bundle-analyzer"

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    const isProduction = process.env.NODE_ENV === "production"
    const securityHeaders = [
      {
        key: "X-Frame-Options",
        value: "DENY",
      },
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        key: "X-XSS-Protection",
        value: "1; mode=block",
      },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
    ]
    if (isProduction) {
      // 63072000 = 2 years — matches back/main.py and meets HSTS-preload eligibility threshold.
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains",
      })
    }
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ]
  },
  async rewrites() {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL
    if (!backendUrl && process.env.NODE_ENV === "production") {
      throw new Error("NEXT_PUBLIC_API_URL must be set in production")
    }
    const resolvedBackendUrl = backendUrl || "http://localhost:8080"
    return [
      {
        source: "/api/:path*",
        destination: `${resolvedBackendUrl}/api/:path*`,
      },
      {
        // Backend liveness endpoint (root-level, outside /api) — used by the
        // useHealth() hook to drive the Live/Hors ligne badge in PageShell.
        source: "/health",
        destination: `${resolvedBackendUrl}/health`,
      },
    ]
  },
}

export default withBundleAnalyzer(nextConfig)
