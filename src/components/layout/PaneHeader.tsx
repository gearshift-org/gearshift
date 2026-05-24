import * as React from "react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { SplitSquareHorizontal, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { paneDisplayName } from "./terminalName"
import type { TerminalPane } from "./types"

type Props = {
  pane: TerminalPane
  index: number
  isActive: boolean
  showSplit: boolean
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

  const agentDot = pane.agentStatus?.working
    ? "bg-emerald-500"
    : pane.agentStatus?.running
      ? "bg-amber-500"
      : null

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onMouseDown={onFocus}
      onDoubleClick={(e) => {
        e.stopPropagation()
        startEdit()
      }}
      className={cn(
        "flex h-[34px] shrink-0 cursor-default items-center gap-2 border-b border-border bg-background px-3 text-xs text-foreground/80 select-none",
        isActive && "bg-muted/60 text-foreground",
      )}
    >
      {agentDot ? (
        <span className={cn("size-1.5 shrink-0 rounded-full", agentDot)} />
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
        <span className="min-w-0 flex-1 truncate">
          {paneDisplayName(pane, index)}
        </span>
      )}
      {showSplit && !editing ? (
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onSplit()
          }}
          aria-label="Split pane"
          className="grid size-5 shrink-0 place-items-center rounded-sm text-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
        >
          <SplitSquareHorizontal className="size-3" />
        </button>
      ) : null}
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        aria-label="Close pane"
        className="grid size-5 shrink-0 place-items-center rounded-sm text-foreground/70 transition-colors hover:bg-destructive/15 hover:text-destructive"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}
