import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { AddProjectMenu } from "./AddProjectMenu"
import type { RecentProject } from "@/lib/projects"
import type { Project } from "./types"

type Props = {
  projects: Project[]
  activeId: string
  recents: RecentProject[]
  onSelect: (id: string) => void
  onAdd: () => void
  onPickRecent: (recent: RecentProject) => void
  onClose?: (id: string) => void
  onCloseOthers?: (id: string) => void
  onCloseToRight?: (id: string) => void
}

export function ProjectTabs({
  projects,
  activeId,
  recents,
  onSelect,
  onAdd,
  onPickRecent,
  onClose,
  onCloseOthers,
  onCloseToRight,
}: Props) {
  return (
    <div className="flex h-full items-stretch [-webkit-app-region:no-drag]">
      {projects.map((p, i) => {
        const isActive = p.id === activeId
        const canClose = !!onClose && projects.length > 1
        const hasTabsToRight = i < projects.length - 1
        return (
          <ContextMenu key={p.id}>
            <ContextMenuTrigger
              onClick={() => onSelect(p.id)}
              className={cn(
                "group relative flex h-full min-w-[160px] cursor-pointer items-center gap-2 border-r border-border/60 px-3 text-xs transition-colors",
                isActive
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/40",
              )}
            >
              <span className="truncate">{p.name}</span>
              {canClose && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose?.(p.id)
                  }}
                  className={cn(
                    "ml-auto grid size-5 place-items-center rounded-sm opacity-0 transition-colors hover:text-foreground group-hover:opacity-100",
                    isActive
                      ? "opacity-60 hover:bg-foreground/15"
                      : "hover:bg-accent/60",
                  )}
                >
                  <X className="size-3.5" />
                </span>
              )}
            </ContextMenuTrigger>
            <ContextMenuContent className="min-w-[200px] whitespace-nowrap">
              <ContextMenuItem
                onClick={() => onClose?.(p.id)}
                disabled={!canClose}
              >
                Close
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => onCloseToRight?.(p.id)}
                disabled={!hasTabsToRight}
              >
                Close to the Right
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => onCloseOthers?.(p.id)}
                disabled={projects.length <= 1}
              >
                Close Others
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={onAdd}>New Project</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
      <AddProjectMenu
        recents={recents}
        onOpenDialog={onAdd}
        onPickRecent={onPickRecent}
      />
    </div>
  )
}
