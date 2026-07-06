export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function backendBaseUrl(): string {
  return (
    process.env.BACKEND_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8080"
  )
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ threadId: string }> },
): Promise<Response> {
  const { threadId } = await params
  if (!threadId || !/^[a-zA-Z0-9_-]{1,128}$/.test(threadId)) {
    return Response.json({ error: "Invalid thread id" }, { status: 400 })
  }

  const headers: Record<string, string> = { accept: "application/json" }
  const apiKey = process.env.BACKEND_API_KEY
  if (apiKey) headers["x-api-key"] = apiKey

  try {
    const res = await fetch(
      `${backendBaseUrl()}/api/chat/${encodeURIComponent(threadId)}`,
      { method: "DELETE", headers, cache: "no-store" },
    )
    const data = await res.json().catch(() => ({}))
    return Response.json(data, { status: res.status })
  } catch (err) {
    return Response.json(
      {
        error: "Backend unreachable",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    )
  }
}
