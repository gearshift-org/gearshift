import { useEffect, useState } from "react"
import { Trash2 } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { SummarizeHistoryMenu } from "@/components/terminal/SummarizeHistoryMenu"
import type { HistoryRange } from "@/lib/historySummary"
import type { ChatHistoryMessage } from "../../../electron/preload"

type Props = {
  projectId: string | null
  reloadKey?: number
  onSummarize?: (range: HistoryRange) => void
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

export function ProjectChatHistoryPanel({
  projectId,
  reloadKey = 0,
  onSummarize,
}: Props) {
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
    const offAppend = window.term.history.onProjectAppended(
      projectId,
      (msg) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev
          return [msg, ...prev]
        })
      }
    )
    const offClear = window.term.history.onProjectCleared(projectId, () => {
      setMessages([])
    })
    const offDelete = window.term.history.onProjectDeleted(projectId, (id) => {
      setMessages((prev) => prev.filter((msg) => msg.id !== id))
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
      offDelete()
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

  const deleteMessage = async (id: string) => {
    setMessages((prev) => prev.filter((msg) => msg.id !== id))
    await window.term.history.delete(id)
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
      <div className="flex h-[34px] shrink-0 items-center justify-between border-b border-border/60 px-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <span>
          {messages.length} message{messages.length === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-0.5">
          {onSummarize && (
            <SummarizeHistoryMenu
              onSelect={onSummarize}
              disabled={messages.length === 0}
              className="text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            />
          )}
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
              <li key={m.id} className="group px-3 py-2">
                <div className="flex items-center justify-between gap-2 text-[10px] tracking-wide text-muted-foreground uppercase">
                  <span>{m.agent ?? "user"}</span>
                  <div className="flex items-center gap-1.5">
                    <span>{formatTime(m.createdAt)}</span>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            onClick={() => void deleteMessage(m.id)}
                            aria-label="Delete history item"
                            className="grid size-5 place-items-center rounded-sm text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive focus:opacity-100"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        }
                      />
                      <TooltipContent>Delete history item</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
                <pre className="mt-1 font-sans text-xs leading-snug break-words whitespace-pre-wrap text-foreground/90">
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
