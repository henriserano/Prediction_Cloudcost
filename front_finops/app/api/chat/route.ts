export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function backendBaseUrl(): string {
  return (
    process.env.BACKEND_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8080"
  )
}

interface ChatStreamBody {
  message: string
  thread_id?: string
  system_prompt?: string
}

export async function POST(request: Request): Promise<Response> {
  let body: ChatStreamBody
  try {
    body = (await request.json()) as ChatStreamBody
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  if (typeof body.message !== "string" || body.message.trim().length === 0) {
    return Response.json(
      { error: "Field 'message' must be a non-empty string." },
      { status: 400 },
    )
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
  }
  const apiKey = process.env.BACKEND_API_KEY
  if (apiKey) headers["x-api-key"] = apiKey

  let upstream: Response
  try {
    upstream = await fetch(`${backendBaseUrl()}/api/chat/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: body.message,
        thread_id: body.thread_id,
        system_prompt: body.system_prompt,
      }),
      signal: request.signal,
      cache: "no-store",
    })
  } catch (err) {
    return Response.json(
      {
        error: "Backend unreachable",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    )
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "")
    // Backend AppError shape: { "error": { "code": "...", "message": "..." } }
    let message = `Backend ${upstream.status}`
    let code: string | undefined
    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: string; code?: string } | string
        detail?: string
      }
      if (typeof parsed.error === "object" && parsed.error?.message) {
        message = parsed.error.message
        code = parsed.error.code
      } else if (typeof parsed.error === "string") {
        message = parsed.error
      } else if (parsed.detail) {
        message = parsed.detail
      }
    } catch {
      /* upstream body was not JSON — keep the default message */
    }
    return Response.json(
      { error: message, code, detail: text.slice(0, 500) },
      { status: upstream.status || 502 },
    )
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  })
}
