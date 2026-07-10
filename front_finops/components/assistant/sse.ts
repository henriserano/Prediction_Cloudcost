import { nextId } from "./helpers"
import type { ChatMessage, SseEvent, SseParsed, ToolCall } from "./types"

// SSE frame parser — yields one event per "\n\n" boundary and returns the
// unconsumed tail so the caller can prepend the next chunk of bytes.
export function* parseSseChunks(buffer: string): Generator<SseEvent, string> {
  let idx: number
  let remaining = buffer
  while ((idx = remaining.indexOf("\n\n")) !== -1) {
    const raw = remaining.slice(0, idx)
    remaining = remaining.slice(idx + 2)
    let event = "message"
    const dataLines: string[] = []
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim()
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart())
    }
    if (dataLines.length > 0) yield { event, data: dataLines.join("\n") }
  }
  return remaining
}

// ---------------------------------------------------------------------------
// Pure reducers — one per event type. Keeps the stream loop testable and
// avoids the giant closure that used to live inside runStream.
// ---------------------------------------------------------------------------

export function applyTokenEvent(
  messages: ChatMessage[],
  msgId: string,
  parsed: SseParsed,
): ChatMessage[] {
  const text = (parsed.text as string) ?? ""
  if (!text) return messages
  return messages.map((m) => (m.id === msgId ? { ...m, content: m.content + text } : m))
}

export function applyToolStartEvent(
  messages: ChatMessage[],
  msgId: string,
  parsed: SseParsed,
): ChatMessage[] {
  const call: ToolCall = {
    id: (parsed.id as string) ?? nextId(),
    name: (parsed.name as string) ?? "?",
    arguments: (parsed.arguments as Record<string, unknown>) ?? {},
    status: "running",
  }
  return messages.map((m) =>
    m.id === msgId ? { ...m, toolCalls: [...(m.toolCalls ?? []), call] } : m,
  )
}

export function applyToolEndEvent(
  messages: ChatMessage[],
  msgId: string,
  parsed: SseParsed,
): ChatMessage[] {
  const id = parsed.id as string
  const preview = (parsed.result_preview as string) ?? ""
  return messages.map((m) =>
    m.id === msgId
      ? {
          ...m,
          toolCalls: (m.toolCalls ?? []).map((tc) =>
            tc.id === id ? { ...tc, status: "done", resultPreview: preview } : tc,
          ),
        }
      : m,
  )
}

export function applyDoneEvent(
  messages: ChatMessage[],
  msgId: string,
  parsed: SseParsed,
): ChatMessage[] {
  const tokens = parsed.total_tokens as number | null | undefined
  if (typeof tokens !== "number") return messages
  return messages.map((m) => (m.id === msgId ? { ...m, totalTokens: tokens } : m))
}

export function applyErrorEvent(
  messages: ChatMessage[],
  msgId: string,
  parsed: SseParsed,
): ChatMessage[] {
  const message = (parsed.message as string) ?? "Erreur inconnue"
  return messages.map((m) => (m.id === msgId ? { ...m, error: message } : m))
}
