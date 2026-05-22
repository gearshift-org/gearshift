import { useEffect, useRef, useState } from "react"
import { Plus, X } from "lucide-react"
import { VSCodeIcon } from "@/components/icons/VSCodeIcon"
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const BUTTON_TOOLTIP_DELAY = 800

type Props = {
  terminals: TerminalTab[]
  activeId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onClose?: (id: string) => void
  onCloseAll?: () => void
  onCloseToRight?: (id: string) => void
  onRename?: (id: string, name: string) => void
  onOpenInVSCode?: () => void
}

export function TerminalTabBar({
  terminals,
  activeId,
  onSelect,
  onAdd,
  onClose,
  onCloseAll,
  onCloseToRight,
  onRename,
  onOpenInVSCode,
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
    <div className="flex h-[34px] shrink-0 items-stretch border-b border-border bg-background">
      {terminals.map((t, i) => {
        const isActive = t.id === activeId
        const isRenaming = t.id === renamingId
        const hasTabsToRight = i < terminals.length - 1
        return (
          <ContextMenu key={t.id}>
            <ContextMenuTrigger
              className={cn(
                "group relative flex h-full min-w-[140px] cursor-pointer items-center gap-2 border-r border-border/60 px-3 text-xs transition-colors",
                isActive
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/40",
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
                <Tooltip delay={BUTTON_TOOLTIP_DELAY}>
                  <TooltipTrigger
                    render={
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation()
                          onClose(t.id)
                        }}
                        className={cn(
                          "ml-auto grid size-5 place-items-center rounded-sm opacity-0 transition-colors hover:bg-foreground/15 hover:text-foreground group-hover:opacity-100",
                          isActive && "opacity-60",
                        )}
                      >
                        <X className="size-3.5" />
                      </span>
                    }
                  />
                  <TooltipContent>Close terminal</TooltipContent>
                </Tooltip>
              )}
            </ContextMenuTrigger>
            <ContextMenuContent className="min-w-[200px] whitespace-nowrap">
              <ContextMenuItem onClick={() => startRename(t)}>
                Rename
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => onClose?.(t.id)}>
                Close
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => onCloseToRight?.(t.id)}
                disabled={!hasTabsToRight}
              >
                Close to the Right
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onCloseAll?.()}>
                Close All Tabs
              </ContextMenuItem>
              {onOpenInVSCode && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => onOpenInVSCode()}>
                    <VSCodeIcon className="size-3.5" />
                    Open in VSCode
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
      <Tooltip delay={BUTTON_TOOLTIP_DELAY}>
        <TooltipTrigger
          render={
            <button
              onClick={onAdd}
              aria-label="Add terminal"
              className="group/add grid h-full w-10 place-items-center text-muted-foreground"
            >
              <span className="grid size-5 place-items-center rounded-sm transition-colors group-hover/add:bg-foreground/15 group-hover/add:text-foreground">
                <Plus className="size-3.5" />
              </span>
            </button>
          }
        />
        <TooltipContent>New terminal</TooltipContent>
      </Tooltip>
    </div>
  )
}
