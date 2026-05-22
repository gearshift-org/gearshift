import { Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { TerminalTab } from "./types"

type Props = {
  terminals: TerminalTab[]
  activeId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onClose?: (id: string) => void
}

export function TerminalTabBar({
  terminals,
  activeId,
  onSelect,
  onAdd,
  onClose,
}: Props) {
  return (
    <div className="flex h-10 items-stretch border-b border-border bg-card">
      {terminals.map((t) => {
        const isActive = t.id === activeId
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className={cn(
              "group relative flex h-full min-w-[140px] items-center gap-2 border-r border-border/60 px-3 text-xs leading-none transition-colors",
              isActive
                ? "bg-background text-foreground"
                : "bg-card text-muted-foreground hover:bg-background/60",
            )}
          >
            <span className="truncate">{t.name}</span>
            {onClose && terminals.length > 1 && (
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
          </button>
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
