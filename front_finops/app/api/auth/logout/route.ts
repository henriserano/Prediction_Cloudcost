import { proxyWithCookies } from "@/lib/server/backend-proxy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request): Promise<Response> {
  return proxyWithCookies(request, "/api/auth/logout", "POST")
}
