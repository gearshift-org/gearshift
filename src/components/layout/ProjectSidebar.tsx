import { useEffect, useRef, useState } from "react"
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
import { Focus, PanelLeft, Settings, X } from "lucide-react"
import { VSCodeIcon } from "@/components/icons/VSCodeIcon"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { HistoryNavButtons } from "./HistoryNavButtons"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { fetchGitQueryData, gitQueryKey } from "@/lib/gitStatusQuery"
import {
  clearProjectAvatarImagePath,
  randomizeProjectColor,
  setProjectAvatarImagePath,
  type RecentProject,
} from "@/lib/projects"
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
  onDropFolders?: (paths: string[]) => void
  onPickRecent: (recent: RecentProject) => void
  onRemoveRecent?: (recent: RecentProject) => void
  onClose?: (id: string) => void
  onCloseAllTerminals?: (id: string) => void
  onCloseOthers?: (id: string) => void
  onCloseToRight?: (id: string) => void
  onOpenInVSCode?: (id: string) => void
  onRevealInFinder?: (id: string) => void
  onReorder?: (fromId: string, toId: string) => void
  onCollapse?: () => void
  onOpenSettings?: () => void
  focusedProjectIds?: string[]
  onFocusProject?: (id: string) => void
  onRemoveFromFocus?: (id: string) => void
  onExitFocus?: () => void
}

type RowProps = {
  project: Project
  total: number
  isActive: boolean
  canClose: boolean
  hasItemsBelow: boolean
  onSelect: (id: string) => void
  onClose?: (id: string) => void
  onCloseAllTerminals?: (id: string) => void
  onCloseOthers?: (id: string) => void
  onCloseToRight?: (id: string) => void
  onOpenInVSCode?: (id: string) => void
  onRevealInFinder?: (id: string) => void
  isFocusMode: boolean
  index: number
  animate: boolean
  onFocusProject?: (id: string) => void
  onRemoveFromFocus?: (id: string) => void
}

function ProjectSidebarRow({
  project: p,
  total,
  isActive,
  canClose,
  hasItemsBelow,
  onSelect,
  onClose,
  onCloseAllTerminals,
  onCloseOthers,
  onCloseToRight,
  onOpenInVSCode,
  onRevealInFinder,
  isFocusMode,
  index,
  animate,
  onFocusProject,
  onRemoveFromFocus,
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
    animationDelay: animate ? `${index * 35}ms` : undefined,
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

  const chooseAvatarImage = async () => {
    const imagePath = await window.dialogApi.openProjectAvatarImage()
    if (!imagePath) return
    setProjectAvatarImagePath(p.path, imagePath)
    setColorVersion((v) => v + 1)
  }

  const clearAvatarImage = () => {
    clearProjectAvatarImagePath(p.path)
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
          animate &&
            "duration-200 fill-mode-both animate-in fade-in slide-in-from-left-2",
          isActive
            ? "bg-sidebar-accent text-foreground"
            : "text-foreground hover:bg-sidebar-accent/70",
          hasWorkingAgent && "gs-agent-project-scan",
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
        {canClose && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onClose?.(p.id)
            }}
            aria-label={`Close ${p.name}`}
            className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/15 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          >
            <X className="size-3.5" />
          </button>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[200px] whitespace-nowrap">
        <ContextMenuItem onClick={() => onClose?.(p.id)} disabled={!canClose}>
          Remove
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
          Remove Projects Below
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => onCloseOthers?.(p.id)}
          disabled={total <= 1}
        >
          Remove Other Projects
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() =>
            isFocusMode ? onRemoveFromFocus?.(p.id) : onFocusProject?.(p.id)
          }
        >
          <Focus className="size-3.5" />
          {isFocusMode ? "Remove from Focus" : "Focus Mode"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={chooseAvatarImage}>
          Choose Avatar Image…
        </ContextMenuItem>
        <ContextMenuItem onClick={clearAvatarImage}>
          Remove Avatar Image
        </ContextMenuItem>
        <ContextMenuItem onClick={randomizeAvatarColor}>
          Randomize Avatar Color
        </ContextMenuItem>
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
  onDropFolders,
  onPickRecent,
  onRemoveRecent,
  onClose,
  onCloseAllTerminals,
  onCloseOthers,
  onCloseToRight,
  onOpenInVSCode,
  onRevealInFinder,
  onReorder,
  onCollapse,
  onOpenSettings,
  focusedProjectIds = [],
  onFocusProject,
  onRemoveFromFocus,
  onExitFocus,
}: Props) {
  const [isFileDragOver, setIsFileDragOver] = useState(false)
  const focusedSet = new Set(focusedProjectIds)
  const isFocusMode = projects.some((p) => focusedSet.has(p.id))
  const visibleProjects = isFocusMode
    ? projects.filter((p) => focusedSet.has(p.id))
    : projects

  // Only animate rows when focus mode is toggled — not on initial page load.
  const prevFocusModeRef = useRef(isFocusMode)
  const [animateFocus, setAnimateFocus] = useState(false)
  useEffect(() => {
    if (prevFocusModeRef.current !== isFocusMode) {
      prevFocusModeRef.current = isFocusMode
      setAnimateFocus(true)
    }
  }, [isFocusMode])
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const isFileDrag = (dataTransfer: DataTransfer | null) =>
    Array.from(dataTransfer?.types ?? []).includes("Files")

  const readDroppedPaths = (files: FileList | undefined) => {
    if (!files || files.length === 0) return []
    const paths: string[] = []
    for (let i = 0; i < files.length; i++) {
      const path = window.electronUtils.getPathForFile(files[i])
      if (path) paths.push(path)
    }
    return paths
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    setIsFileDragOver(true)
  }

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setIsFileDragOver(false)
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event.dataTransfer)) return
    event.preventDefault()
    setIsFileDragOver(false)
    const paths = readDroppedPaths(event.dataTransfer.files)
    if (paths.length > 0) onDropFolders?.(paths)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    onReorder?.(String(active.id), String(over.id))
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "flex h-full w-[248px] shrink-0 flex-col border-r border-border bg-sidebar [-webkit-app-region:no-drag]",
        isFileDragOver && "bg-accent/30 ring-1 ring-inset ring-primary/35"
      )}
    >
      {/* Reserve the top-left area for the macOS traffic lights, with the
          collapse control pinned to the right edge. */}
      <div className="flex h-[40px] shrink-0 items-center justify-end gap-0.5 pr-3 [-webkit-app-region:drag]">
        <HistoryNavButtons />
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
            items={visibleProjects.map((p) => p.id)}
            strategy={verticalListSortingStrategy}
          >
            {visibleProjects.map((p, i) => (
              <ProjectSidebarRow
                key={`${p.id}-${isFocusMode}`}
                index={i}
                project={p}
                total={projects.length}
                isActive={p.id === activeId}
                canClose={!!onClose}
                hasItemsBelow={i < visibleProjects.length - 1}
                onSelect={onSelect}
                onClose={onClose}
                onCloseAllTerminals={onCloseAllTerminals}
                onCloseOthers={onCloseOthers}
                onCloseToRight={onCloseToRight}
                onOpenInVSCode={onOpenInVSCode}
                onRevealInFinder={onRevealInFinder}
                isFocusMode={isFocusMode}
                animate={animateFocus}
                onFocusProject={onFocusProject}
                onRemoveFromFocus={onRemoveFromFocus}
              />
            ))}
          </SortableContext>
        </DndContext>
        {isFocusMode && (
          <button
            type="button"
            onClick={onExitFocus}
            aria-label="Exit focus mode"
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm font-medium text-foreground outline-none transition-colors hover:bg-sidebar-accent/70 focus-visible:outline-none",
              animateFocus &&
                "duration-200 animate-in fade-in slide-in-from-left-2"
            )}
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-sm bg-sidebar-accent">
              <Focus className="size-3.5" />
            </span>
            <span className="truncate">Exit Focus Mode</span>
          </button>
        )}
        <AddProjectMenu
          variant="sidebar"
          recents={recents}
          onOpenDialog={onAdd}
          onPickRecent={onPickRecent}
          onRemoveRecent={onRemoveRecent}
        />
      </div>
      <div className="shrink-0 px-3 pb-3 pt-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onOpenSettings}
                aria-label="Open settings"
                className="flex h-7 w-fit items-center gap-2 rounded-md px-2 text-left text-xs text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                <Settings className="size-3.5 shrink-0" />
                <span className="truncate">Settings</span>
              </button>
            }
          />
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
