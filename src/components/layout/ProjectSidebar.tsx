import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { PanelLeft } from "lucide-react"
import { VSCodeIcon } from "@/components/icons/VSCodeIcon"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { fetchGitQueryData, gitQueryKey } from "@/lib/gitStatusQuery"
import { randomizeProjectColor, type RecentProject } from "@/lib/projects"
import {
  projectHasAttentionAgent,
  projectHasDoneAgent,
  projectHasWorkingAgent,
} from "@/lib/projectAgentStatus"
import { AddProjectMenu } from "./AddProjectMenu"
import { AgentSpinner } from "./AgentSpinner"
import { AgentAttention } from "./AgentAttention"
import { ProjectAvatar } from "./ProjectAvatar"
import type { Project } from "./types"

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
  onRevealInFinder?: (id: string) => void
  onReorder?: (fromId: string, toId: string) => void
  onCollapse?: () => void
}

type RowProps = {
  project: Project
  total: number
  isActive: boolean
  canClose: boolean
  hasItemsBelow: boolean
  onSelect: (id: string) => void
  onAdd: () => void
  onClose?: (id: string) => void
  onCloseAllTerminals?: (id: string) => void
  onCloseOthers?: (id: string) => void
  onCloseToRight?: (id: string) => void
  onOpenInVSCode?: (id: string) => void
  onRevealInFinder?: (id: string) => void
}

function ProjectSidebarRow({
  project: p,
  total,
  isActive,
  canClose,
  hasItemsBelow,
  onSelect,
  onAdd,
  onClose,
  onCloseAllTerminals,
  onCloseOthers,
  onCloseToRight,
  onOpenInVSCode,
  onRevealInFinder,
}: RowProps) {
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

  const { data } = useQuery({
    queryKey: gitQueryKey(p.path),
    queryFn: () => fetchGitQueryData(p.path),
  })
  const subtitle = data?.currentBranch ?? null

  const randomizeAvatarColor = () => {
    randomizeProjectColor(p.path)
    setColorVersion((v) => v + 1)
  }

  const hasWorkingAgent = projectHasWorkingAgent(p)
  const hasAttentionAgent = !hasWorkingAgent && projectHasAttentionAgent(p)
  const hasDoneAgent = projectHasDoneAgent(p)
  const terminalCount = p.tabs.filter((tab) => tab.kind === "terminal").length

  return (
    <ContextMenu>
      <ContextMenuTrigger
        ref={setNodeRef}
        style={style}
        onClick={() => onSelect(p.id)}
        className={cn(
          "group relative flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-left outline-none transition-colors focus:outline-none focus-visible:ring-0",
          isActive
            ? "bg-secondary text-foreground"
            : "text-foreground hover:bg-accent/40",
          isDragging && "opacity-80 shadow-lg"
        )}
        {...attributes}
        {...listeners}
      >
        <ProjectAvatar
          name={p.name}
          path={p.path}
          className="size-6 rounded-sm text-[11px]"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium leading-tight">
              {p.name}
            </span>
            {hasWorkingAgent && <AgentSpinner className="shrink-0" />}
            {hasAttentionAgent && <AgentAttention className="shrink-0" />}
            {!hasWorkingAgent && !hasAttentionAgent && hasDoneAgent && (
              <span
                aria-label="Coding agent done"
                title="Coding agent done"
                className="relative grid size-2.5 shrink-0 place-items-center"
              >
                <span className="gs-status-bounce relative size-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_1px_rgba(255,255,255,0.35)] dark:shadow-[0_0_0_1px_rgba(0,0,0,0.45)]" />
              </span>
            )}
          </div>
          <span className="truncate text-xs leading-tight text-muted-foreground">
            {subtitle ?? " "}
          </span>
        </div>
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
          disabled={!hasItemsBelow}
        >
          Close Below
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
        {(onOpenInVSCode || onRevealInFinder) && (
          <>
            <ContextMenuSeparator />
            {onRevealInFinder && (
              <ContextMenuItem onClick={() => onRevealInFinder(p.id)}>
                Reveal in Finder
              </ContextMenuItem>
            )}
            {onOpenInVSCode && (
              <ContextMenuItem onClick={() => onOpenInVSCode(p.id)}>
                <VSCodeIcon className="size-3.5" />
                Open in VSCode
              </ContextMenuItem>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function ProjectSidebar({
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
  onRevealInFinder,
  onReorder,
  onCollapse,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    onReorder?.(String(active.id), String(over.id))
  }

  return (
    <div className="flex h-full w-[248px] shrink-0 flex-col border-r border-border bg-sidebar [-webkit-app-region:no-drag]">
      {/* Reserve the top-left area for the macOS traffic lights, with the
          collapse control pinned to the right edge. */}
      <div className="flex h-[40px] shrink-0 items-center justify-end pr-3 [-webkit-app-region:drag]">
        {onCollapse && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={onCollapse}
                  aria-label="Collapse sidebar"
                  className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/15 hover:text-foreground [-webkit-app-region:no-drag]"
                >
                  <PanelLeft className="size-3.5" />
                </button>
              }
            />
            <TooltipContent>Collapse sidebar</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext
            items={projects.map((p) => p.id)}
            strategy={verticalListSortingStrategy}
          >
            {projects.map((p, i) => (
              <ProjectSidebarRow
                key={p.id}
                project={p}
                total={projects.length}
                isActive={p.id === activeId}
                canClose={!!onClose}
                hasItemsBelow={i < projects.length - 1}
                onSelect={onSelect}
                onAdd={onAdd}
                onClose={onClose}
                onCloseAllTerminals={onCloseAllTerminals}
                onCloseOthers={onCloseOthers}
                onCloseToRight={onCloseToRight}
                onOpenInVSCode={onOpenInVSCode}
                onRevealInFinder={onRevealInFinder}
              />
            ))}
          </SortableContext>
        </DndContext>
        <AddProjectMenu
          variant="sidebar"
          recents={recents}
          onOpenDialog={onAdd}
          onPickRecent={onPickRecent}
        />
      </div>
    </div>
  )
}
