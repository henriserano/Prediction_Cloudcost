import { proxyPost } from "@/lib/server/backend-proxy"

// POST /api/events — proxied to the backend with the server-side X-API-Key.
// This App Router route takes precedence over the /api/:path* rewrite.
export async function POST(request: Request): Promise<Response> {
  return proxyPost(request, "/api/events")
}
