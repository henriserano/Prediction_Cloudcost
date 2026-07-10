export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  resultPreview?: string
  status: "running" | "done"
}

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  toolCalls?: ToolCall[]
  error?: string
  totalTokens?: number
}

export interface ConversationSummary {
  threadId: string
  title: string
  messageCount: number
  updatedAt: string
}

export interface SseEvent {
  event: string
  data: string
}

export type SseParsed = Record<string, unknown>
