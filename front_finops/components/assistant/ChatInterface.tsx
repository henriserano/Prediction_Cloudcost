"use client"

import * as React from "react"
import {
  MessageSquarePlus,
  PanelLeft,
  RotateCcw,
  Send,
  Square,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

import { THREAD_KEY } from "./constants"
import { ConversationSidebar, MobileDrawer } from "./ConversationSidebar"
import { EmptyChat } from "./EmptyChat"
import { MessageBubble } from "./MessageBubble"
import { nextId } from "./helpers"
import {
  applyDoneEvent,
  applyErrorEvent,
  applyToolEndEvent,
  applyToolStartEvent,
  applyTokenEvent,
  parseSseChunks,
} from "./sse"
import type { ChatMessage, ConversationSummary, SseParsed } from "./types"

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
// Root component — streaming state machine only. Rendering is delegated to
// the extracted MessageBubble / ConversationSidebar / EmptyChat components so
// each subtree memoises independently.
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
  // SEC / React 19: SSE reader continues after unmount unless we skip the
  // setState calls; without the guard, react-19 logs "setState on unmounted"
  // and the closure keeps `messages` alive until Bedrock closes the stream.
  const mountedRef = React.useRef(true)
  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  const safeSetMessages = React.useCallback(
    (updater: React.SetStateAction<ChatMessage[]>) => {
      if (!mountedRef.current) return
      setMessages(updater)
    },
    [],
  )
  const safeSetStreaming = React.useCallback((v: boolean) => {
    if (!mountedRef.current) return
    setStreaming(v)
  }, [])
  const safeSetThreadId = React.useCallback((tid: string | null) => {
    if (!mountedRef.current) return
    setThreadId(tid)
  }, [])

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
      safeSetMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", toolCalls: [] },
      ])
      safeSetStreaming(true)

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
          safeSetMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, error: String(detail) } : m)),
          )
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          if (!mountedRef.current) {
            try {
              await reader.cancel()
            } catch {
              /* reader already closed */
            }
            return
          }
          const { value, done } = await reader.read()
          if (done) break
          if (!mountedRef.current) return
          buffer += decoder.decode(value, { stream: true })
          const iter = parseSseChunks(buffer)
          let step = iter.next()
          while (!step.done) {
            if (!mountedRef.current) return
            const { event, data } = step.value
            handleEvent(event, data, assistantId)
            step = iter.next()
          }
          buffer = step.value
        }
      } catch (err) {
        if (!mountedRef.current) return
        if ((err as Error).name === "AbortError") {
          safeSetMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId && !m.content
                ? { ...m, content: "_(interrompu)_" }
                : m,
            ),
          )
        } else {
          safeSetMessages((prev) =>
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
        safeSetStreaming(false)
        abortRef.current = null
        if (mountedRef.current) textareaRef.current?.focus()
        // Refresh the sidebar so the newly-created (or renamed on first msg)
        // thread shows up / bumps to the top of the list.
        if (mountedRef.current && (newlyOpenedThread || currentThreadId)) {
          void qc.invalidateQueries({ queryKey: ["conversations"] })
        }
      }

      function handleEvent(event: string, data: string, msgId: string) {
        let parsed: SseParsed = {}
        try {
          parsed = JSON.parse(data) as SseParsed
        } catch {
          return
        }

        if (event === "ready") {
          const tid = parsed.thread_id as string | undefined
          if (tid) {
            if (tid !== currentThreadId) newlyOpenedThread = true
            safeSetThreadId(tid)
          }
          return
        }
        if (event === "token") {
          safeSetMessages((prev) => applyTokenEvent(prev, msgId, parsed))
          return
        }
        if (event === "tool_start") {
          safeSetMessages((prev) => applyToolStartEvent(prev, msgId, parsed))
          return
        }
        if (event === "tool_end") {
          safeSetMessages((prev) => applyToolEndEvent(prev, msgId, parsed))
          return
        }
        if (event === "done") {
          safeSetMessages((prev) => applyDoneEvent(prev, msgId, parsed))
          return
        }
        if (event === "error") {
          safeSetMessages((prev) => applyErrorEvent(prev, msgId, parsed))
        }
      }
    },
    [qc, safeSetMessages, safeSetStreaming, safeSetThreadId],
  )

  const send = React.useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || streaming) return

      const userMsg: ChatMessage = { id: nextId(), role: "user", content: trimmed }
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
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl bg-card shadow-[var(--shadow-sia-card)] md:flex-row",
        // Mobile chrome (PageShell top bar + main padding) ≈ 8rem
        // Desktop chrome (breadcrumbs + title block + footer) ≈ 13rem
        "h-[calc(100dvh-8rem)] lg:h-[calc(100dvh-13rem)] min-h-[480px]",
      )}
    >
      {/* Desktop sidebar */}
      <ConversationSidebar
        className="hidden md:flex md:w-56 md:shrink-0 md:border-r md:border-border lg:w-72"
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
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-[color:var(--accent-green)]/40 md:hidden"
              aria-label="Ouvrir la liste des conversations"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span
                aria-hidden
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  streaming
                    ? "animate-pulse bg-[color:var(--accent-green)]"
                    : "bg-[color:var(--accent-green)]",
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={startNewConversation}
            disabled={streaming && !threadId}
            className="shrink-0 text-xs"
            title="Démarrer une nouvelle conversation"
            aria-label="Nouvelle conversation"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Nouvelle</span>
          </Button>
        </div>

        <div
          ref={scrollRef}
          onScroll={onScrollAreaScroll}
          className="flex-1 overflow-y-auto px-3 py-4 sm:px-4 sm:py-5 lg:px-6"
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
          className="border-t border-border bg-card/60 px-3 py-3 sm:px-4"
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
              placeholder="Pose une question sur les KPI, la prévision, les anomalies…"
              rows={1}
              disabled={streaming}
              className={cn(
                "min-h-10 max-h-40 flex-1 resize-none rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm outline-none transition-colors sm:px-4",
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
                className="shrink-0"
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
                    size="icon"
                    onClick={() => void regenerate()}
                    aria-label="Régénérer la dernière réponse"
                    title="Régénérer la dernière réponse"
                    className="shrink-0"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={!input.trim()}
                  aria-label="Envoyer"
                  className="shrink-0"
                >
                  <Send className="h-4 w-4" />
                  <span className="hidden sm:inline">Envoyer</span>
                </Button>
              </>
            )}
          </div>
          <p className="mx-auto mt-2 hidden max-w-3xl text-[10px] text-muted-foreground sm:block">
            L&apos;assistant s&apos;appuie sur les endpoints d&apos;analyse pour répondre.
            Vérifie toujours les chiffres avant partage externe.
          </p>
        </form>
      </div>
    </div>
  )
}
