import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { History, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatRelative } from "@/lib/relativeTime"
import { onOpenTerminalHistoryPopover } from "@/components/layout/terminalSignals"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { ChatHistoryMessage } from "../../../electron/preload"

type Props = {
  sessionId: string | undefined
  children: React.ReactNode
  align?: "start" | "center" | "end"
  side?: "top" | "bottom" | "left" | "right"
}

/**
 * Single source of truth for the History trigger across the app — same size,
 * same hover treatment whether rendered in the shared workspace header
 * (single pane) or inside a PaneHeader (split view).
 */
export function TerminalHistoryButton({
  sessionId,
}: {
  sessionId: string | undefined
}) {
  if (!sessionId) return null
  return (
    <Tooltip>
      <TerminalHistoryPopover sessionId={sessionId}>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Chat history"
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="grid size-5 shrink-0 place-items-center rounded-sm text-foreground transition-colors hover:bg-foreground/15"
            >
              <History className="size-3.5" />
            </button>
          }
        />
      </TerminalHistoryPopover>
      <TooltipContent>Chat history</TooltipContent>
    </Tooltip>
  )
}

export function TerminalHistoryPopover({
  sessionId,
  children,
  align = "end",
  side = "bottom",
}: Props) {
  const [open, setOpen] = React.useState(false)
  const [messages, setMessages] = React.useState<ChatHistoryMessage[]>([])
  const listRef = React.useRef<HTMLDivElement | null>(null)

  // Allow other parts of the pane (e.g. the floating recap box in TerminalView)
  // to open this header popover for the same session.
  React.useEffect(() => {
    if (!sessionId) return
    return onOpenTerminalHistoryPopover(sessionId, () => setOpen(true))
  }, [sessionId])

  React.useEffect(() => {
    if (!open || !sessionId) return
    let cancelled = false
    window.term.history.list(sessionId).then((rows) => {
      if (!cancelled) setMessages(rows)
    })
    const unsubscribe = window.term.history.onAppended(sessionId, (msg) => {
      setMessages((prev) => [...prev, msg])
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [open, sessionId])

  React.useEffect(() => {
    if (!listRef.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages])

  const handleClear = async () => {
    if (!sessionId) return
    await window.term.history.clear(sessionId)
    setMessages([])
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger render={children as React.ReactElement} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          align={align}
          side={side}
          sideOffset={6}
          className="z-50"
        >
          <PopoverPrimitive.Popup
            className={cn(
              "w-[min(28rem,90vw)] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md outline-none",
              "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-100",
            )}
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div className="text-xs font-medium">Chat history</div>
              <div className="text-[10px] text-muted-foreground">
                {messages.length === 0
                  ? "Empty"
                  : `${messages.length} message${messages.length === 1 ? "" : "s"}`}
              </div>
            </div>
            <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
              {messages.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                  Anything you send to the agent will appear here.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {messages.map((m) => (
                    <li key={m.id} className="px-3 py-2">
                      <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <span>{formatRelative(m.createdAt)}</span>
                        {m.agent ? (
                          <span className="rounded-sm bg-foreground/10 px-1.5 py-px text-[10px] font-medium text-foreground">
                            {m.agent}
                          </span>
                        ) : null}
                      </div>
                      <pre className="font-mono text-xs whitespace-pre-wrap break-words text-foreground">
                        {m.body}
                      </pre>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex justify-end border-t border-border px-3 py-2">
              <button
                type="button"
                disabled={messages.length === 0}
                onClick={handleClear}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[11px] text-foreground/80 transition-colors",
                  "hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-foreground/80",
                )}
              >
                <Trash2 className="size-3" />
                Clear history
              </button>
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
