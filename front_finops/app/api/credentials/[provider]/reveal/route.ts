import { proxyWithCookies } from "@/lib/server/backend-proxy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_PROVIDERS = new Set(["gcp", "aws"])

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params
  if (!ALLOWED_PROVIDERS.has(provider)) {
    return Response.json({ error: "Unknown provider" }, { status: 400 })
  }
  return proxyWithCookies(
    request,
    `/api/credentials/${encodeURIComponent(provider)}/reveal`,
    "POST",
  )
}
