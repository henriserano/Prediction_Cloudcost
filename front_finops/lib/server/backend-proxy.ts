// ---------------------------------------------------------------------------
// Server-side proxy helper for the mutating backend endpoints that require an
// X-API-Key header (POST /api/events, /api/events/upload, /api/aws/connect).
//
// Next.js rewrites cannot add headers, so these routes go through App Router
// Route Handlers (app/api/**/route.ts — filesystem routes take precedence
// over rewrites). The API key stays server-side: BACKEND_API_KEY has NO
// NEXT_PUBLIC prefix and is therefore never inlined in the client bundle.
// ---------------------------------------------------------------------------

// Same base URL resolution as the rewrites in next.config.js, with an
// optional server-only override (BACKEND_API_URL) if the internal URL ever
// differs from the public one.
function backendBaseUrl(): string {
  return (
    process.env.BACKEND_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8080"
  )
}

/**
 * Forward a POST request to the backend at `path`, preserving the query
 * string, the body (raw bytes — works for JSON as well as multipart, whose
 * original Content-Type carries the boundary), and the cookies. Adds
 * `X-API-Key` when BACKEND_API_KEY is configured; omits it otherwise (the
 * backend lets requests through in dev when no key is configured).
 */
export async function proxyPost(request: Request, path: string): Promise<Response> {
  const search = new URL(request.url).search
  const target = `${backendBaseUrl()}${path}${search}`

  const headers = new Headers()
  const contentType = request.headers.get("content-type")
  if (contentType) headers.set("content-type", contentType)
  const cookie = request.headers.get("cookie")
  if (cookie) headers.set("cookie", cookie)
  const apiKey = process.env.BACKEND_API_KEY
  if (apiKey) headers.set("x-api-key", apiKey)

  const body = await request.arrayBuffer()

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: "POST",
      headers,
      body: body.byteLength > 0 ? body : undefined,
      // Never cache mutations.
      cache: "no-store",
    })
  } catch {
    return Response.json(
      { detail: "Backend unreachable" },
      { status: 502 }
    )
  }

  // Relay status + body + content-type from the backend response.
  const responseHeaders = new Headers()
  const upstreamContentType = upstream.headers.get("content-type")
  if (upstreamContentType) responseHeaders.set("content-type", upstreamContentType)

  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  })
}

// ---------------------------------------------------------------------------
// Bidirectional proxy — same as proxyPost above but also relays Set-Cookie
// from the backend response. Used by /api/auth/* routes so the backend can
// issue the ``sid`` session cookie directly to the browser through Next.
// ---------------------------------------------------------------------------
export async function proxyWithCookies(
  request: Request,
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "POST",
): Promise<Response> {
  const search = new URL(request.url).search
  const target = `${backendBaseUrl()}${path}${search}`

  const headers = new Headers()
  const contentType = request.headers.get("content-type")
  if (contentType) headers.set("content-type", contentType)
  const cookie = request.headers.get("cookie")
  if (cookie) headers.set("cookie", cookie)
  const apiKey = process.env.BACKEND_API_KEY
  if (apiKey) headers.set("x-api-key", apiKey)

  const bodyBuf =
    method === "GET" || method === "DELETE"
      ? undefined
      : await request.arrayBuffer()

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body: bodyBuf && bodyBuf.byteLength > 0 ? bodyBuf : undefined,
      cache: "no-store",
    })
  } catch {
    return Response.json({ detail: "Backend unreachable" }, { status: 502 })
  }

  const responseHeaders = new Headers()
  const upstreamContentType = upstream.headers.get("content-type")
  if (upstreamContentType) responseHeaders.set("content-type", upstreamContentType)

  // Node's fetch merges multiple Set-Cookie into one comma-joined header; use
  // getSetCookie() (Undici) to get an array we can re-append individually.
  const upstreamAny = upstream.headers as unknown as {
    getSetCookie?: () => string[]
  }
  const cookies = upstreamAny.getSetCookie?.() ?? []
  for (const c of cookies) responseHeaders.append("set-cookie", c)

  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  })
}
