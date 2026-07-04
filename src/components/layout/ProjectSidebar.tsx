import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
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
  ArrowDownUp,
  ChevronDown,
  ChevronsUpDown,
  EllipsisVertical,
  Focus,
  FolderInput,
  GitBranch,
  Layers2,
  MessageSquare,
  PanelLeft,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { VSCodeIcon } from "@/components/icons/VSCodeIcon"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { fetchGitQueryData, gitQueryKey } from "@/lib/gitStatusQuery"
import {
  clearProjectAvatarImagePath,
  loadPinnedProjectPaths,
  loadProjectSidebarGroupOpen,
  loadProjectSidebarSort,
  DEFAULT_SPACE_ID,
  DEFAULT_SPACE_NAME,
  getProjectColor,
  randomizeProjectColor,
  setProjectColor,
  savePinnedProjectPaths,
  saveProjectSidebarGroupOpen,
  saveProjectSidebarSort,
  setProjectAvatarImagePath,
  type ProjectSortMode,
  type RecentProject,
  type StoredSpace,
} from "@/lib/projects"
import {
  projectHasAttentionAgent,
  projectHasDoneAgent,
  projectHasWorkingAgent,
} from "@/lib/projectAgentStatus"
import { useActionAccelerator } from "@/lib/keybindings/useKeybindings"
import { AddProjectMenu } from "./AddProjectMenu"
import { AgentSpinner } from "./AgentSpinner"
import { ProjectAvatar } from "./ProjectAvatar"
import type { Project } from "./types"

type Props = {
  projects: Project[]
  activeId: string
  spaces: StoredSpace[]
  activeSpaceId: string
  chatActive?: boolean
  recents: RecentProject[]
  onSelect: (id: string) => void
  onSelectSpace: (id: string) => void
  onOpenSpaceChat?: () => void
  onCreateSpace: (name?: string) => string | null
  onRenameSpace: (id: string, name: string) => boolean
  onDeleteSpace: (id: string) => boolean
  onMoveProjectToSpace: (projectId: string, spaceId: string) => void
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
  onOpenCommandPalette?: () => void
  onOpenSettings?: () => void
  focusedProjectIds?: string[]
  onFocusProject?: (id: string) => void
  onRemoveFromFocus?: (id: string) => void
  onExitFocus?: () => void
}

function SpaceSwitcher({
  spaces,
  activeSpaceId,
  onSelectSpace,
  onOpenCreateSpace,
  onOpenSpaceSettings,
}: {
  spaces: StoredSpace[]
  activeSpaceId: string
  onSelectSpace: (id: string) => void
  onOpenCreateSpace: () => void
  onOpenSpaceSettings: () => void
}) {
  const activeSpace =
    spaces.find((space) => space.id === activeSpaceId) ?? spaces[0]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch space"
        className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm font-medium text-sidebar-foreground transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[popup-open]:bg-sidebar-accent data-[popup-open]:text-sidebar-accent-foreground"
      >
        <Layers2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">
          {activeSpace?.name ?? DEFAULT_SPACE_NAME}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[220px]">
        <DropdownMenuRadioGroup
          value={activeSpaceId}
          onValueChange={onSelectSpace}
        >
          {spaces.map((space) => (
            <DropdownMenuRadioItem key={space.id} value={space.id}>
              {space.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOpenSpaceSettings}>
          <Settings className="size-3.5" />
          Space Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenCreateSpace}>
          <Plus className="size-3.5" />
          New Space
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SpaceSettingsDialog({
  open,
  space,
  onOpenChange,
  onRename,
  onDelete,
}: {
  open: boolean
  space: StoredSpace | undefined
  onOpenChange: (open: boolean) => void
  onRename: (id: string, name: string) => boolean
  onDelete: (id: string) => boolean
}) {
  const [name, setName] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (open) {
      setName(space?.name ?? "")
      setConfirmDelete(false)
    }
  }, [open, space?.name])

  const close = () => {
    setName(space?.name ?? "")
    setConfirmDelete(false)
    onOpenChange(false)
  }

  const submit = () => {
    const trimmed = name.trim()
    if (!space || !trimmed) return
    if (onRename(space.id, trimmed)) {
      onOpenChange(false)
    }
  }

  const unchanged = name.trim() === (space?.name ?? "")
  const canDelete = !!space && space.id !== DEFAULT_SPACE_ID

  const deleteSpace = () => {
    if (!space || !canDelete) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    if (onDelete(space.id)) {
      close()
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) onOpenChange(true)
        else close()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Space Settings</DialogTitle>
          <DialogDescription>
            Rename the current space or delete it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Space name"
            aria-label="Space name"
          />
          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Delete Space</p>
              <p className="text-xs text-muted-foreground">
                Projects in this space will move back to the default space.
              </p>
            </div>
            <Button
              type="button"
              variant="destructive"
              onClick={deleteSpace}
              disabled={!canDelete}
              className="self-start"
            >
              <Trash2 data-icon="inline-start" />
              {confirmDelete ? "Confirm Delete" : "Delete Space"}
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || unchanged}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CreateSpaceDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (name: string) => void
}) {
  const [name, setName] = useState("")

  const close = () => {
    setName("")
    onOpenChange(false)
  }

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onCreate(trimmed)
    setName("")
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) onOpenChange(true)
        else close()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Space</DialogTitle>
          <DialogDescription>
            Create a space to group related projects.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Work, Personal, Client..."
            aria-label="Space name"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type SidebarGroupHeaderProps = {
  label: string
  isOpen: boolean
  onToggle: () => void
  action?: React.ReactNode
  collapsible?: boolean
}

function SidebarGroupHeader({
  label,
  isOpen,
  onToggle,
  action,
  collapsible = true,
}: SidebarGroupHeaderProps) {
  return (
    <div
      role={collapsible ? "button" : undefined}
      tabIndex={collapsible ? 0 : undefined}
      aria-expanded={collapsible ? isOpen : undefined}
      onClick={collapsible ? onToggle : undefined}
      onKeyDown={(e) => {
        if (!collapsible) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onToggle()
        }
      }}
      className={cn(
        "group/group-header flex h-8 w-full shrink-0 items-center justify-between gap-1 pr-1 pl-2 outline-none select-none",
        collapsible ? "cursor-pointer" : "cursor-default"
      )}
    >
      <span className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-muted-foreground/80 transition-colors group-hover/group-header:text-foreground">
        <span className="truncate">{label}</span>
        {collapsible && (
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 opacity-0 transition-[transform,opacity] group-hover/group-header:opacity-100",
              !isOpen && "-rotate-90"
            )}
          />
        )}
      </span>
      {action && (
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          {action}
        </div>
      )}
    </div>
  )
}

function ProjectSortMenu({
  mode,
  onChange,
}: {
  mode: ProjectSortMode
  onChange: (mode: ProjectSortMode) => void
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              aria-label="Sort projects"
              className="grid size-5 place-items-center rounded-sm text-muted-foreground/80 transition-colors outline-none hover:text-foreground data-[popup-open]:text-foreground"
            >
              <ArrowDownUp className="size-3.5" />
            </DropdownMenuTrigger>
          }
        />
        <TooltipContent>Sort projects</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(v) => onChange(v as ProjectSortMode)}
        >
          <DropdownMenuRadioItem value="manual">Manual</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="recent">
            Most recent
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
  dragDisabled: boolean
  spaces: StoredSpace[]
  onOpenCreateSpace: (projectId?: string) => void
  onMoveProjectToSpace: (projectId: string, spaceId: string) => void
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
  dragDisabled,
  spaces,
  onOpenCreateSpace,
  onMoveProjectToSpace,
}: RowProps) {
  const [, setColorVersion] = useState(0)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: p.id, disabled: dragDisabled })

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
  const changeCount = data?.files.length ?? 0

  const randomizeAvatarColor = () => {
    randomizeProjectColor(p.path)
    setColorVersion((v) => v + 1)
  }

  // Hidden native color input; the "Choose Avatar Color" menu item clicks it
  // to open the OS color picker. Updates apply live while picking.
  const colorInputRef = useRef<HTMLInputElement>(null)
  const chooseAvatarColor = () => {
    const input = colorInputRef.current
    if (!input) return
    input.value = getProjectColor(p.path)
    input.click()
  }
  const onAvatarColorPicked = (color: string) => {
    setProjectColor(p.path, color)
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
  const hasStatusDot = hasAttentionAgent || hasCompletedAgent
  const terminalCount = p.tabs.filter((tab) => tab.kind === "terminal").length

  return (
    <ContextMenu>
      <ContextMenuTrigger
        ref={setNodeRef}
        style={style}
        onClick={() => onSelect(p.id)}
        className={cn(
          "group relative flex w-full shrink-0 cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 pr-11 text-left transition-colors outline-none focus:outline-none focus-visible:ring-0",
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
            className="size-5 rounded-[5px] text-[11px]"
          />
          {/* Hidden native color input for "Choose Avatar Color". Lives
              outside the menu content so it stays mounted (and the picker
              stays open) after the context menu closes. */}
          {/* Anchored a small gap right of the avatar so the OS picker popup
              opens beside it instead of covering the avatar being edited. */}
          <input
            ref={colorInputRef}
            type="color"
            className="pointer-events-none absolute top-1 left-9 size-0 opacity-0"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => onAvatarColorPicked(e.target.value)}
          />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-sm leading-tight font-medium">
              {p.name}
            </span>
          </div>
        </div>
        {changeCount > 0 && !hasWorkingAgent && !hasStatusDot && (
          <span
            title={`${changeCount} uncommitted ${changeCount === 1 ? "change" : "changes"}`}
            className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-0.5 text-xs text-foreground/70 tabular-nums transition-opacity group-hover:opacity-0"
          >
            <GitBranch className="size-3" />
            {changeCount}
          </span>
        )}
        {hasAttentionAgent && (
          <span
            aria-label="Coding agent needs attention"
            title="Coding agent needs attention"
            className="gs-agent-attention-dot pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 transition-opacity group-hover:opacity-0"
          />
        )}
        {hasCompletedAgent && (
          <span
            aria-label="Coding agent done"
            title="Coding agent done"
            className="gs-agent-done-dot pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 transition-opacity group-hover:opacity-0"
          />
        )}
        {hasWorkingAgent && (
          <span className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center transition-opacity group-hover:opacity-0">
            <AgentSpinner />
          </span>
        )}
        <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onTogglePin(p.path)
                  }}
                  aria-label={isPinned ? `Unpin ${p.name}` : `Pin ${p.name}`}
                  className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {isPinned ? (
                    <PinOff className="size-3.5" />
                  ) : (
                    <Pin className="size-3.5" />
                  )}
                </button>
              }
            />
            <TooltipContent>
              {isPinned ? "Unpin project" : "Pin project"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    // Reuse the existing right-click context menu: dispatch a
                    // synthetic contextmenu event on the trigger row.
                    const trigger = e.currentTarget.closest(
                      '[data-slot="context-menu-trigger"]'
                    )
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
                  className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <EllipsisVertical className="size-3.5" />
                </button>
              }
            />
            <TooltipContent>More options</TooltipContent>
          </Tooltip>
        </div>
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
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderInput className="size-3.5" />
            Move to Space
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-[180px]">
            <ContextMenuRadioGroup
              value={p.spaceId}
              onValueChange={(spaceId) => onMoveProjectToSpace(p.id, spaceId)}
            >
              {spaces.map((space) => (
                <ContextMenuRadioItem key={space.id} value={space.id}>
                  {space.name}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onOpenCreateSpace(p.id)}>
              <Plus className="size-3.5" />
              New Space
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem onClick={() => onClose?.(p.id)} disabled={!canClose}>
          <X className="size-3.5" />
          Remove
        </ContextMenuItem>

        {/* Appearance */}
        <ContextMenuSeparator className="bg-foreground/15" />
        <ContextMenuItem onClick={chooseAvatarImage}>
          Choose Avatar Image
        </ContextMenuItem>
        <ContextMenuItem onClick={clearAvatarImage}>
          Remove Avatar Image
        </ContextMenuItem>
        <ContextMenuItem onClick={chooseAvatarColor}>
          Choose Avatar Color
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
        <ContextMenuSeparator className="bg-foreground/15" />
        <ContextMenuItem
          onClick={() => {
            void navigator.clipboard.writeText(p.path)
            toast.success("Copied project path")
          }}
        >
          Copy Project Path
        </ContextMenuItem>
        {(onRevealInFinder || onOpenInVSCode) && (
          <>
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
  spaces,
  activeSpaceId,
  chatActive = false,
  recents,
  onSelect,
  onSelectSpace,
  onOpenSpaceChat,
  onCreateSpace,
  onRenameSpace,
  onDeleteSpace,
  onMoveProjectToSpace,
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
  onOpenCommandPalette,
  onOpenSettings,
  focusedProjectIds = [],
  onFocusProject,
  onRemoveFromFocus,
  onExitFocus,
}: Props) {
  const collapseShortcut = useActionAccelerator("projectSidebar.toggle")
  const paletteShortcut = useActionAccelerator("palette.open")
  const [isFileDragOver, setIsFileDragOver] = useState(false)
  const [filter, setFilter] = useState("")
  const [createSpaceOpen, setCreateSpaceOpen] = useState(false)
  const [spaceSettingsOpen, setSpaceSettingsOpen] = useState(false)
  const [moveAfterCreateProjectId, setMoveAfterCreateProjectId] = useState<
    string | null
  >(null)
  const [pinnedOpen, setPinnedOpen] = useState(
    () => loadProjectSidebarGroupOpen().pinned
  )
  const [projectsOpen, setProjectsOpen] = useState(
    () => loadProjectSidebarGroupOpen().projects
  )
  const [pinnedPaths, setPinnedPaths] = useState<string[]>(() =>
    loadPinnedProjectPaths()
  )
  const [sortMode, setSortMode] = useState<ProjectSortMode>(() =>
    loadProjectSidebarSort()
  )
  useEffect(
    () =>
      store.onReady(() => {
        const groupOpen = loadProjectSidebarGroupOpen()
        setPinnedOpen(groupOpen.pinned)
        setProjectsOpen(groupOpen.projects)
        setPinnedPaths(loadPinnedProjectPaths())
        setSortMode(loadProjectSidebarSort())
      }),
    []
  )
  const changeSortMode = (mode: ProjectSortMode) => {
    setSortMode(mode)
    saveProjectSidebarSort(mode)
  }
  // Most-recent sort: order projects by local project activity, falling back to
  // the latest chat-message timestamp when chat history has newer data.
  const queryClient = useQueryClient()
  const latestByProjectKey = ["history", "latestByProject"]
  const { data: latestByProject } = useQuery({
    queryKey: latestByProjectKey,
    queryFn: () => window.term.history.latestByProject(),
    enabled: sortMode === "recent",
    refetchInterval: sortMode === "recent" ? 60000 : false,
  })
  // Reorder instantly when a message is submitted in any project — mirror the
  // History panel's live append subscription instead of waiting for a refetch.
  const projectIdsKey = projects.map((p) => p.id).join(",")
  useEffect(() => {
    if (sortMode !== "recent") return
    const ids = projectIdsKey ? projectIdsKey.split(",") : []
    const offs = ids.map((id) =>
      window.term.history.onProjectAppended(id, (msg) => {
        queryClient.setQueryData<Record<string, number>>(
          latestByProjectKey,
          (prev) => ({ ...(prev ?? {}), [id]: msg.createdAt })
        )
      })
    )
    return () => offs.forEach((off) => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortMode, projectIdsKey, queryClient])
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
  // Pinned projects form their own group above the rest. In manual mode each
  // group follows the master (drag-ordered) order; in recent mode each group
  // is ordered by latest activity (projects with no chat history sort last,
  // keeping their relative manual order via a stable sort).
  const sortByMode = (list: Project[]) => {
    if (sortMode !== "recent") return list
    const ts = latestByProject ?? {}
    const activityAt = (project: Project) =>
      Math.max(project.updatedAt ?? 0, ts[project.id] ?? 0)
    return [...list].sort((a, b) => activityAt(b) - activityAt(a))
  }
  const pinnedSet = new Set(pinnedPaths)
  const pinnedProjects = sortByMode(
    filteredProjects.filter((p) => pinnedSet.has(p.path))
  )
  const unpinnedProjects = sortByMode(
    filteredProjects.filter((p) => !pinnedSet.has(p.path))
  )
  const hasPinnedProjects = focusVisibleProjects.some((p) =>
    pinnedSet.has(p.path)
  )
  const hasUnpinnedProjects = focusVisibleProjects.some(
    (p) => !pinnedSet.has(p.path)
  )
  const hasAnyPinnedProjects = projects.some((p) => pinnedSet.has(p.path))
  const hasAnyUnpinnedProjects = projects.some((p) => !pinnedSet.has(p.path))
  const pinnedGroupOpen = hasPinnedProjects ? pinnedOpen : true
  const projectsGroupOpen = hasUnpinnedProjects ? projectsOpen : true
  const dragDisabled = sortMode !== "manual"
  const visibleProjects = [
    ...(pinnedGroupOpen ? pinnedProjects : []),
    ...(projectsGroupOpen ? unpinnedProjects : []),
  ]

  useEffect(() => {
    if (!hasAnyPinnedProjects && !pinnedOpen) setPinnedOpen(true)
    if (!hasAnyUnpinnedProjects && !projectsOpen) setProjectsOpen(true)
  }, [hasAnyPinnedProjects, hasAnyUnpinnedProjects, pinnedOpen, projectsOpen])

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

  const openCreateSpaceDialog = (projectId?: string) => {
    setMoveAfterCreateProjectId(projectId ?? null)
    setCreateSpaceOpen(true)
  }

  const createSpaceFromDialog = (name: string) => {
    const spaceId = onCreateSpace(name)
    if (!spaceId) return
    if (moveAfterCreateProjectId) {
      onMoveProjectToSpace(moveAfterCreateProjectId, spaceId)
    }
    setMoveAfterCreateProjectId(null)
    setCreateSpaceOpen(false)
  }

  const activeSpace =
    spaces.find((space) => space.id === activeSpaceId) ?? spaces[0]

  return (
    <>
      <SpaceSettingsDialog
        open={spaceSettingsOpen}
        space={activeSpace}
        onOpenChange={setSpaceSettingsOpen}
        onRename={onRenameSpace}
        onDelete={onDeleteSpace}
      />
      <CreateSpaceDialog
        open={createSpaceOpen}
        onOpenChange={(open) => {
          setCreateSpaceOpen(open)
          if (!open) setMoveAfterCreateProjectId(null)
        }}
        onCreate={createSpaceFromDialog}
      />
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "flex h-full w-full shrink-0 flex-col border-r border-border bg-sidebar [-webkit-app-region:no-drag]",
          isFileDragOver && "bg-accent/30 ring-1 ring-primary/35 ring-inset"
        )}
      >
        {/* Reserve the top-left area for the macOS traffic lights. A search
          control sits just past them; the nav/collapse controls are pinned to
          the right edge. */}
        <div className="flex h-[34px] shrink-0 items-center justify-between gap-0.5 pr-3 [-webkit-app-region:drag]">
          <div className="flex items-center [-webkit-app-region:no-drag]">
            <div className="w-[88px] shrink-0 self-stretch [-webkit-app-region:drag]" />
            {onOpenCommandPalette && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={onOpenCommandPalette}
                      aria-label="Search"
                      className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/15 hover:text-foreground"
                    >
                      <Search className="size-3.5" />
                    </button>
                  }
                />
                <TooltipContent>
                  {"Search" + (paletteShortcut ? ` (${paletteShortcut})` : "")}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="flex items-center gap-0.5 [-webkit-app-region:no-drag]">
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
                <TooltipContent>
                  {"Collapse sidebar" +
                    (collapseShortcut ? ` (${collapseShortcut})` : "")}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        <div className="shrink-0 px-3 pt-2 pb-2">
          <div className="flex flex-col gap-3">
            {/* Space switcher + Chat form one tight group; the filter sits
                further below so it reads as a separate control. */}
            <div className="flex flex-col gap-0.5">
              <SpaceSwitcher
                spaces={spaces}
                activeSpaceId={activeSpaceId}
                onSelectSpace={onSelectSpace}
                onOpenCreateSpace={() => openCreateSpaceDialog()}
                onOpenSpaceSettings={() => setSpaceSettingsOpen(true)}
              />
              {onOpenSpaceChat && (
                <button
                  type="button"
                  onClick={onOpenSpaceChat}
                  aria-current={chatActive ? "page" : undefined}
                  className={cn(
                    "flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none",
                    chatActive &&
                      "bg-sidebar-accent text-sidebar-accent-foreground"
                  )}
                >
                  <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">Chat</span>
                </button>
              )}
            </div>
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
                // Use the sidebar's own border token (not the global --input) so the
                // resting border stays subtle against the sidebar surface in every
                // theme — some light themes set --input to pure white, which pops on
                // the grey sidebar.
                className="h-7 border-sidebar-border pl-7 text-xs md:text-xs"
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
                    isOpen={pinnedGroupOpen}
                    onToggle={() => setPinnedOpen((open) => !open)}
                    collapsible={hasPinnedProjects}
                  />
                  {pinnedGroupOpen &&
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
                        dragDisabled={dragDisabled}
                        spaces={spaces}
                        onOpenCreateSpace={openCreateSpaceDialog}
                        onMoveProjectToSpace={onMoveProjectToSpace}
                      />
                    ))}
                </>
              )}
              <SidebarGroupHeader
                label="Projects"
                isOpen={projectsGroupOpen}
                onToggle={() => setProjectsOpen((open) => !open)}
                collapsible={hasUnpinnedProjects}
                action={
                  <div className="flex items-center gap-0.5">
                    <ProjectSortMenu
                      mode={sortMode}
                      onChange={changeSortMode}
                    />
                    <AddProjectMenu
                      variant="sidebar-icon"
                      recents={recents}
                      onOpenDialog={onAdd}
                      onPickRecent={onPickRecent}
                      onRemoveRecent={onRemoveRecent}
                    />
                  </div>
                }
              />
              {projectsGroupOpen &&
                unpinnedProjects.map((p, i) => {
                  const visibleIndex =
                    (pinnedGroupOpen ? pinnedProjects.length : 0) + i
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
                      dragDisabled={dragDisabled}
                      spaces={spaces}
                      onOpenCreateSpace={openCreateSpaceDialog}
                      onMoveProjectToSpace={onMoveProjectToSpace}
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
                "flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm leading-tight font-medium text-foreground transition-colors outline-none hover:bg-sidebar-accent/70 focus-visible:outline-none",
                animateFocus &&
                  "animate-in duration-200 fade-in slide-in-from-left-2"
              )}
            >
              <span className="grid size-5 shrink-0 place-items-center rounded-sm bg-sidebar-accent">
                <Focus className="size-3.5" />
              </span>
              <span className="truncate">Exit Focus Mode</span>
            </button>
          )}
        </div>
        <div className="shrink-0 px-3 pt-1.5 pb-3">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={onOpenSettings}
                  aria-label="Open settings"
                  className="flex h-7 w-fit items-center gap-2 rounded-sm px-2 text-left text-sm leading-tight font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
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
    </>
  )
}
