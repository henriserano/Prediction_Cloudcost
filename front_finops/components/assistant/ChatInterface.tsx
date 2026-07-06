"use client"

import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  AlertCircle,
  Check,
  Copy,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Trash2,
  User,
  Wrench,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  resultPreview?: string
  status: "running" | "done"
}

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  toolCalls?: ToolCall[]
  error?: string
  totalTokens?: number
}

const THREAD_KEY = "sia-finops-chat-thread"
const MESSAGES_KEY = "sia-finops-chat-messages"

const STARTER_PROMPTS = [
  {
    label: "Résumé exécutif",
    prompt:
      "Fais un résumé exécutif de la situation FinOps actuelle : dépense totale, tendance, top services, anomalies et prévision à 30 jours.",
  },
  {
    label: "Meilleur modèle de prévision",
    prompt:
      "Quel modèle de prévision performe le mieux et pourquoi ? Compare les 6 modèles benchmarkés.",
  },
  {
    label: "Anomalies récentes",
    prompt: "Liste les anomalies détectées et estime leur impact financier.",
  },
  {
    label: "Analyse de drift",
    prompt:
      "Y a-t-il un drift de distribution entre la période de référence et la période actuelle ?",
  },
]

const TOOL_LABELS: Record<string, string> = {
  get_kpi_snapshot: "KPI",
  get_data_status: "État données",
  get_daily_costs: "Coûts quotidiens",
  get_services_breakdown: "Services",
  get_anomalies: "Anomalies",
  get_descriptive_stats: "Stats",
  get_stationarity: "Stationnarité",
  get_stl_strengths: "STL",
  get_forecast_summary: "Prévision",
  get_model_benchmarks: "Benchmark",
  get_forecast_points: "Points prévision",
  get_drift_analysis: "Drift",
  get_outliers: "Outliers",
  get_missing_data: "Données manquantes",
  get_ensemble_forecast: "Ensemble",
}

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

interface SseEvent {
  event: string
  data: string
}

function* parseSseChunks(buffer: string): Generator<SseEvent, string> {
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

export function ChatInterface() {
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState("")
  const [streaming, setStreaming] = React.useState(false)
  const [threadId, setThreadId] = React.useState<string | null>(null)
  const [hydrated, setHydrated] = React.useState(false)

  const abortRef = React.useRef<AbortController | null>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const stickToBottomRef = React.useRef(true)

  // Restore thread + history from localStorage on mount.
  React.useEffect(() => {
    try {
      const t = localStorage.getItem(THREAD_KEY)
      if (t) setThreadId(t)
      const raw = localStorage.getItem(MESSAGES_KEY)
      if (raw) setMessages(JSON.parse(raw) as ChatMessage[])
    } catch {
      /* ignore corrupted storage */
    }
    setHydrated(true)
  }, [])

  // Persist messages (skip while streaming; final flush happens on stream end).
  React.useEffect(() => {
    if (!hydrated || streaming) return
    try {
      localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages))
    } catch {
      /* quota exceeded — best effort */
    }
  }, [messages, streaming, hydrated])

  React.useEffect(() => {
    if (!hydrated) return
    try {
      if (threadId) localStorage.setItem(THREAD_KEY, threadId)
      else localStorage.removeItem(THREAD_KEY)
    } catch {
      /* ignore */
    }
  }, [threadId, hydrated])

  // Auto-scroll unless the user scrolled up manually.
  const onScrollAreaScroll = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distance < 80
  }, [])

  React.useEffect(() => {
    if (!stickToBottomRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streaming])

  const runStream = React.useCallback(
    async (userText: string, currentThreadId: string | null) => {
      const assistantId = nextId()
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          toolCalls: [],
        },
      ])
      setStreaming(true)

      const ac = new AbortController()
      abortRef.current = ac

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: userText,
            thread_id: currentThreadId ?? undefined,
          }),
          signal: ac.signal,
        })

        if (!res.ok || !res.body) {
          const errPayload = await res.json().catch(() => ({}))
          const detail =
            (errPayload as { error?: string; detail?: string }).error ??
            (errPayload as { detail?: string }).detail ??
            `Erreur ${res.status}`
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, error: String(detail) } : m,
            ),
          )
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const iter = parseSseChunks(buffer)
          let step = iter.next()
          while (!step.done) {
            const { event, data } = step.value
            handleEvent(event, data, assistantId)
            step = iter.next()
          }
          buffer = step.value
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId && !m.content
                ? { ...m, content: "_(interrompu)_" }
                : m,
            ),
          )
        } else {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    error:
                      err instanceof Error
                        ? err.message
                        : "Impossible de contacter le service.",
                  }
                : m,
            ),
          )
        }
      } finally {
        setStreaming(false)
        abortRef.current = null
        textareaRef.current?.focus()
      }

      function handleEvent(event: string, data: string, msgId: string) {
        let parsed: Record<string, unknown> = {}
        try {
          parsed = JSON.parse(data)
        } catch {
          return
        }

        if (event === "ready") {
          const tid = parsed.thread_id as string | undefined
          if (tid) setThreadId(tid)
          return
        }
        if (event === "token") {
          const text = (parsed.text as string) ?? ""
          if (!text) return
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId ? { ...m, content: m.content + text } : m,
            ),
          )
          return
        }
        if (event === "tool_start") {
          const call: ToolCall = {
            id: (parsed.id as string) ?? nextId(),
            name: (parsed.name as string) ?? "?",
            arguments: (parsed.arguments as Record<string, unknown>) ?? {},
            status: "running",
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId
                ? { ...m, toolCalls: [...(m.toolCalls ?? []), call] }
                : m,
            ),
          )
          return
        }
        if (event === "tool_end") {
          const id = parsed.id as string
          const preview = (parsed.result_preview as string) ?? ""
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId
                ? {
                    ...m,
                    toolCalls: (m.toolCalls ?? []).map((tc) =>
                      tc.id === id
                        ? { ...tc, status: "done", resultPreview: preview }
                        : tc,
                    ),
                  }
                : m,
            ),
          )
          return
        }
        if (event === "done") {
          const tokens = parsed.total_tokens as number | null | undefined
          if (typeof tokens === "number") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId ? { ...m, totalTokens: tokens } : m,
              ),
            )
          }
          return
        }
        if (event === "error") {
          const message = (parsed.message as string) ?? "Erreur inconnue"
          setMessages((prev) =>
            prev.map((m) => (m.id === msgId ? { ...m, error: message } : m)),
          )
        }
      }
    },
    [],
  )

  const send = React.useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || streaming) return

      const userMsg: ChatMessage = {
        id: nextId(),
        role: "user",
        content: trimmed,
      }
      setMessages((prev) => [...prev, userMsg])
      setInput("")
      stickToBottomRef.current = true
      await runStream(trimmed, threadId)
    },
    [streaming, threadId, runStream],
  )

  const stop = React.useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const regenerate = React.useCallback(async () => {
    if (streaming) return
    // Find the last user message and drop the assistant reply that followed it.
    let lastUserIdx = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserIdx = i
        break
      }
    }
    if (lastUserIdx === -1) return
    const userText = messages[lastUserIdx].content
    setMessages((prev) => prev.slice(0, lastUserIdx + 1))
    stickToBottomRef.current = true
    await runStream(userText, threadId)
  }, [messages, streaming, threadId, runStream])

  const resetConversation = React.useCallback(async () => {
    if (streaming) abortRef.current?.abort()
    const tid = threadId
    setMessages([])
    setThreadId(null)
    try {
      localStorage.removeItem(MESSAGES_KEY)
      localStorage.removeItem(THREAD_KEY)
    } catch {
      /* ignore */
    }
    if (tid) {
      // Best-effort backend cleanup; do not block UI on failure.
      fetch(`/api/chat/${encodeURIComponent(tid)}`, { method: "DELETE" }).catch(
        () => undefined,
      )
    }
  }, [threadId, streaming])

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    void send(input)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void send(input)
    }
  }

  const empty = messages.length === 0
  const canRegenerate =
    !streaming &&
    messages.length >= 1 &&
    messages.some((m) => m.role === "user")

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[520px] flex-col rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-2 lg:px-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              streaming ? "animate-pulse bg-[color:var(--accent-coral)]" : "bg-emerald-500",
            )}
          />
          <span>
            {streaming
              ? "Génération en cours"
              : threadId
                ? `Conversation active`
                : "Nouvelle conversation"}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void resetConversation()}
          disabled={empty && !threadId}
          className="text-xs"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Réinitialiser</span>
        </Button>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScrollAreaScroll}
        className="flex-1 overflow-y-auto px-4 py-5 lg:px-6"
        aria-live="polite"
        aria-atomic="false"
      >
        {empty ? (
          <EmptyChat onPick={(p) => void send(p)} disabled={streaming} />
        ) : (
          <ul className="mx-auto flex max-w-3xl flex-col gap-5">
            {messages.map((m) => (
              <li key={m.id}>
                <MessageBubble message={m} streaming={streaming} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        onSubmit={onSubmit}
        className="border-t border-border bg-card/60 px-4 py-3 lg:px-6"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <label htmlFor="assistant-input" className="sr-only">
            Message à l&apos;assistant
          </label>
          <textarea
            ref={textareaRef}
            id="assistant-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Pose une question sur les KPI, la prévision, les anomalies..."
            rows={1}
            disabled={streaming}
            className={cn(
              "min-h-9 max-h-40 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors",
              "placeholder:text-muted-foreground",
              "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
              "disabled:pointer-events-none disabled:opacity-60",
            )}
          />
          {streaming ? (
            <Button
              type="button"
              variant="destructive"
              onClick={stop}
              aria-label="Arrêter la génération"
            >
              <Square className="h-4 w-4" fill="currentColor" />
              <span className="hidden sm:inline">Arrêter</span>
            </Button>
          ) : (
            <>
              {canRegenerate && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void regenerate()}
                  aria-label="Régénérer la dernière réponse"
                  title="Régénérer la dernière réponse"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              )}
              <Button
                type="submit"
                disabled={!input.trim()}
                aria-label="Envoyer"
              >
                <Send className="h-4 w-4" />
                <span className="hidden sm:inline">Envoyer</span>
              </Button>
            </>
          )}
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-[10px] text-muted-foreground">
          L&apos;assistant s&apos;appuie sur les endpoints d&apos;analyse pour répondre.
          Vérifie toujours les chiffres avant partage externe.
        </p>
      </form>
    </div>
  )
}

function EmptyChat({
  onPick,
  disabled,
}: {
  onPick: (prompt: string) => void
  disabled: boolean
}) {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 py-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[color:var(--accent-coral)]/20 to-[color:var(--brand)]/10 ring-1 ring-[color:var(--accent-coral)]/30">
        <Sparkles className="h-6 w-6 text-[color:var(--accent-coral)]" />
      </div>
      <div className="space-y-1.5">
        <h2 className="font-heading text-lg font-semibold tracking-tight text-foreground">
          Comment puis-je aider ?
        </h2>
        <p className="text-sm text-muted-foreground">
          Interroge la plateforme sur les coûts, les prévisions, les anomalies ou
          la qualité des données. Je consulte les endpoints d&apos;analyse en
          direct.
        </p>
      </div>
      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        {STARTER_PROMPTS.map((s) => (
          <button
            key={s.label}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s.prompt)}
            className={cn(
              "group rounded-lg border border-border bg-background px-3.5 py-3 text-left text-xs transition-all",
              "hover:border-[color:var(--accent-coral)]/40 hover:bg-[color:var(--accent-coral)]/5",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-[color:var(--accent-coral)]">
              {s.label}
            </span>
            <span className="text-foreground/80">{s.prompt}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function MessageBubble({
  message,
  streaming,
}: {
  message: ChatMessage
  streaming: boolean
}) {
  const isUser = message.role === "user"
  const pending =
    !isUser &&
    streaming &&
    !message.content &&
    !message.error &&
    (message.toolCalls?.length ?? 0) === 0

  if (message.error) {
    return (
      <div className="flex items-start gap-3">
        <Avatar role="assistant" />
        <div className="flex-1 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            Erreur
          </div>
          <p className="mt-1 text-sm text-destructive/90">{message.error}</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex items-start gap-3",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      <Avatar role={message.role} />
      <div className={cn("flex-1 space-y-2", isUser && "flex flex-col items-end")}>
        {!isUser && (message.toolCalls?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {message.toolCalls!.map((tc) => (
              <ToolChip key={tc.id} call={tc} />
            ))}
          </div>
        )}
        <div
          className={cn(
            "max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "bg-[color:var(--brand)] text-white"
              : "border border-border bg-background text-foreground",
          )}
        >
          {pending ? (
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Analyse en cours...
            </span>
          ) : isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <MarkdownBody text={message.content} />
          )}
        </div>
        {!isUser && !pending && message.content && (
          <MessageFooter
            content={message.content}
            totalTokens={message.totalTokens}
          />
        )}
      </div>
    </div>
  )
}

function MarkdownBody({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
          ),
          code: ({ children, className, ...props }) => {
            const isBlock = /language-/.test(className ?? "")
            if (isBlock) {
              return (
                <code
                  className="block overflow-x-auto rounded-md bg-muted p-3 text-xs"
                  {...props}
                >
                  {children}
                </code>
              )
            }
            return (
              <code
                className="rounded bg-muted px-1 py-0.5 text-[0.85em]"
                {...props}
              >
                {children}
              </code>
            )
          },
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-muted px-2 py-1 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-2 py-1">{children}</td>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

function MessageFooter({
  content,
  totalTokens,
}: {
  content: string
  totalTokens?: number
}) {
  const [copied, setCopied] = React.useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard denied */
    }
  }
  return (
    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Copier la réponse"
      >
        {copied ? (
          <>
            <Check className="h-3 w-3" /> Copié
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" /> Copier
          </>
        )}
      </button>
      {typeof totalTokens === "number" && (
        <span>{totalTokens.toLocaleString("fr-FR")} tokens</span>
      )}
    </div>
  )
}

function ToolChip({ call }: { call: ToolCall }) {
  const label = TOOL_LABELS[call.name] ?? call.name
  const running = call.status === "running"
  const title =
    call.resultPreview && call.resultPreview.length > 0
      ? call.resultPreview
      : Object.keys(call.arguments).length > 0
        ? JSON.stringify(call.arguments)
        : call.name
  return (
    <Badge
      variant={running ? "muted" : "outline"}
      size="sm"
      className="normal-case tracking-normal"
      title={title}
    >
      {running ? (
        <RefreshCw className="h-2.5 w-2.5 animate-spin" />
      ) : (
        <Wrench className="h-2.5 w-2.5" />
      )}
      {label}
    </Badge>
  )
}

function Avatar({ role }: { role: "user" | "assistant" }) {
  if (role === "user") {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <User className="h-4 w-4" />
      </div>
    )
  }
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[color:var(--accent-coral)]/25 to-[color:var(--brand)]/15 ring-1 ring-[color:var(--accent-coral)]/30">
      <Sparkles className="h-4 w-4 text-[color:var(--accent-coral)]" />
    </div>
  )
}
