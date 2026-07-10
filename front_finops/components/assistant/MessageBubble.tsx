"use client"

import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { AlertCircle, Check, Copy, RefreshCw, Sparkles, User, Wrench } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { TOOL_LABELS } from "./constants"
import type { ChatMessage, ToolCall } from "./types"

export function MessageBubble({
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
    <div className={cn("flex items-start gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
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
