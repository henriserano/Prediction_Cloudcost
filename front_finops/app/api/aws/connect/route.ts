import { proxyPost } from "@/lib/server/backend-proxy"

// POST /api/aws/connect — proxied to the backend with the server-side
// X-API-Key. Credentials pass through this server route and are never
// persisted by the frontend.
export async function POST(request: Request): Promise<Response> {
  return proxyPost(request, "/api/aws/connect")
}
