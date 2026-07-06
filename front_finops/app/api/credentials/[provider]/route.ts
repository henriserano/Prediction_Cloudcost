import { proxyWithCookies } from "@/lib/server/backend-proxy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_PROVIDERS = new Set(["gcp", "aws"])

async function guardProvider(
  params: Promise<{ provider: string }>,
): Promise<{ provider: string } | Response> {
  const { provider } = await params
  if (!ALLOWED_PROVIDERS.has(provider)) {
    return Response.json({ error: "Unknown provider" }, { status: 400 })
  }
  return { provider }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const guarded = await guardProvider(params)
  if (guarded instanceof Response) return guarded
  return proxyWithCookies(
    request,
    `/api/credentials/${encodeURIComponent(guarded.provider)}`,
    "PUT",
  )
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const guarded = await guardProvider(params)
  if (guarded instanceof Response) return guarded
  return proxyWithCookies(
    request,
    `/api/credentials/${encodeURIComponent(guarded.provider)}`,
    "DELETE",
  )
}
