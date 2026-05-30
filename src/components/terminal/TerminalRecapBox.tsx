import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatRelative } from "@/lib/relativeTime"
import { AgentAttention } from "../layout/AgentAttention"
import { openTerminalHistoryPopover } from "../layout/terminalSignals"
import type { ChatHistoryMessage } from "../../../electron/preload"

type RecapKind = "completed" | "needs_attention"

type Props = {
  sessionId: string
  message: ChatHistoryMessage | null
  kind: RecapKind
  onClose: () => void
}

/**
 * Floating box shown at the top of a terminal pane after its coding agent
 * finishes (or needs attention) and the user has been idle on that terminal.
 * Recaps the last prompt the user sent. Clicking it dismisses the box and opens
 * the chat-history popover in the pane header (top-right). The X just closes it.
 */
export function TerminalRecapBox({ sessionId, message, kind, onClose }: Props) {
  const completed = kind === "completed"
  const statusLabel = completed ? "Agent finished" : "Needs your input"

  const stop = (e: React.SyntheticEvent) => {
    e.stopPropagation()
  }

  const openHistory = () => {
    onClose()
    openTerminalHistoryPopover(sessionId)
  }

  return (
    <button
      type="button"
      onClick={openHistory}
      onMouseDown={stop}
      onPointerDown={stop}
      className={cn(
        "flex w-full animate-in flex-col gap-1.5 rounded-md border border-border bg-popover/95 px-3 py-2 text-left shadow-md backdrop-blur transition-colors duration-150 fade-in slide-in-from-top-2 hover:bg-accent/40",
      )}
    >
      <div className="flex items-center gap-2 text-[11px] font-medium text-foreground">
        {completed ? null : (
          <AgentAttention className="size-3.5" label={statusLabel} />
        )}
        <span>{statusLabel}</span>
        {message?.agent ? (
          <span className="rounded-sm bg-foreground/10 px-1.5 py-px text-[10px] font-medium text-foreground">
            {message.agent}
          </span>
        ) : null}
        {message ? (
          <span className="text-[10px] font-normal text-muted-foreground">
            {formatRelative(message.createdAt)}
          </span>
        ) : null}
        <span
          role="button"
          tabIndex={0}
          aria-label="Dismiss recap"
          onMouseDown={stop}
          onPointerDown={stop}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              e.stopPropagation()
              onClose()
            }
          }}
          className="ml-auto grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/15 hover:text-foreground"
        >
          <X className="size-3.5" />
        </span>
      </div>
      {message ? (
        <p className="line-clamp-2 font-mono text-xs break-words text-foreground/80">
          {message.body}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">View chat history</p>
      )}
    </button>
  )
}
