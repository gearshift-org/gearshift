import { useState } from "react"
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
import { AgentSpinner } from "./AgentSpinner"
import {
  getProjectColor,
  randomizeProjectColor,
  type RecentProject,
} from "@/lib/projects"
import type { Project } from "./types"

function projectInitials(name: string): string {
  const cleaned = name.replace(/[._-]+/g, " ").trim()
  if (!cleaned) return "?"
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase()
  }
  const w = words[0]
  return (w.length === 1 ? w[0] : w.slice(0, 2)).toUpperCase()
}

/** Pick black or white text based on the background's perceived luminance. */
function readableTextOn(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? "#000000" : "#ffffff"
}

function tabHasWorkingAgent(tab: Project["tabs"][number]): boolean {
  return (
    tab.kind === "terminal" &&
    tab.panes.some((pane) => pane.agentStatus?.working)
  )
}

function projectHasWorkingAgent(project: Project): boolean {
  return project.tabs.some(tabHasWorkingAgent)
}

function projectHasHiddenWorkingAgent(project: Project): boolean {
  const activeTab = project.tabs.find((tab) => tab.id === project.activeTabId)
  return project.tabs.some(
    (tab) => tabHasWorkingAgent(tab) && tab.id !== activeTab?.id,
  )
}

function projectHasDoneAgent(project: Project): boolean {
  return !!project.agentDone && !projectHasWorkingAgent(project)
}

type Props = {
  projects: Project[]
  activeId: string
  recents: RecentProject[]
  onSelect: (id: string) => void
  onAdd: () => void
  onPickRecent: (recent: RecentProject) => void
  onClose?: (id: string) => void
  onCloseAllTerminals?: (id: string) => void
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
  onCloseAllTerminals?: (id: string) => void
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
  onCloseAllTerminals,
  onCloseOthers,
  onCloseToRight,
  onAdd,
  onOpenInVSCode,
}: TabItemProps) {
  const [, setColorVersion] = useState(0)
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

  const randomizeAvatarColor = () => {
    randomizeProjectColor(p.path)
    setColorVersion((v) => v + 1)
  }
  const hasWorkingAgent = isActive
    ? projectHasHiddenWorkingAgent(p)
    : projectHasWorkingAgent(p)
  const hasDoneAgent = projectHasDoneAgent(p)
  const terminalCount = p.tabs.filter((tab) => tab.kind === "terminal").length

  return (
    <ContextMenu>
      <ContextMenuTrigger
        ref={setNodeRef as unknown as React.Ref<HTMLDivElement>}
        style={style}
        onClick={() => onSelect(p.id)}
        className={cn(
          "group relative flex h-full min-w-[160px] cursor-pointer items-center gap-2 border-r border-border/60 px-3 text-xs transition-colors",
          isActive
            ? "bg-secondary text-foreground"
            : "text-foreground hover:bg-accent/40",
          isDragging && "opacity-80 shadow-lg",
        )}
        {...attributes}
        {...listeners}
      >
        {(() => {
          const bg = getProjectColor(p.path)
          return (
            <span
              aria-hidden
              style={{ backgroundColor: bg, color: readableTextOn(bg) }}
              className="grid size-4 shrink-0 place-items-center rounded-[3px] text-[9px] font-semibold leading-none"
            >
              {projectInitials(p.name)}
            </span>
          )
        })()}
        {hasWorkingAgent && <AgentSpinner className="-ml-0.5" />}
        {!hasWorkingAgent && hasDoneAgent && (
          <span
            aria-label="Coding agent done"
            title="Coding agent done"
            className="relative -ml-0.5 grid size-2.5 shrink-0 animate-bounce place-items-center"
          >
            <span className="relative size-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_1px_rgba(255,255,255,0.35)] dark:shadow-[0_0_0_1px_rgba(0,0,0,0.45)]" />
          </span>
        )}
        <span className="truncate">{p.name}</span>
        {canClose && (
          <Tooltip>
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
          onClick={() => onCloseAllTerminals?.(p.id)}
          disabled={!onCloseAllTerminals || terminalCount === 0}
        >
          Close All Terminals
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
        <ContextMenuItem onClick={randomizeAvatarColor}>
          Randomize Avatar Color
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
  onCloseAllTerminals,
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
              canClose={!!onClose}
              hasTabsToRight={i < projects.length - 1}
              onSelect={onSelect}
              onClose={onClose}
              onCloseAllTerminals={onCloseAllTerminals}
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
