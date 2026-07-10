"use client"

import * as React from "react"
import { MessageSquare, MessageSquarePlus, RefreshCw, Trash2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { formatRelative } from "./helpers"
import type { ConversationSummary } from "./types"

export function ConversationSidebar({
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
      className={cn("flex h-full min-h-0 w-full flex-col bg-muted/20", className)}
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
              Aucune conversation encore. Envoie ton premier message pour commencer.
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
// Mobile drawer — plain-DOM (Dialog primitive is centered, we want a left-
// anchored slide-in). Inert body-scroll lock while open.
// ---------------------------------------------------------------------------
export function MobileDrawer({
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
