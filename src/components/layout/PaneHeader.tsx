import * as React from "react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { SplitSquareHorizontal, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { paneDisplayName } from "./terminalName"
import { TerminalHistoryButton } from "@/components/terminal/TerminalHistoryPopover"
import { AgentSpinner } from "./AgentSpinner"
import { AgentAttention } from "./AgentAttention"
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
  onSplit: () => void
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
  onSplit,
}: Props) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: pane.id, disabled: editing })

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
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

  const agentWorking = pane.agentStatus?.working
  const agentNeedsAttention = pane.agentStatus?.needsAttention

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
        "flex h-[34px] shrink-0 cursor-default items-center gap-0.5 border-b border-border bg-background px-3 text-xs text-foreground/80 select-none",
        isActive && "bg-muted/60 text-foreground",
      )}
    >
      {agentWorking ? (
        <AgentSpinner className="mr-0.5" />
      ) : agentNeedsAttention ? (
        <AgentAttention className="mr-0.5" />
      ) : null}
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
          className="h-5 min-w-0 flex-1 rounded-sm border border-border bg-background px-1 font-mono text-[11px] text-foreground outline-none ring-1 ring-ring/40"
        />
      ) : (
        // The name span is the ONLY drag handle. Buttons sit outside the
        // listener spread, so clicking History/Split/Close never starts a
        // sortable drag — and neither does interacting with the popover.
        <span
          {...attributes}
          {...listeners}
          className="min-w-0 flex-1 truncate cursor-grab active:cursor-grabbing"
        >
          {paneDisplayName(pane, index)}
        </span>
      )}
      {pane.sessionId && !editing ? (
        <TerminalHistoryButton sessionId={pane.sessionId} />
      ) : null}
      {showSplit && !editing ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  onSplit()
                }}
                aria-label="Split pane"
                className="grid size-5 shrink-0 place-items-center rounded-sm text-foreground transition-colors hover:bg-foreground/15"
              >
                <SplitSquareHorizontal className="size-3.5" />
              </button>
            }
          />
          <TooltipContent>Split pane</TooltipContent>
        </Tooltip>
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
