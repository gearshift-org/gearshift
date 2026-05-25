import { useEffect, useRef, useState } from "react"
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { AddProjectMenu } from "./AddProjectMenu"
import { AgentSpinner } from "./AgentSpinner"
import {
  TAB_LABEL_CLASS,
  TAB_OPEN_TRANSITION_CLASS,
  TAB_WIDTH_CLASS,
  useTabOpenAnimation,
} from "./tabSizing"
import { randomizeProjectColor, type RecentProject } from "@/lib/projects"
import { ProjectAvatar } from "./ProjectAvatar"
import type { Project } from "./types"

function tabHasWorkingAgent(tab: Project["tabs"][number]): boolean {
  return (
    tab.kind === "terminal" &&
    tab.panes.some((pane) => pane.agentStatus?.working)
  )
}

function projectHasWorkingAgent(project: Project): boolean {
  return project.tabs.some(tabHasWorkingAgent)
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
  onRevealInFinder?: (id: string) => void
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
  onRevealInFinder?: (id: string) => void
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
  onRevealInFinder,
}: TabItemProps) {
  const [, setColorVersion] = useState(0)
  const [showSummary, setShowSummary] = useState(false)
  const [isCompact, setIsCompact] = useState(false)
  const [triggerNode, setTriggerNode] = useState<HTMLDivElement | null>(null)
  const summaryTimerRef = useRef<number | null>(null)
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const summaryTimerOpenRef = useRef(false)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: p.id })

  const openAnim = useTabOpenAnimation()
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
    ...openAnim.style,
  }

  useEffect(() => {
    return () => {
      if (summaryTimerRef.current !== null) {
        window.clearTimeout(summaryTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!triggerNode) return
    const updateCompact = () => setIsCompact(triggerNode.offsetWidth < 88)
    updateCompact()
    const observer = new ResizeObserver(updateCompact)
    observer.observe(triggerNode)
    return () => observer.disconnect()
  }, [triggerNode])

  const openSummaryAfterDelay = () => {
    if (summaryTimerRef.current !== null) {
      window.clearTimeout(summaryTimerRef.current)
    }
    summaryTimerRef.current = window.setTimeout(() => {
      summaryTimerOpenRef.current = true
      setShowSummary(true)
      summaryTimerRef.current = null
    }, 700)
  }

  const closeSummary = () => {
    if (summaryTimerRef.current !== null) {
      window.clearTimeout(summaryTimerRef.current)
      summaryTimerRef.current = null
    }
    summaryTimerOpenRef.current = false
    setShowSummary(false)
    triggerRef.current?.blur()
  }

  const handleSummaryOpenChange = (open: boolean) => {
    if (open && !summaryTimerOpenRef.current) return
    summaryTimerOpenRef.current = false
    setShowSummary(open)
    if (!open) {
      triggerRef.current?.blur()
    }
  }

  const randomizeAvatarColor = () => {
    randomizeProjectColor(p.path)
    setColorVersion((v) => v + 1)
  }
  const hasWorkingAgent = projectHasWorkingAgent(p)
  const hasDoneAgent = projectHasDoneAgent(p)
  const terminalCount = p.tabs.filter((tab) => tab.kind === "terminal").length

  return (
    <ContextMenu>
      <Popover open={showSummary} onOpenChange={handleSummaryOpenChange}>
        <PopoverTrigger
          nativeButton={false}
          render={
            <ContextMenuTrigger
              ref={(node) => {
                setNodeRef(node)
                triggerRef.current = node
                setTriggerNode(node)
              }}
              style={style}
              onClick={() => onSelect(p.id)}
              onPointerEnter={openSummaryAfterDelay}
              onPointerLeave={closeSummary}
              onPointerDown={closeSummary}
              className={cn(
                "project-tab group relative flex h-full cursor-pointer items-center gap-2 border-r border-border/60 px-3 text-xs transition-colors outline-none focus:outline-none focus-visible:ring-0 focus-visible:outline-none",
                TAB_WIDTH_CLASS,
                TAB_OPEN_TRANSITION_CLASS,
                openAnim.isOpening && "overflow-hidden",
                isActive
                  ? "bg-secondary text-foreground"
                  : "text-foreground hover:bg-accent/40",
                isDragging && "opacity-80 shadow-lg"
              )}
              {...attributes}
              {...listeners}
            >
              <div
                className={cn(
                  "project-tab-content flex min-w-0 flex-1 items-center gap-2",
                  isCompact && "justify-center"
                )}
              >
                <ProjectAvatar name={p.name} path={p.path} />
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
                <span className={cn(TAB_LABEL_CLASS, isCompact && "hidden")}>
                  {p.name}
                </span>
                {canClose && (
                  <span
                    role="button"
                    tabIndex={-1}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      onClose?.(p.id)
                    }}
                    className={cn(
                      "project-tab-close ml-auto size-5 place-items-center rounded-sm opacity-0 transition-colors group-hover:opacity-100 hover:bg-foreground/15 hover:text-foreground",
                      isCompact ? "hidden" : "grid",
                      isActive && "opacity-60"
                    )}
                  >
                    <X className="size-3.5" />
                  </span>
                )}
              </div>
            </ContextMenuTrigger>
          }
        />
        <PopoverContent className="w-auto min-w-[200px] px-3 py-2 text-xs">
          <div className="flex items-center gap-2 font-medium">
            <ProjectAvatar name={p.name} path={p.path} />
            <span className="max-w-[260px] truncate">{p.name}</span>
          </div>
          <div className="mt-1 text-muted-foreground">
            {terminalCount} {terminalCount === 1 ? "terminal" : "terminals"}
          </div>
        </PopoverContent>
      </Popover>
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
  onRevealInFinder,
  onReorder,
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
    <div className="flex h-full min-w-0 shrink items-stretch overflow-hidden [-webkit-app-region:no-drag]">
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
              onRevealInFinder={onRevealInFinder}
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
