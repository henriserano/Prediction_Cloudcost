import { proxyPost } from "@/lib/server/backend-proxy"

// POST /api/events/upload — multipart proxy to the backend with the
// server-side X-API-Key. The raw body is forwarded untouched together with
// the original Content-Type (which carries the multipart boundary).
export async function POST(request: Request): Promise<Response> {
  return proxyPost(request, "/api/events/upload")
}
