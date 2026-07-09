import { proxyPost } from "@/lib/server/backend-proxy"

// POST /api/simulation/push — proxied to the backend with the server-side
// X-API-Key. The backend endpoint is guarded by require_api_key (mutating
// route), so the naïve /api/:path* rewrite in next.config.js is not enough in
// prod: it forwards the body but cannot add headers. This App Router handler
// takes precedence over that rewrite.
export async function POST(request: Request): Promise<Response> {
  return proxyPost(request, "/api/simulation/push")
}
