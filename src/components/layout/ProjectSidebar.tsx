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
import {
  ChevronDown,
  EllipsisVertical,
  Focus,
  GitBranch,
  PanelLeft,
  Pin,
  PinOff,
  Search,
  Settings,
  X,
} from "lucide-react"
import { VSCodeIcon } from "@/components/icons/VSCodeIcon"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { store } from "@/lib/store"
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
  COMPACT_PROJECT_SIDEBAR_EVENT,
  loadCompactProjectSidebar,
  loadPinnedProjectPaths,
  loadProjectSidebarGroupOpen,
  randomizeProjectColor,
  savePinnedProjectPaths,
  saveProjectSidebarGroupOpen,
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

type SidebarGroupHeaderProps = {
  label: string
  count: number
  isOpen: boolean
  onToggle: () => void
}

function SidebarGroupHeader({
  label,
  count,
  isOpen,
  onToggle,
}: SidebarGroupHeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      className="flex h-8 w-full shrink-0 items-center justify-between rounded-sm px-2 text-[11px] font-medium text-muted-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
    >
      <span className="truncate">
        {label} <span className="text-muted-foreground/60">{count}</span>
      </span>
      <ChevronDown
        className={cn(
          "size-3.5 shrink-0 transition-transform",
          !isOpen && "-rotate-90"
        )}
      />
    </button>
  )
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
  isPinned: boolean
  onTogglePin: (path: string) => void
  compact: boolean
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
  isPinned,
  onTogglePin,
  compact,
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
    // Lock dragging to the vertical axis so rows can't overflow sideways.
    transform: CSS.Translate.toString(
      transform ? { ...transform, x: 0 } : null
    ),
    transition,
    zIndex: isDragging ? 30 : undefined,
    animationDelay: animate ? `${index * 35}ms` : undefined,
  }

  const { data } = useQuery({
    queryKey: gitQueryKey(p.path),
    queryFn: () => fetchGitQueryData(p.path),
  })
  const subtitle = data?.currentBranch ?? null
  const changeCount = data?.files.length ?? 0

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
  const hasCompletedAgent =
    !hasWorkingAgent && !hasAttentionAgent && hasDoneAgent
  const terminalCount = p.tabs.filter((tab) => tab.kind === "terminal").length

  return (
    <ContextMenu>
      <ContextMenuTrigger
        ref={setNodeRef}
        style={style}
        onClick={() => onSelect(p.id)}
        className={cn(
          "group relative flex w-full shrink-0 cursor-pointer items-center gap-2.5 rounded-sm px-2 text-left transition-colors outline-none focus:outline-none focus-visible:ring-0",
          compact ? "py-1.5 pr-8" : "py-2",
          animate &&
            "animate-in duration-200 fill-mode-both fade-in slide-in-from-left-2",
          isActive
            ? "bg-sidebar-accent text-foreground"
            : "text-foreground hover:bg-sidebar-accent/70",
          isDragging && "opacity-80 shadow-lg"
        )}
        {...attributes}
        {...listeners}
      >
        <span className="relative grid shrink-0 place-items-center rounded-[5px]">
          <ProjectAvatar
            name={p.name}
            path={p.path}
            className={cn(
              "rounded-[5px] text-[11px]",
              compact ? "size-5" : "size-6"
            )}
          />
          {hasCompletedAgent && (
            <span
              aria-label="Coding agent done"
              title="Coding agent done"
              className="gs-agent-done-dot pointer-events-none absolute -top-1 -right-1"
            />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                "min-w-0 text-sm leading-tight font-medium",
                compact
                  ? "flex-1 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,#000_calc(100%-1.25rem),transparent)]"
                  : "truncate"
              )}
            >
              {p.name}
            </span>
            {hasWorkingAgent && <AgentSpinner className="shrink-0" />}
            {hasAttentionAgent && <AgentAttention className="shrink-0" />}
          </div>
          {!compact && (
            <span className="flex min-w-0 items-center gap-1.5 text-xs leading-tight text-foreground/70">
              <span className="truncate">{subtitle ?? " "}</span>
              {changeCount > 0 && (
                <span
                  title={`${changeCount} uncommitted ${changeCount === 1 ? "change" : "changes"}`}
                  className="flex shrink-0 items-center gap-0.5 tabular-nums"
                >
                  <GitBranch className="size-3" />
                  {changeCount}
                </span>
              )}
            </span>
          )}
        </div>
        {compact && changeCount > 0 && (
          <span
            title={`${changeCount} uncommitted ${changeCount === 1 ? "change" : "changes"}`}
            className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-0.5 text-xs text-foreground/70 tabular-nums transition-opacity group-hover:opacity-0"
          >
            <GitBranch className="size-3" />
            {changeCount}
          </span>
        )}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            // Reuse the existing right-click context menu: dispatch a synthetic
            // contextmenu event on the trigger row so the same menu opens.
            const trigger = e.currentTarget.parentElement
            const rect = e.currentTarget.getBoundingClientRect()
            trigger?.dispatchEvent(
              new MouseEvent("contextmenu", {
                bubbles: true,
                clientX: rect.right,
                clientY: rect.bottom,
              })
            )
          }}
          aria-label={`${p.name} options`}
          className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-foreground/15 hover:text-foreground focus-visible:opacity-100"
        >
          <EllipsisVertical className="size-3.5" />
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[200px] whitespace-nowrap">
        {/* Primary per-project actions */}
        <ContextMenuItem onClick={() => onTogglePin(p.path)}>
          {isPinned ? (
            <PinOff className="size-3.5" />
          ) : (
            <Pin className="size-3.5" />
          )}
          {isPinned ? "Unpin Project" : "Pin Project"}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() =>
            isFocusMode ? onRemoveFromFocus?.(p.id) : onFocusProject?.(p.id)
          }
        >
          <Focus className="size-3.5" />
          {isFocusMode ? "Remove from Focus" : "Focus Mode"}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => onClose?.(p.id)}
          disabled={!canClose}
        >
          <X className="size-3.5" />
          Remove
        </ContextMenuItem>

        {/* Appearance */}
        <ContextMenuSeparator className="bg-foreground/15" />
        <ContextMenuItem onClick={chooseAvatarImage}>
          Choose Avatar Image…
        </ContextMenuItem>
        <ContextMenuItem onClick={clearAvatarImage}>
          Remove Avatar Image
        </ContextMenuItem>
        <ContextMenuItem onClick={randomizeAvatarColor}>
          Randomize Avatar Color
        </ContextMenuItem>

        {/* Bulk cleanup */}
        <ContextMenuSeparator className="bg-foreground/15" />
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

        {/* Open externally — last */}
        {(onRevealInFinder || onOpenInVSCode) && (
          <>
            <ContextMenuSeparator className="bg-foreground/15" />
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
  const [filter, setFilter] = useState("")
  const [pinnedOpen, setPinnedOpen] = useState(
    () => loadProjectSidebarGroupOpen().pinned
  )
  const [projectsOpen, setProjectsOpen] = useState(
    () => loadProjectSidebarGroupOpen().projects
  )
  const [pinnedPaths, setPinnedPaths] = useState<string[]>(() =>
    loadPinnedProjectPaths()
  )
  const [compact, setCompact] = useState(() => loadCompactProjectSidebar())
  useEffect(
    () =>
      store.onReady(() => {
        const groupOpen = loadProjectSidebarGroupOpen()
        setPinnedOpen(groupOpen.pinned)
        setProjectsOpen(groupOpen.projects)
        setPinnedPaths(loadPinnedProjectPaths())
        setCompact(loadCompactProjectSidebar())
      }),
    []
  )
  useEffect(() => {
    const onChange = (e: Event) =>
      setCompact((e as CustomEvent<boolean>).detail)
    window.addEventListener(COMPACT_PROJECT_SIDEBAR_EVENT, onChange)
    return () =>
      window.removeEventListener(COMPACT_PROJECT_SIDEBAR_EVENT, onChange)
  }, [])
  useEffect(() => {
    saveProjectSidebarGroupOpen({ pinned: pinnedOpen, projects: projectsOpen })
  }, [pinnedOpen, projectsOpen])
  const togglePin = (path: string) => {
    setPinnedPaths((prev) => {
      const next = prev.includes(path)
        ? prev.filter((p) => p !== path)
        : [...prev, path]
      savePinnedProjectPaths(next)
      return next
    })
  }
  const focusedSet = new Set(focusedProjectIds)
  const isFocusMode = projects.some((p) => focusedSet.has(p.id))
  const focusVisibleProjects = isFocusMode
    ? projects.filter((p) => focusedSet.has(p.id))
    : projects
  const normalizedFilter = filter.trim().toLowerCase()
  const filteredProjects = normalizedFilter
    ? focusVisibleProjects.filter(
        (p) =>
          p.name.toLowerCase().includes(normalizedFilter) ||
          p.path.toLowerCase().includes(normalizedFilter)
      )
    : focusVisibleProjects
  // Pinned projects form their own group above the rest; order within each
  // group still follows the master (drag-ordered) project order.
  const pinnedSet = new Set(pinnedPaths)
  const pinnedProjects = filteredProjects.filter((p) => pinnedSet.has(p.path))
  const unpinnedProjects = filteredProjects.filter(
    (p) => !pinnedSet.has(p.path)
  )
  const visibleProjects = [
    ...(pinnedOpen ? pinnedProjects : []),
    ...(projectsOpen ? unpinnedProjects : []),
  ]

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
        isFileDragOver && "bg-accent/30 ring-1 ring-primary/35 ring-inset"
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
                  className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors [-webkit-app-region:no-drag] hover:bg-foreground/15 hover:text-foreground"
                >
                  <PanelLeft className="size-3.5" />
                </button>
              }
            />
            <TooltipContent>Collapse sidebar</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="shrink-0 px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault()
                setFilter("")
                e.currentTarget.blur()
              }
            }}
            placeholder="Filter projects"
            aria-label="Filter projects"
            className="h-7 pl-7 text-xs md:text-xs"
          />
          {filter && (
            <button
              type="button"
              onClick={() => setFilter("")}
              aria-label="Clear filter"
              className="absolute top-1/2 right-1.5 grid size-4 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/15 hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-3 pb-3">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext
            items={visibleProjects.map((p) => p.id)}
            strategy={verticalListSortingStrategy}
          >
            {pinnedProjects.length > 0 && (
              <>
                <SidebarGroupHeader
                  label="Pinned"
                  count={pinnedProjects.length}
                  isOpen={pinnedOpen}
                  onToggle={() => setPinnedOpen((open) => !open)}
                />
                {pinnedOpen &&
                  pinnedProjects.map((p, i) => (
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
                      isPinned={true}
                      onTogglePin={togglePin}
                      compact={compact}
                    />
                  ))}
              </>
            )}
            <SidebarGroupHeader
              label="Projects"
              count={unpinnedProjects.length}
              isOpen={projectsOpen}
              onToggle={() => setProjectsOpen((open) => !open)}
            />
            {projectsOpen &&
              unpinnedProjects.map((p, i) => {
                const visibleIndex =
                  (pinnedOpen ? pinnedProjects.length : 0) + i
                return (
                  <ProjectSidebarRow
                    key={`${p.id}-${isFocusMode}`}
                    index={visibleIndex}
                    project={p}
                    total={projects.length}
                    isActive={p.id === activeId}
                    canClose={!!onClose}
                    hasItemsBelow={visibleIndex < visibleProjects.length - 1}
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
                    isPinned={false}
                    onTogglePin={togglePin}
                    compact={compact}
                  />
                )
              })}
          </SortableContext>
        </DndContext>
        {isFocusMode && (
          <button
            type="button"
            onClick={onExitFocus}
            aria-label="Exit focus mode"
            className={cn(
              "flex w-full items-center gap-2.5 rounded-sm px-2 text-left text-sm font-medium text-foreground transition-colors outline-none hover:bg-sidebar-accent/70 focus-visible:outline-none",
              compact ? "py-1.5" : "py-2",
              animateFocus &&
                "animate-in duration-200 fade-in slide-in-from-left-2"
            )}
          >
            <span
              className={cn(
                "grid shrink-0 place-items-center rounded-sm bg-sidebar-accent",
                compact ? "size-5" : "size-6"
              )}
            >
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
          compact={compact}
        />
      </div>
      <div className="shrink-0 px-3 pt-1.5 pb-3">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onOpenSettings}
                aria-label="Open settings"
                className="flex h-7 w-fit items-center gap-2 rounded-sm px-2 text-left text-xs text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
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
