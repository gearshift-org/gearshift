import { useEffect, useMemo, useState } from "react"
import { Search, Trash2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SummarizeHistoryMenu } from "@/components/terminal/SummarizeHistoryMenu"
import type { HistoryRange } from "@/lib/historySummary"
import type { ChatHistoryMessage } from "../../../electron/preload"

type Props = {
  projectId: string | null
  reloadKey?: number
  onSummarize?: (range: HistoryRange) => void
  onFocusSession?: (sessionId: string) => void
}

type ClearRange = "today" | "this-week" | "last-30-days" | "all"

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// Each range resolves to the epoch-ms cutoff at/after which messages are
// cleared. `all` returns undefined so the whole project is wiped.
const CLEAR_RANGES: Record<
  ClearRange,
  { label: string; since: () => number | undefined }
> = {
  today: { label: "today", since: startOfToday },
  "this-week": {
    label: "this week",
    since: () => {
      const d = new Date(startOfToday())
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // Mon = start of week
      return d.getTime()
    },
  },
  "last-30-days": {
    label: "the last 30 days",
    since: () => startOfToday() - 30 * 24 * 60 * 60 * 1000,
  },
  all: { label: "all time", since: () => undefined },
}

const CLEAR_RANGE_ORDER: ClearRange[] = [
  "today",
  "this-week",
  "last-30-days",
  "all",
]

const CLEAR_RANGE_LABELS: Record<ClearRange, string> = {
  today: "Today",
  "this-week": "This week",
  "last-30-days": "Last 30 days",
  all: "All time",
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
  onFocusSession,
}: Props) {
  const [messages, setMessages] = useState<ChatHistoryMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState("")

  const filterQuery = filter.trim().toLowerCase()
  const visibleMessages = useMemo(() => {
    if (!filterQuery) return messages
    return messages.filter(
      (m) =>
        m.body.toLowerCase().includes(filterQuery) ||
        (m.agent ?? "user").toLowerCase().includes(filterQuery)
    )
  }, [messages, filterQuery])

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
    const offClear = window.term.history.onProjectCleared(
      projectId,
      (sinceMs) => {
        setMessages((prev) =>
          sinceMs == null ? [] : prev.filter((m) => m.createdAt < sinceMs)
        )
      }
    )
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

  const clearHistory = async (range: ClearRange) => {
    if (!projectId) return
    const { label, since } = CLEAR_RANGES[range]
    if (
      !window.confirm(
        `Clear chat history from ${label} for this project? This cannot be undone.`
      )
    )
      return
    await window.term.history.clearProject(projectId, since())
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
          {filterQuery
            ? `${visibleMessages.length} of ${messages.length}`
            : `${messages.length} message${messages.length === 1 ? "" : "s"}`}
        </span>
        <div className="flex items-center gap-0.5">
          {onSummarize && (
            <SummarizeHistoryMenu
              onSelect={onSummarize}
              disabled={messages.length === 0}
              className="text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            />
          )}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    disabled={messages.length === 0}
                    aria-label="Clear chat history"
                    className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors outline-none hover:bg-foreground/10 hover:text-foreground disabled:opacity-30"
                  >
                    <Trash2 className="size-3.5" />
                  </DropdownMenuTrigger>
                }
              />
              <TooltipContent>Clear chat history</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="min-w-[160px]">
              {CLEAR_RANGE_ORDER.map((range) => (
                <DropdownMenuItem
                  key={range}
                  onClick={() => void clearHistory(range)}
                >
                  {CLEAR_RANGE_LABELS[range]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="shrink-0 border-b border-border/60 px-2 py-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault()
                setFilter("")
                e.currentTarget.blur()
              }
            }}
            placeholder="Search messages"
            aria-label="Search messages"
            className="h-7 pl-7 text-xs md:text-xs"
          />
          {filter && (
            <button
              type="button"
              onClick={() => setFilter("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-1.5 grid size-4 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/15 hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
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
        ) : visibleMessages.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No messages match "{filter.trim()}".
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {visibleMessages.map((m) => (
              <li
                key={m.id}
                className={cn(
                  "group px-3 py-2",
                  onFocusSession &&
                    "cursor-pointer transition-colors hover:bg-accent/50"
                )}
                role={onFocusSession ? "button" : undefined}
                tabIndex={onFocusSession ? 0 : undefined}
                title={
                  onFocusSession
                    ? "Focus the terminal that ran this"
                    : undefined
                }
                onClick={
                  onFocusSession
                    ? () => {
                        // Don't hijack a text selection (e.g. copying the body).
                        const sel = window.getSelection()
                        if (sel && !sel.isCollapsed) return
                        onFocusSession(m.sessionId)
                      }
                    : undefined
                }
                onKeyDown={
                  onFocusSession
                    ? (e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          onFocusSession(m.sessionId)
                        }
                      }
                    : undefined
                }
              >
                <div className="flex items-center justify-between gap-2 text-[10px] tracking-wide text-muted-foreground uppercase">
                  <span>{m.agent ?? "user"}</span>
                  <div className="flex items-center gap-1.5">
                    <span>{formatTime(m.createdAt)}</span>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              void deleteMessage(m.id)
                            }}
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
