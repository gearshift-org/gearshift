import { useEffect, useRef, useState } from "react"
import { Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { displayName } from "./terminalName"
import type { TerminalTab } from "./types"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

type Props = {
  terminals: TerminalTab[]
  activeId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onClose?: (id: string) => void
  onCloseAll?: () => void
  onRename?: (id: string, name: string) => void
}

export function TerminalTabBar({
  terminals,
  activeId,
  onSelect,
  onAdd,
  onClose,
  onCloseAll,
  onRename,
}: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renamingId) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [renamingId])

  const startRename = (t: TerminalTab) => {
    setDraft(t.customName ?? displayName(t))
    setRenamingId(t.id)
  }

  const commit = () => {
    if (!renamingId) return
    const next = draft.trim()
    onRename?.(renamingId, next)
    setRenamingId(null)
  }

  return (
    <div className="flex h-10 items-stretch border-b border-border bg-card">
      {terminals.map((t) => {
        const isActive = t.id === activeId
        const isRenaming = t.id === renamingId
        return (
          <ContextMenu key={t.id}>
            <ContextMenuTrigger
              className={cn(
                "group relative flex h-full min-w-[140px] cursor-pointer items-center gap-2 border-r border-border/60 px-3 text-xs leading-none transition-colors",
                isActive
                  ? "bg-background text-foreground"
                  : "bg-card text-muted-foreground hover:bg-background/60",
              )}
              onClick={() => onSelect(t.id)}
              onDoubleClick={() => startRename(t)}
            >
              {isRenaming ? (
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit()
                    if (e.key === "Escape") setRenamingId(null)
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full bg-transparent text-xs outline-none"
                />
              ) : (
                <span className="truncate">{displayName(t)}</span>
              )}
              {onClose && terminals.length > 1 && !isRenaming && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose(t.id)
                  }}
                  className={cn(
                    "ml-auto grid size-4 place-items-center rounded-sm opacity-0 transition-opacity hover:bg-accent/60 group-hover:opacity-100",
                    isActive && "opacity-60",
                  )}
                >
                  <X className="size-3" />
                </span>
              )}
            </ContextMenuTrigger>
            <ContextMenuContent className="w-40">
              <ContextMenuItem onClick={() => startRename(t)}>
                Rename
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => onClose?.(t.id)}>
                Close
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onCloseAll?.()}>
                Close All Tabs
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
      <button
        onClick={onAdd}
        aria-label="Add terminal"
        className="grid h-full w-10 place-items-center border-r border-border/60 text-muted-foreground hover:bg-background/60"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}
