import { useEffect, useState } from "react"
import { Trash2 } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { ChatHistoryMessage } from "../../../electron/preload"

type Props = {
  projectId: string | null
  reloadKey?: number
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  }
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function ProjectChatHistoryPanel({ projectId, reloadKey = 0 }: Props) {
  const [messages, setMessages] = useState<ChatHistoryMessage[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!projectId) {
      setMessages([])
      return
    }
    let cancelled = false
    setLoading(true)
    window.term.history
      .listProject(projectId, 500)
      .then((res) => {
        if (cancelled) return
        setMessages(res)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    const offAppend = window.term.history.onProjectAppended(projectId, (msg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev
        return [msg, ...prev]
      })
    })
    const offClear = window.term.history.onProjectCleared(projectId, () => {
      setMessages([])
    })
    const offSessionClear = window.term.history.onProjectSessionCleared(
      projectId,
      (sessionId) => {
        setMessages((prev) => prev.filter((msg) => msg.sessionId !== sessionId))
      }
    )
    return () => {
      cancelled = true
      offAppend()
      offClear()
      offSessionClear()
    }
  }, [projectId, reloadKey])

  const clearAll = async () => {
    if (!projectId) return
    if (
      !window.confirm(
        "Clear all chat history for this project? This cannot be undone."
      )
    )
      return
    await window.term.history.clearProject(projectId)
  }

  if (!projectId) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        No project open
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[34px] shrink-0 items-center justify-between border-b border-border/60 px-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>{messages.length} message{messages.length === 1 ? "" : "s"}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={clearAll}
                disabled={messages.length === 0}
                aria-label="Clear all chat history"
                className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground disabled:opacity-30"
              >
                <Trash2 className="size-3.5" />
              </button>
            }
          />
          <TooltipContent>Clear all chat history</TooltipContent>
        </Tooltip>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {loading && messages.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            Loading…
          </div>
        ) : messages.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No messages yet for this project.
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {messages.map((m) => (
              <li key={m.id} className="px-3 py-2">
                <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <span>{m.agent ?? "user"}</span>
                  <span>{formatTime(m.createdAt)}</span>
                </div>
                <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs leading-snug text-foreground/90">
                  {m.body}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}
