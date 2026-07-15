import { proxyWithCookies } from "@/lib/server/backend-proxy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> },
): Promise<Response> {
  const { threadId } = await params
  if (!threadId || !/^[a-zA-Z0-9_-]{1,128}$/.test(threadId)) {
    return Response.json({ error: "Invalid thread id" }, { status: 400 })
  }

  // SEC-032: route through the shared helper so the ``sid`` session cookie is
  // forwarded to the backend for owner authorisation. Without it, the backend
  // authorised the delete by X-API-Key alone — every user with the frontend
  // API key could delete any thread whose id they could enumerate.
  return proxyWithCookies(
    request,
    `/api/chat/${encodeURIComponent(threadId)}`,
    "DELETE",
  )
}
