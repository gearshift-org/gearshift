import * as React from "react"
import { useDraggable } from "@dnd-kit/core"
import { SplitSquareHorizontal, SplitSquareVertical, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { toast } from "sonner"
import { paneDisplayName } from "./terminalName"
import { TerminalHistoryButton } from "@/components/terminal/TerminalHistoryPopover"
import { SummarizeHistoryMenu } from "@/components/terminal/SummarizeHistoryMenu"
import {
  summarizeHistoryToAgent,
  type HistoryRange,
} from "@/lib/historySummary"
// AgentSpinner kept for when the header busy spinner is restored.
// import { AgentSpinner } from "./AgentSpinner"
import { AgentIcon } from "./AgentIcon"
import type { TerminalPane } from "./types"

type Props = {
  pane: TerminalPane
  index: number
  isActive: boolean
  showSplit: boolean
  showClose?: boolean
  onFocus: () => void
  onClose: () => void
  onRename: (name: string) => void
  onSplitHorizontal: () => void
  onSplitVertical: () => void
}

export function PaneHeader({
  pane,
  index,
  isActive,
  showSplit,
  showClose = true,
  onFocus,
  onClose,
  onRename,
  onSplitHorizontal,
  onSplitVertical,
}: Props) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: pane.id,
    disabled: editing,
  })

  // The dragged copy follows the cursor in a DragOverlay (never clipped by the
  // panel's overflow), so the original just fades out while it's dragged. The
  // drop-target highlight lives on the whole pane (see WorkspacePane).
  const style: React.CSSProperties = {
    opacity: isDragging ? 0 : undefined,
  }

  const startEdit = () => {
    setDraft(pane.customName ?? paneDisplayName(pane, index))
    setEditing(true)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }

  const commit = () => {
    onRename(draft)
    setEditing(false)
  }
  const cancel = () => setEditing(false)

  // Summarize this terminal's own conversation into its running agent.
  const handleSummarize = (range: HistoryRange) => {
    if (!pane.agentStatus?.running || !pane.sessionId) {
      toast.error("This terminal needs a running agent to summarize")
      return
    }
    void summarizeHistoryToAgent({
      sessionId: pane.sessionId,
      scope: { sessionId: pane.sessionId },
      range,
    })
  }

  const agentWorking = pane.agentStatus?.working
  const agentNeedsAttention = pane.agentStatus?.needsAttention
  const agentDone =
    !agentWorking && !agentNeedsAttention && !!pane.agentStatus?.completed
  // Show the agent's brand icon while an agent is active in this pane (running,
  // working, waiting on the user, or just completed). AgentIcon renders nothing
  // for any agent without a registered icon.
  const agentActive =
    !!pane.agentStatus?.running ||
    !!agentWorking ||
    !!agentNeedsAttention ||
    agentDone

  return (
    <div
      ref={setNodeRef}
      style={style}
      onMouseDown={onFocus}
      onDoubleClick={(e) => {
        e.stopPropagation()
        startEdit()
      }}
      className={cn(
        // Match the terminal body background (the --xterm-bg var is set on the
        // pane leaf in WorkspacePane) so the header blends with the terminal.
        "relative flex h-[34px] shrink-0 cursor-default items-center gap-0.5 overflow-hidden border-b border-border bg-[var(--xterm-bg)] px-3 text-xs text-foreground/80 select-none",
        isActive && "text-foreground"
      )}
    >
      {agentActive ? (
        <AgentIcon
          agent={pane.agentStatus?.agentName}
          className="mr-1 size-3.5"
        />
      ) : null}
      {/* Busy spinner hidden for now — the scanning border above already
          signals "agent working". Done/attention are signaled by the pulsing
          pane border (see WorkspacePane.renderLeaf), not a header dot; the
          dots still appear in the project sidebar and toasts. */}
      {editing ? (
        <input
          ref={inputRef}
          data-keycapture="true"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === "Enter") commit()
            else if (e.key === "Escape") cancel()
          }}
          onBlur={commit}
          className="h-5 min-w-0 flex-1 rounded-sm border border-border bg-background px-1 font-mono text-[11px] text-foreground ring-1 ring-ring/40 outline-none"
        />
      ) : (
        // The name span is the ONLY drag handle. Buttons sit outside the
        // listener spread, so clicking History/Split/Close never starts a
        // sortable drag — and neither does interacting with the popover.
        <span
          {...attributes}
          {...listeners}
          className="min-w-0 flex-1 cursor-grab truncate active:cursor-grabbing"
        >
          {paneDisplayName(pane, index)}
        </span>
      )}
      {pane.sessionId && !editing ? (
        <>
          <SummarizeHistoryMenu onSelect={handleSummarize} stopPropagation />
          <TerminalHistoryButton sessionId={pane.sessionId} />
        </>
      ) : null}
      {showSplit && !editing ? (
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSplitHorizontal()
                  }}
                  aria-label="Split right"
                  className="grid size-5 shrink-0 place-items-center rounded-sm text-foreground transition-colors hover:bg-foreground/15"
                >
                  <SplitSquareHorizontal className="size-3.5" />
                </button>
              }
            />
            <TooltipContent>Split right</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSplitVertical()
                  }}
                  aria-label="Split down"
                  className="grid size-5 shrink-0 place-items-center rounded-sm text-foreground transition-colors hover:bg-foreground/15"
                >
                  <SplitSquareVertical className="size-3.5" />
                </button>
              }
            />
            <TooltipContent>Split down</TooltipContent>
          </Tooltip>
        </>
      ) : null}
      {showClose ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose()
                }}
                aria-label="Close pane"
                className="grid size-5 shrink-0 place-items-center rounded-sm text-foreground transition-colors hover:bg-foreground/15"
              >
                <X className="size-3.5" />
              </button>
            }
          />
          <TooltipContent>Close pane</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}

/**
 * Floating preview rendered inside dnd-kit's DragOverlay while a pane header is
 * being dragged. Lives in a portal, so it's never clipped by panel overflow.
 */
export function PaneHeaderPreview({
  pane,
  index,
}: {
  pane: TerminalPane
  index: number
}) {
  return (
    <div className="flex h-[34px] cursor-grabbing items-center gap-0.5 rounded-sm border border-border bg-background px-3 text-xs text-foreground shadow-lg ring-1 ring-foreground/30 select-none">
      <span className="truncate">{paneDisplayName(pane, index)}</span>
    </div>
  )
}
