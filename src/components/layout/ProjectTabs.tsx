import { X } from "lucide-react"
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { VSCodeIcon } from "@/components/icons/VSCodeIcon"
import { cn } from "@/lib/utils"
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
import { AddProjectMenu } from "./AddProjectMenu"
import type { RecentProject } from "@/lib/projects"
import type { Project } from "./types"

const BUTTON_TOOLTIP_DELAY = 800

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
  onOpenInVSCode?: (id: string) => void
  onReorder?: (fromId: string, toId: string) => void
}

type TabItemProps = {
  project: Project
  index: number
  total: number
  isActive: boolean
  canClose: boolean
  hasTabsToRight: boolean
  onSelect: (id: string) => void
  onClose?: (id: string) => void
  onCloseOthers?: (id: string) => void
  onCloseToRight?: (id: string) => void
  onAdd: () => void
  onOpenInVSCode?: (id: string) => void
}

function ProjectTabItem({
  project: p,
  total,
  isActive,
  canClose,
  hasTabsToRight,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onAdd,
  onOpenInVSCode,
}: TabItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: p.id })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        ref={setNodeRef as unknown as React.Ref<HTMLDivElement>}
        style={style}
        onClick={() => onSelect(p.id)}
        className={cn(
          "group relative flex h-full min-w-[160px] cursor-pointer items-center gap-2 border-r border-border/60 px-3 text-xs transition-colors",
          isActive
            ? "bg-accent font-medium text-foreground"
            : "text-muted-foreground hover:bg-accent/40",
          isDragging && "opacity-80 shadow-lg",
        )}
        {...attributes}
        {...listeners}
      >
        <span className="truncate">{p.name}</span>
        {canClose && (
          <Tooltip delay={BUTTON_TOOLTIP_DELAY}>
            <TooltipTrigger
              render={
                <span
                  role="button"
                  tabIndex={-1}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose?.(p.id)
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
            <TooltipContent>Close project</TooltipContent>
          </Tooltip>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[200px] whitespace-nowrap">
        <ContextMenuItem onClick={() => onClose?.(p.id)} disabled={!canClose}>
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
          disabled={total <= 1}
        >
          Close Others
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onAdd}>New Project</ContextMenuItem>
        {onOpenInVSCode && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onOpenInVSCode(p.id)}>
              <VSCodeIcon className="size-3.5" />
              Open in VSCode
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
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
  onOpenInVSCode,
  onReorder,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    onReorder?.(String(active.id), String(over.id))
  }

  return (
    <div className="flex h-full items-stretch [-webkit-app-region:no-drag]">
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext
          items={projects.map((p) => p.id)}
          strategy={horizontalListSortingStrategy}
        >
          {projects.map((p, i) => (
            <ProjectTabItem
              key={p.id}
              project={p}
              index={i}
              total={projects.length}
              isActive={p.id === activeId}
              canClose={!!onClose && projects.length > 1}
              hasTabsToRight={i < projects.length - 1}
              onSelect={onSelect}
              onClose={onClose}
              onCloseOthers={onCloseOthers}
              onCloseToRight={onCloseToRight}
              onAdd={onAdd}
              onOpenInVSCode={onOpenInVSCode}
            />
          ))}
        </SortableContext>
      </DndContext>
      <AddProjectMenu
        recents={recents}
        onOpenDialog={onAdd}
        onPickRecent={onPickRecent}
      />
    </div>
  )
}
