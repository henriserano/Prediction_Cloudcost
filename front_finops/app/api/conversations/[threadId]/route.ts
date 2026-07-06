import { proxyWithCookies } from "@/lib/server/backend-proxy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function validateThreadId(threadId: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(threadId)
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> },
): Promise<Response> {
  const { threadId } = await params
  if (!validateThreadId(threadId)) {
    return Response.json({ error: "Invalid thread id" }, { status: 400 })
  }
  return proxyWithCookies(
    request,
    `/api/conversations/${encodeURIComponent(threadId)}`,
    "GET",
  )
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> },
): Promise<Response> {
  const { threadId } = await params
  if (!validateThreadId(threadId)) {
    return Response.json({ error: "Invalid thread id" }, { status: 400 })
  }
  return proxyWithCookies(
    request,
    `/api/conversations/${encodeURIComponent(threadId)}`,
    "DELETE",
  )
}
