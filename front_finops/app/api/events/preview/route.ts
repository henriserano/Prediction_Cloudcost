import { proxyPost } from "@/lib/server/backend-proxy"

// POST /api/events/preview — the backend guards this dry-run endpoint with
// X-API-Key too (it parses uploaded files), so it must go through the
// server-side proxy instead of the plain rewrite.
export async function POST(request: Request): Promise<Response> {
  return proxyPost(request, "/api/events/preview")
}
