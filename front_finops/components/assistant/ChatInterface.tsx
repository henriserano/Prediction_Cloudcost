"use client"

import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  AlertCircle,
  Check,
  Copy,
  MessageSquare,
  MessageSquarePlus,
  PanelLeft,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Trash2,
  User,
  Wrench,
  X,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
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

interface ConversationSummary {
  threadId: string
  title: string
  messageCount: number
  updatedAt: string
}

const THREAD_KEY = "sia-finops-chat-thread"

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

// ---------------------------------------------------------------------------
// Data hooks — persist through backend, no more localStorage transcripts.
// ---------------------------------------------------------------------------

function useConversations() {
  return useQuery<ConversationSummary[]>({
    queryKey: ["conversations"],
    queryFn: async () => {
      const res = await fetch("/api/conversations", { credentials: "include" })
      if (!res.ok) throw new Error(`GET conversations failed with ${res.status}`)
      const body = (await res.json()) as {
        conversations?: {
          thread_id: string
          title?: string
          message_count?: number
          updated_at?: string
        }[]
      }
      return (body.conversations ?? []).map((c) => ({
        threadId: c.thread_id,
        title: c.title || "Nouvelle conversation",
        messageCount: Number(c.message_count ?? 0),
        updatedAt: c.updated_at ?? "",
      }))
    },
    staleTime: 30_000,
    // 401 while not logged in — don't spam the console with retries.
    retry: false,
  })
}

async function fetchThreadMessages(threadId: string): Promise<ChatMessage[]> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(threadId)}`, {
    credentials: "include",
  })
  if (!res.ok) throw new Error(`GET conversation failed with ${res.status}`)
  const body = (await res.json()) as {
    messages?: { role?: string; content?: string }[]
  }
  return (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({
      id: nextId(),
      role: m.role as "user" | "assistant",
      content: m.content ?? "",
    }))
}

function useDeleteConversation() {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: async (threadId) => {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(threadId)}`,
        { method: "DELETE", credentials: "include" },
      )
      if (!res.ok) throw new Error(`DELETE conversation failed with ${res.status}`)
      // Also drop the backend agent state so re-using the id doesn't resume.
      fetch(`/api/chat/${encodeURIComponent(threadId)}`, {
        method: "DELETE",
        credentials: "include",
      }).catch(() => undefined)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["conversations"] })
    },
  })
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function ChatInterface() {
  const qc = useQueryClient()
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState("")
  const [streaming, setStreaming] = React.useState(false)
  const [threadId, setThreadId] = React.useState<string | null>(null)
  const [hydrated, setHydrated] = React.useState(false)
  const [loadingThread, setLoadingThread] = React.useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = React.useState(false)

  const abortRef = React.useRef<AbortController | null>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const stickToBottomRef = React.useRef(true)

  const conversations = useConversations()
  const { mutate: deleteConversation, isPending: deletingConversation } =
    useDeleteConversation()

  // Restore last active thread on mount.
  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const t = localStorage.getItem(THREAD_KEY)
        if (t) {
          setThreadId(t)
          try {
            const msgs = await fetchThreadMessages(t)
            if (!cancelled) setMessages(msgs)
          } catch {
            // Broken/deleted thread — start fresh silently.
            if (!cancelled) {
              setThreadId(null)
              localStorage.removeItem(THREAD_KEY)
            }
          }
        }
      } catch {
        /* ignore corrupted storage */
      }
      if (!cancelled) setHydrated(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    if (!hydrated) return
    try {
      if (threadId) localStorage.setItem(THREAD_KEY, threadId)
      else localStorage.removeItem(THREAD_KEY)
    } catch {
      /* ignore */
    }
  }, [threadId, hydrated])

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
        { id: assistantId, role: "assistant", content: "", toolCalls: [] },
      ])
      setStreaming(true)

      const ac = new AbortController()
      abortRef.current = ac

      let newlyOpenedThread = false

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
        // Refresh the sidebar so the newly-created (or renamed on first msg)
        // thread shows up / bumps to the top of the list.
        if (newlyOpenedThread || currentThreadId) {
          void qc.invalidateQueries({ queryKey: ["conversations"] })
        }
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
          if (tid) {
            if (tid !== currentThreadId) newlyOpenedThread = true
            setThreadId(tid)
          }
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
    [qc],
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

  const startNewConversation = React.useCallback(() => {
    if (streaming) abortRef.current?.abort()
    setMessages([])
    setThreadId(null)
    setSidebarOpen(false)
    stickToBottomRef.current = true
    try {
      localStorage.removeItem(THREAD_KEY)
    } catch {
      /* ignore */
    }
    textareaRef.current?.focus()
  }, [streaming])

  const openConversation = React.useCallback(
    async (id: string) => {
      if (id === threadId) {
        setSidebarOpen(false)
        return
      }
      if (streaming) abortRef.current?.abort()
      setLoadingThread(id)
      try {
        const msgs = await fetchThreadMessages(id)
        setThreadId(id)
        setMessages(msgs)
        stickToBottomRef.current = true
        setSidebarOpen(false)
      } catch {
        setMessages([
          {
            id: nextId(),
            role: "assistant",
            content: "",
            error: "Impossible de charger cette conversation.",
          },
        ])
      } finally {
        setLoadingThread(null)
      }
    },
    [streaming, threadId],
  )

  const handleDeleteConversation = React.useCallback(
    (id: string) => {
      deleteConversation(id, {
        onSuccess: () => {
          if (id === threadId) {
            setMessages([])
            setThreadId(null)
            try {
              localStorage.removeItem(THREAD_KEY)
            } catch {
              /* ignore */
            }
          }
        },
      })
    },
    [deleteConversation, threadId],
  )

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
    !streaming && messages.length >= 1 && messages.some((m) => m.role === "user")

  const conversationsList = conversations.data ?? []

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[520px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm md:flex-row">
      {/* Desktop sidebar */}
      <ConversationSidebar
        className="hidden md:flex md:w-72 md:shrink-0 md:border-r md:border-border"
        conversations={conversationsList}
        loading={conversations.isLoading}
        error={conversations.isError}
        activeId={threadId}
        loadingThread={loadingThread}
        streaming={streaming}
        onOpen={(id) => void openConversation(id)}
        onDelete={handleDeleteConversation}
        onNewChat={startNewConversation}
        deleting={deletingConversation}
      />

      {/* Mobile drawer */}
      <MobileDrawer open={sidebarOpen} onClose={() => setSidebarOpen(false)}>
        <ConversationSidebar
          conversations={conversationsList}
          loading={conversations.isLoading}
          error={conversations.isError}
          activeId={threadId}
          loadingThread={loadingThread}
          streaming={streaming}
          onOpen={(id) => void openConversation(id)}
          onDelete={handleDeleteConversation}
          onNewChat={startNewConversation}
          onClose={() => setSidebarOpen(false)}
          deleting={deletingConversation}
        />
      </MobileDrawer>

      {/* Main column */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 lg:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-[color:var(--accent-green)]/40 md:hidden"
              aria-label="Ouvrir la liste des conversations"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  streaming
                    ? "animate-pulse bg-[color:var(--accent-green)]"
                    : "bg-emerald-500",
                )}
              />
              <span className="truncate">
                {streaming
                  ? "Génération en cours"
                  : threadId
                    ? "Conversation active"
                    : "Nouvelle conversation"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={startNewConversation}
              disabled={streaming && !threadId}
              className="text-xs"
              title="Démarrer une nouvelle conversation"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Nouvelle</span>
            </Button>
          </div>
        </div>

        <div
          ref={scrollRef}
          onScroll={onScrollAreaScroll}
          className="flex-1 overflow-y-auto px-4 py-5 lg:px-6"
          aria-live="polite"
          aria-atomic="false"
        >
          {loadingThread ? (
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              <Skeleton className="h-12 w-3/4" />
              <Skeleton className="h-24" />
              <Skeleton className="h-16 w-2/3" />
            </div>
          ) : empty ? (
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
          className="border-t border-border bg-card/60 px-3 py-3 lg:px-4"
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
                "min-h-10 max-h-40 flex-1 resize-none rounded-2xl border border-input bg-background px-4 py-2.5 text-sm outline-none transition-colors",
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
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function ConversationSidebar({
  className,
  conversations,
  loading,
  error,
  activeId,
  loadingThread,
  streaming,
  onOpen,
  onDelete,
  onNewChat,
  onClose,
  deleting,
}: {
  className?: string
  conversations: ConversationSummary[]
  loading: boolean
  error: boolean
  activeId: string | null
  loadingThread: string | null
  streaming: boolean
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onNewChat: () => void
  onClose?: () => void
  deleting: boolean
}) {
  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full flex-col bg-muted/20",
        className,
      )}
      aria-label="Conversations"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          <MessageSquare className="h-3.5 w-3.5" />
          Conversations
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onNewChat}
            disabled={streaming && !activeId}
            className="h-7 gap-1 text-xs"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            Nouvelle
          </Button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading && (
          <div className="space-y-1.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full rounded-lg" />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-2 text-[11px] text-destructive">
            Impossible de charger tes conversations. Reconnecte-toi si le
            problème persiste.
          </div>
        )}

        {!loading && !error && conversations.length === 0 && (
          <div className="mt-6 flex flex-col items-center gap-2 px-3 text-center text-[11px] text-muted-foreground">
            <MessageSquare className="h-4 w-4 opacity-60" />
            <p>
              Aucune conversation encore. Envoie ton premier message pour
              commencer.
            </p>
          </div>
        )}

        {!loading && !error && conversations.length > 0 && (
          <ul className="space-y-0.5">
            {conversations.map((c) => {
              const active = c.threadId === activeId
              const isLoadingThis = loadingThread === c.threadId
              return (
                <li key={c.threadId}>
                  <ConversationRow
                    conversation={c}
                    active={active}
                    isLoading={isLoadingThis}
                    onOpen={onOpen}
                    onDelete={onDelete}
                    deleting={deleting}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}

function ConversationRow({
  conversation,
  active,
  isLoading,
  onOpen,
  onDelete,
  deleting,
}: {
  conversation: ConversationSummary
  active: boolean
  isLoading: boolean
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  deleting: boolean
}) {
  return (
    <div
      className={cn(
        "group relative flex items-stretch overflow-hidden rounded-lg border transition-colors",
        active
          ? "border-[color:var(--accent-green)]/50 bg-[color:var(--accent-green)]/8"
          : "border-transparent hover:border-border hover:bg-card",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(conversation.threadId)}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-2.5 py-2 text-left"
      >
        <div className="flex w-full min-w-0 items-center gap-1.5">
          {isLoading && (
            <RefreshCw
              className="h-3 w-3 shrink-0 animate-spin text-muted-foreground"
              aria-hidden
            />
          )}
          <span
            className={cn(
              "truncate text-xs font-medium",
              active ? "text-foreground" : "text-foreground/90",
            )}
          >
            {conversation.title}
          </span>
        </div>
        <div className="flex w-full items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>{conversation.messageCount} msg</span>
          <span aria-hidden>·</span>
          <span className="truncate">{formatRelative(conversation.updatedAt)}</span>
        </div>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onDelete(conversation.threadId)
        }}
        disabled={deleting}
        aria-label={`Supprimer ${conversation.title}`}
        title="Supprimer"
        className={cn(
          "flex h-full w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors",
          "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          "hover:bg-destructive/10 hover:text-destructive",
          "disabled:pointer-events-none disabled:opacity-40",
        )}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mobile drawer — plain-DOM implementation (Dialog primitive is centered,
// we want a left-anchored slide-in). Uses inert body scroll lock via a
// touch/wheel handler.
// ---------------------------------------------------------------------------

function MobileDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  React.useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener("keydown", onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
      <button
        type="button"
        onClick={onClose}
        aria-label="Fermer"
        className="absolute inset-0 bg-black/40"
      />
      <div className="absolute inset-y-0 left-0 flex w-[85%] max-w-xs flex-col bg-card shadow-xl">
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyChat({
  onPick,
  disabled,
}: {
  onPick: (prompt: string) => void
  disabled: boolean
}) {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 py-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[color:var(--accent-green)]/20 to-[color:var(--brand)]/10 ring-1 ring-[color:var(--accent-green)]/30">
        <Sparkles className="h-6 w-6 text-[color:var(--accent-green)]" />
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
              "hover:border-[color:var(--accent-green)]/40 hover:bg-[color:var(--accent-green)]/5",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-[color:var(--accent-green)]">
              {s.label}
            </span>
            <span className="text-foreground/80">{s.prompt}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Message bubble + subcomponents
// ---------------------------------------------------------------------------

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
            "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
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
          <MessageFooter content={message.content} totalTokens={message.totalTokens} />
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
          p: ({ children }: React.ComponentProps<"p">) => (
            <p className="mb-2 last:mb-0">{children}</p>
          ),
          ul: ({ children }: React.ComponentProps<"ul">) => (
            <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }: React.ComponentProps<"ol">) => (
            <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
          ),
          code: ({ children, className, ...props }: React.ComponentProps<"code">) => {
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
              <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]" {...props}>
                {children}
              </code>
            )
          },
          table: ({ children }: React.ComponentProps<"table">) => (
            <div className="my-2 overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }: React.ComponentProps<"th">) => (
            <th className="border border-border bg-muted px-2 py-1 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }: React.ComponentProps<"td">) => (
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
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[color:var(--accent-green)]/25 to-[color:var(--brand)]/15 ring-1 ring-[color:var(--accent-green)]/30">
      <Sparkles className="h-4 w-4 text-[color:var(--accent-green)]" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(iso: string): string {
  if (!iso) return ""
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ""
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 60) return "à l'instant"
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `il y a ${diffMin} min`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `il y a ${diffHr} h`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 7) return `il y a ${diffDay} j`
  return new Date(then).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
  })
}
