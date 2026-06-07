import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Columns2, Eye, FileCode, Rows3 } from "lucide-react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import logoGrayUrl from "@/assets/logo-gray.svg?url"
import { cn } from "@/lib/utils"
import { KeyChip } from "@/components/keybindings/KeyChip"
import { useKeybindings } from "@/lib/keybindings/useKeybindings"
import { TerminalView } from "./TerminalView"
import { SingleFileDiff } from "./SingleFileDiff"
import {
  FilePreview,
  isAudioPath,
  isImagePath,
  isMarkdownPath,
  readMdMode,
  writeMdMode,
  type MdMode,
} from "./FilePreview"
import { PaneHeader, PaneHeaderPreview } from "./PaneHeader"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { loadDiffViewMode, saveDiffViewMode } from "@/lib/projects"
import { store } from "@/lib/store"
import { tabDisplayName } from "./terminalName"
import {
  ensureLayout,
  nodeKey,
  orderedPaneIds,
  updateSplitSizes,
} from "./terminalLayout"
import type {
  DropZone,
  FileReveal,
  Project,
  TerminalAgentStatus,
  TerminalLayout,
  TerminalPane as TerminalPaneType,
  TerminalTab,
  WorkspaceTab,
} from "./types"

type Props = {
  project: Project | undefined
  isActive?: boolean
  activeTabId?: string
  terminalFocusRequest?: {
    tabId: string
    paneId: string
    nonce: number
  } | null
  onTitleChange?: (tabId: string, paneId: string, title: string) => void
  onAgentStatusChange?: (
    tabId: string,
    paneId: string,
    status: TerminalAgentStatus
  ) => void
  onStartTerminal?: (tabId: string, paneId: string) => void
  onAddTerminal?: () => void
  onSplitTerminal?: (tabId: string, direction: "horizontal" | "vertical") => void
  onClosePane?: (tabId: string, paneId: string) => void
  onFocusPane?: (tabId: string, paneId: string) => void
  onTerminalFocusChange?: (
    tabId: string,
    paneId: string,
    focused: boolean
  ) => void
  onRenamePane?: (tabId: string, paneId: string, name: string) => void
  onDropPane?: (
    tabId: string,
    movingPaneId: string,
    targetPaneId: string,
    zone: DropZone
  ) => void
  onLayoutChange?: (tabId: string, layout: TerminalLayout) => void
  onExtractPaneToTab?: (tabId: string, paneId: string) => void
  onOpenFile?: (path: string) => void
  fileReveal?: FileReveal | null
}

function TerminalPaneView({
  tab,
  pane,
  cwd,
  isTabActive,
  focusRequest,
  onTitleChange,
  onAgentStatusChange,
  onStartTerminal,
  onClosePane,
  onFocus,
  onTerminalFocusChange,
}: {
  tab: TerminalTab
  pane: TerminalPaneType
  cwd?: string
  isTabActive: boolean
  focusRequest?: number
  onTitleChange?: (tabId: string, paneId: string, title: string) => void
  onAgentStatusChange?: (
    tabId: string,
    paneId: string,
    status: TerminalAgentStatus
  ) => void
  onStartTerminal?: (tabId: string, paneId: string) => void
  onClosePane?: (tabId: string, paneId: string) => void
  onFocus?: () => void
  onTerminalFocusChange?: (paneId: string, focused: boolean) => void
}) {
  if (pane.pendingStart) {
    return (
      <div onClick={onFocus} className="grid h-full place-items-center bg-card">
        <div className="flex flex-col items-center gap-3 text-xs text-muted-foreground">
          <span>"{tab.customName ?? tab.name}" is not running.</span>
          <button
            onClick={() => onStartTerminal?.(tab.id, pane.id)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-accent/40"
          >
            Start terminal
          </button>
        </div>
      </div>
    )
  }
  return (
    <div onMouseDown={onFocus} className="h-full">
      <TerminalView
        sessionId={pane.sessionId ?? pane.id}
        cwd={cwd}
        isActive={isTabActive && tab.activePaneId === pane.id}
        paneCount={tab.panes.length}
        focusRequest={focusRequest}
        onTitleChange={(title) => onTitleChange?.(tab.id, pane.id, title)}
        onFocusChange={(focused) => onTerminalFocusChange?.(pane.id, focused)}
        initialAgentStatus={pane.agentStatus}
        onAgentStatusChange={(status) =>
          onAgentStatusChange?.(tab.id, pane.id, status)
        }
        onClose={() => onClosePane?.(tab.id, pane.id)}
      />
    </div>
  )
}

// Five drop regions per pane. `hit` is the (invisible) area that registers the
// drop; `preview` is the landing region drawn while hovering. The hit areas
// tile the pane with no gaps/overlap so exactly one matches the pointer.
const DROP_ZONES: { zone: DropZone; hit: string; preview: string }[] = [
  { zone: "top", hit: "inset-x-0 top-0 h-[30%]", preview: "inset-x-0 top-0 h-1/2" },
  {
    zone: "bottom",
    hit: "inset-x-0 bottom-0 h-[30%]",
    preview: "inset-x-0 bottom-0 h-1/2",
  },
  { zone: "left", hit: "inset-y-[30%] left-0 w-[30%]", preview: "inset-y-0 left-0 w-1/2" },
  {
    zone: "right",
    hit: "inset-y-[30%] right-0 w-[30%]",
    preview: "inset-y-0 right-0 w-1/2",
  },
  { zone: "center", hit: "inset-[30%]", preview: "inset-0" },
]

/** Encodes a pane + drop region into a droppable id, e.g. "pane123::left". */
function dropId(paneId: string, zone: DropZone) {
  return `${paneId}::${zone}`
}

function parseDropId(id: string): { paneId: string; zone: DropZone } {
  const sep = id.lastIndexOf("::")
  const zone = id.slice(sep + 2)
  return {
    paneId: id.slice(0, sep),
    zone: zone === "header" ? "center" : (zone as DropZone),
  }
}

function EdgeZone({
  paneId,
  zone,
  hit,
  preview,
  enabled,
}: {
  paneId: string
  zone: DropZone
  hit: string
  preview: string
  enabled: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId(paneId, zone) })
  return (
    <>
      <div ref={setNodeRef} className={cn("pointer-events-none absolute", hit)} />
      {enabled && isOver ? (
        <div
          className={cn(
            "pointer-events-none absolute z-20 rounded-sm bg-foreground/15 ring-2 ring-foreground/50 ring-inset",
            preview
          )}
        />
      ) : null}
    </>
  )
}

function HeaderDropZone({
  paneId,
  enabled,
  children,
}: {
  paneId: string
  enabled: boolean
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${paneId}::header` })
  return (
    <div ref={setNodeRef} className="relative shrink-0">
      {children}
      {enabled && isOver ? (
        <div className="pointer-events-none absolute inset-0 z-20 rounded-sm bg-foreground/15 ring-2 ring-foreground/50 ring-inset" />
      ) : null}
    </div>
  )
}

/**
 * Wraps a pane with the five directional drop regions so a dragged terminal can
 * be dropped on the body edge to split, or the body center to swap. Pane headers
 * have their own center-only drop region so header-to-header drops always swap.
 */
function PaneDropZone({
  paneId,
  enabled,
  children,
}: {
  paneId: string
  enabled: boolean
  children: ReactNode
}) {
  return (
    <div className="relative min-h-0 flex-1">
      {children}
      {DROP_ZONES.map((z) => (
        <EdgeZone
          key={z.zone}
          paneId={paneId}
          zone={z.zone}
          hit={z.hit}
          preview={z.preview}
          enabled={enabled}
        />
      ))}
    </div>
  )
}

function TerminalTabContent({
  tab,
  cwd,
  isActive,
  focusRequest,
  onTitleChange,
  onAgentStatusChange,
  onStartTerminal,
  onSplitTerminal,
  onClosePane,
  onFocusPane,
  onTerminalFocusChange,
  onRenamePane,
  onDropPane,
  onLayoutChange,
  onExtractPaneToTab,
}: {
  tab: TerminalTab
  cwd?: string
  isActive: boolean
  focusRequest?: {
    tabId: string
    paneId: string
    nonce: number
  } | null
  onTitleChange?: (tabId: string, paneId: string, title: string) => void
  onAgentStatusChange?: (
    tabId: string,
    paneId: string,
    status: TerminalAgentStatus
  ) => void
  onStartTerminal?: (tabId: string, paneId: string) => void
  onSplitTerminal?: (tabId: string, direction: "horizontal" | "vertical") => void
  onClosePane?: (tabId: string, paneId: string) => void
  onFocusPane?: (tabId: string, paneId: string) => void
  onTerminalFocusChange?: (
    tabId: string,
    paneId: string,
    focused: boolean
  ) => void
  onRenamePane?: (tabId: string, paneId: string, name: string) => void
  onDropPane?: (
    tabId: string,
    movingPaneId: string,
    targetPaneId: string,
    zone: DropZone
  ) => void
  onLayoutChange?: (tabId: string, layout: TerminalLayout) => void
  onExtractPaneToTab?: (tabId: string, paneId: string) => void
}) {
  const multi = tab.panes.length > 1
  const layout = ensureLayout(
    tab.layout,
    tab.panes.map((p) => p.id)
  )
  const orderedIds = orderedPaneIds(layout)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const [draggingPaneId, setDraggingPaneId] = useState<string | null>(null)
  const [tabBarDropRect, setTabBarDropRect] = useState<DOMRect | null>(null)
  const [focusedTerminalPaneId, setFocusedTerminalPaneId] = useState<string | null>(null)
  const draggingPane = draggingPaneId
    ? tab.panes.find((p) => p.id === draggingPaneId)
    : undefined

  useEffect(() => {
    if (!isActive) setFocusedTerminalPaneId(null)
  }, [isActive])

  const handleTerminalFocusChange = useCallback(
    (paneId: string, focused: boolean) => {
      setFocusedTerminalPaneId((current) => {
        if (focused) return paneId
        return current === paneId ? null : current
      })
      onTerminalFocusChange?.(tab.id, paneId, focused)
    },
    [onTerminalFocusChange, tab.id]
  )

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingPaneId(String(event.active.id))
    setTabBarDropRect(null)
  }

  const tabBarDropTarget = (event: DragMoveEvent | DragEndEvent) => {
    const activator = event.activatorEvent
    if (!(activator instanceof MouseEvent || activator instanceof PointerEvent)) {
      return null
    }
    const x = activator.clientX + event.delta.x
    const y = activator.clientY + event.delta.y
    for (const el of document.elementsFromPoint(x, y)) {
      const target = el.closest('[data-terminal-tab-drop-target="true"]')
      if (target instanceof HTMLElement) return target
    }
    return null
  }

  const handleDragMove = (event: DragMoveEvent) => {
    setTabBarDropRect(tabBarDropTarget(event)?.getBoundingClientRect() ?? null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingPaneId(null)
    setTabBarDropRect(null)
    const { active, over } = event
    const movingId = String(active.id)
    if (tabBarDropTarget(event)) {
      onExtractPaneToTab?.(tab.id, movingId)
      return
    }
    if (!over) return
    const { paneId: targetId, zone } = parseDropId(String(over.id))
    if (!targetId || targetId === movingId) return
    onDropPane?.(tab.id, movingId, targetId, zone)
  }

  const renderTerminal = (pane: TerminalPaneType) => (
    <div className="group/pane relative h-full">
      <TerminalPaneView
        tab={tab}
        pane={pane}
        cwd={cwd}
        isTabActive={isActive}
        focusRequest={
          focusRequest?.tabId === tab.id && focusRequest.paneId === pane.id
            ? focusRequest.nonce
            : undefined
        }
        onTitleChange={onTitleChange}
        onAgentStatusChange={onAgentStatusChange}
        onStartTerminal={onStartTerminal}
        onClosePane={onClosePane}
        onFocus={() => onFocusPane?.(tab.id, pane.id)}
        onTerminalFocusChange={handleTerminalFocusChange}
      />
    </div>
  )

  const renderHeader = (pane: TerminalPaneType, idx: number) => (
    <PaneHeader
      pane={pane}
      index={idx}
      isActive={tab.activePaneId === pane.id}
      showSplit={tab.activePaneId === pane.id && !!onSplitTerminal}
      showClose={multi}
      onFocus={() => onFocusPane?.(tab.id, pane.id)}
      onClose={() => onClosePane?.(tab.id, pane.id)}
      onRename={(name) => onRenamePane?.(tab.id, pane.id, name)}
      onSplitHorizontal={() => onSplitTerminal?.(tab.id, "horizontal")}
      onSplitVertical={() => onSplitTerminal?.(tab.id, "vertical")}
    />
  )

  // A leaf carries its own header directly above its terminal so it travels
  // with the pane through arbitrary nesting.
  const renderLeaf = (paneId: string) => {
    const pane = tab.panes.find((p) => p.id === paneId)
    if (!pane) return null
    const activePane =
      multi &&
      isActive &&
      tab.activePaneId === paneId &&
      focusedTerminalPaneId === paneId
    return (
      <div className="relative flex h-full flex-col">
        <HeaderDropZone
          paneId={paneId}
          enabled={draggingPaneId !== null && draggingPaneId !== paneId}
        >
          {renderHeader(pane, orderedIds.indexOf(paneId))}
        </HeaderDropZone>
        <PaneDropZone
          paneId={paneId}
          enabled={draggingPaneId !== null && draggingPaneId !== paneId}
        >
          {renderTerminal(pane)}
        </PaneDropZone>
        {activePane ? (
          <div className="pointer-events-none absolute inset-0 z-30 box-border border-2 border-ring" />
        ) : null}
      </div>
    )
  }

  // Walk the split tree into nested ResizablePanelGroups. Each split node maps
  // to one group; leaves render the pane. react-resizable-panels keeps each
  // panel's drag size while mounted, keyed by its stable nodeKey.
  const renderGroup = (
    children: TerminalLayout[],
    orientation: "horizontal" | "vertical",
    splitKey: string,
    sizes: number[] | undefined
  ): ReactNode => (
    <ResizablePanelGroup
      orientation={orientation}
      className="min-h-0 flex-1"
      onLayoutChanged={(sizesById) => {
        const next = children.map(
          (child, idx) =>
            sizesById[nodeKey(child)] ?? sizes?.[idx] ?? 100 / children.length
        )
        onLayoutChange?.(tab.id, updateSplitSizes(layout, splitKey, next))
      }}
    >
      {children.map((child, idx) => (
        <Fragment key={nodeKey(child)}>
          {idx > 0 && <ResizableHandle />}
          <ResizablePanel
            id={nodeKey(child)}
            minSize={10}
            defaultSize={sizes?.[idx] ?? 100 / children.length}
          >
            {renderNode(child)}
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  )

  const renderNode = (node: TerminalLayout): ReactNode => {
    if (node.type === "leaf") return renderLeaf(node.paneId)
    return renderGroup(node.children, node.direction, nodeKey(node), node.sizes)
  }

  // Always render the root through a ResizablePanelGroup, even for a single
  // pane (a one-panel group with no handle). Splitting the only pane then just
  // ADDS a panel to the existing group instead of swapping a bare leaf for a
  // brand-new group — so the surviving terminal keeps its React identity and
  // simply resizes, rather than unmounting + recreating + replaying its
  // scrollback into a fresh, briefly mis-sized xterm (the "compress, then
  // settle" glitch). See TerminalView's remount note.
  const renderRoot = (node: TerminalLayout): ReactNode =>
    node.type === "leaf"
      ? renderGroup([node], "horizontal", nodeKey(node), undefined)
      : renderNode(node)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setDraggingPaneId(null)
        setTabBarDropRect(null)
      }}
    >
      {/* Drag a pane's header onto any other pane to swap their positions
          (handled in AppShell.reorderPanes via swapLeaves). */}
      <div className="flex h-full flex-col">{renderRoot(layout)}</div>
      {tabBarDropRect ? (
        <div
          className="pointer-events-none fixed z-[250] bg-foreground/10 ring-2 ring-foreground/40 ring-inset"
          style={{
            top: tabBarDropRect.top,
            left: tabBarDropRect.left,
            width: tabBarDropRect.width,
            height: tabBarDropRect.height,
          }}
        />
      ) : null}
      <DragOverlay dropAnimation={null}>
        {draggingPane ? (
          <PaneHeaderPreview
            pane={draggingPane}
            index={orderedIds.indexOf(draggingPane.id)}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function PaneContent({
  tab,
  project,
  isActive,
  terminalFocusRequest,
  diffViewMode,
  mdMode,
  onTitleChange,
  onAgentStatusChange,
  onStartTerminal,
  onSplitTerminal,
  onClosePane,
  onFocusPane,
  onTerminalFocusChange,
  onRenamePane,
  onDropPane,
  onLayoutChange,
  onExtractPaneToTab,
  onOpenFile,
  onFileDirtyChange,
  fileReveal,
}: {
  tab: WorkspaceTab
  project: Project
  isActive: boolean
  terminalFocusRequest?: {
    tabId: string
    paneId: string
    nonce: number
  } | null
  diffViewMode: "unified" | "split"
  mdMode: MdMode
  onTitleChange?: (tabId: string, paneId: string, title: string) => void
  onAgentStatusChange?: (
    tabId: string,
    paneId: string,
    status: TerminalAgentStatus
  ) => void
  onStartTerminal?: (tabId: string, paneId: string) => void
  onSplitTerminal?: (tabId: string, direction: "horizontal" | "vertical") => void
  onClosePane?: (tabId: string, paneId: string) => void
  onFocusPane?: (tabId: string, paneId: string) => void
  onTerminalFocusChange?: (
    tabId: string,
    paneId: string,
    focused: boolean
  ) => void
  onRenamePane?: (tabId: string, paneId: string, name: string) => void
  onDropPane?: (
    tabId: string,
    movingPaneId: string,
    targetPaneId: string,
    zone: DropZone
  ) => void
  onLayoutChange?: (tabId: string, layout: TerminalLayout) => void
  onExtractPaneToTab?: (tabId: string, paneId: string) => void
  onOpenFile?: (path: string) => void
  onFileDirtyChange?: (
    tabId: string,
    status: { dirty: boolean; saving: boolean }
  ) => void
  fileReveal?: FileReveal | null
}) {
  const handleDirtyChange = useCallback(
    (status: { dirty: boolean; saving: boolean }) => {
      onFileDirtyChange?.(tab.id, status)
    },
    [onFileDirtyChange, tab.id]
  )

  if (tab.kind === "terminal") {
    return (
      <TerminalTabContent
        tab={tab}
        cwd={project.path}
        isActive={isActive}
        focusRequest={terminalFocusRequest}
        onTitleChange={onTitleChange}
        onAgentStatusChange={onAgentStatusChange}
        onStartTerminal={onStartTerminal}
        onSplitTerminal={onSplitTerminal}
        onClosePane={onClosePane}
        onFocusPane={onFocusPane}
        onTerminalFocusChange={onTerminalFocusChange}
        onRenamePane={onRenamePane}
        onDropPane={onDropPane}
        onLayoutChange={onLayoutChange}
        onExtractPaneToTab={onExtractPaneToTab}
      />
    )
  }
  if (tab.kind === "diff") {
    return (
      <SingleFileDiff
        cwd={project.path}
        path={tab.path}
        staged={tab.staged}
        viewMode={diffViewMode}
        mdMode={mdMode}
        onOpenFile={onOpenFile}
      />
    )
  }
  return (
    <FilePreview
      cwd={project.path}
      path={tab.path}
      isActive={isActive}
      mdMode={mdMode}
      onDirtyChange={handleDirtyChange}
      revealLine={
        fileReveal && fileReveal.path === tab.path ? fileReveal.line : undefined
      }
      revealSeq={
        fileReveal && fileReveal.path === tab.path ? fileReveal.seq : undefined
      }
    />
  )
}

export function WorkspacePane({
  project,
  isActive = true,
  activeTabId: activeTabIdOverride,
  terminalFocusRequest,
  onTitleChange,
  onAgentStatusChange,
  onStartTerminal,
  onAddTerminal,
  onSplitTerminal,
  onClosePane,
  onFocusPane,
  onTerminalFocusChange,
  onRenamePane,
  onDropPane,
  onLayoutChange,
  onExtractPaneToTab,
  onOpenFile,
  fileReveal,
}: Props) {
  const { bindings } = useKeybindings()
  const hasTabs = !!project?.tabs.length
  const resolvedActiveTabId =
    activeTabIdOverride && project?.tabs.some((t) => t.id === activeTabIdOverride)
      ? activeTabIdOverride
      : project?.activeTabId
  const activeTab = project?.tabs.find((t) => t.id === resolvedActiveTabId)
  const isDiffActive = activeTab?.kind === "diff"
  // Terminal tabs render their own PaneHeader row (single or split), so the
  // shared header would just stack a redundant row above it. When a project has
  // no tabs, the empty state owns the full page and should not show a header.
  const hideSharedHeader = !hasTabs || activeTab?.kind === "terminal"

  // Per-diff-tab view mode, remembered while the tab exists; defaults to the
  // last-persisted mode so the user's choice survives restarts.
  const [defaultDiffMode, setDefaultDiffMode] = useState<"unified" | "split">(
    () => loadDiffViewMode()
  )
  useEffect(
    () => store.onReady(() => setDefaultDiffMode(loadDiffViewMode())),
    []
  )
  const [diffViewModes, setDiffViewModes] = useState<
    Record<string, "unified" | "split">
  >({})
  const activeDiffMode =
    (activeTab && diffViewModes[activeTab.id]) || defaultDiffMode

  const [mdMode, setMdMode] = useState<MdMode>(() => readMdMode())
  const [fileDirtyStatuses, setFileDirtyStatuses] = useState<
    Record<string, { dirty: boolean; saving: boolean }>
  >({})
  const handleFileDirtyChange = useCallback(
    (tabId: string, status: { dirty: boolean; saving: boolean }) => {
      setFileDirtyStatuses((prev) => {
        const current = prev[tabId]
        if (
          current?.dirty === status.dirty &&
          current?.saving === status.saving
        ) {
          return prev
        }
        return { ...prev, [tabId]: status }
      })
    },
    []
  )
  useEffect(() => store.onReady(() => setMdMode(readMdMode())), [])
  const activeTabPath =
    activeTab && (activeTab.kind === "file" || activeTab.kind === "diff")
      ? activeTab.path
      : null
  const isMarkdownActive = !!activeTabPath && isMarkdownPath(activeTabPath)
  const isImageActive = !!activeTabPath && isImagePath(activeTabPath)
  const isAudioActive = !!activeTabPath && isAudioPath(activeTabPath)
  const isMediaDiffActive =
    activeTab?.kind === "diff" && (isImageActive || isAudioActive)
  const lastMediaDiffKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeTab || !isMediaDiffActive) {
      lastMediaDiffKeyRef.current = null
      return
    }
    const key = `${activeTab.id}:${activeTab.path}:${activeTab.staged}`
    if (lastMediaDiffKeyRef.current === key) return
    lastMediaDiffKeyRef.current = key
    setMdMode("preview")
  }, [activeTab, isMediaDiffActive])
  // Only the diff tab benefits from a raw/preview switch on media — the
  // file tab always renders the media preview. So the toggle is shown when:
  //   - active tab is a markdown file/diff (preview vs source), or
  //   - active tab is a media diff (preview media vs the textual diff)
  const showMdToggle = isMarkdownActive || isMediaDiffActive
  const activeFileDirtyStatus = activeTab
    ? fileDirtyStatuses[activeTab.id]
    : undefined
  const toggleMdMode = () => {
    const next: MdMode = mdMode === "preview" ? "raw" : "preview"
    setMdMode(next)
    writeMdMode(next)
  }

  return (
    <div className="flex h-full flex-col bg-card">
      {!hideSharedHeader && (
        <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-border bg-background px-3 text-xs text-foreground">
          <span className="truncate">
            {activeTab
              ? tabDisplayName(activeTab)
              : project
                ? "No tab"
                : "No project"}
          </span>
          {activeFileDirtyStatus?.dirty && (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {activeFileDirtyStatus.saving
                ? "Saving…"
                : "Modified — ⌘S to save"}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {showMdToggle && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={toggleMdMode}
                      aria-label={
                        mdMode === "preview"
                          ? "Show raw file"
                          : "Show file preview"
                      }
                      aria-pressed={mdMode === "preview"}
                      className="grid size-6 place-items-center rounded-sm text-foreground transition-colors hover:bg-foreground/15"
                    >
                      {mdMode === "preview" ? (
                        <Eye className="size-3.5" />
                      ) : (
                        <FileCode className="size-3.5" />
                      )}
                    </button>
                  }
                />
                <TooltipContent>
                  {mdMode === "preview" ? "Show raw" : "Show preview"}
                </TooltipContent>
              </Tooltip>
            )}
            {isDiffActive && activeTab && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={() => {
                        const next =
                          activeDiffMode === "unified" ? "split" : "unified"
                        setDiffViewModes((prev) => ({
                          ...prev,
                          [activeTab.id]: next,
                        }))
                        setDefaultDiffMode(next)
                        saveDiffViewMode(next)
                      }}
                      aria-label={
                        activeDiffMode === "unified"
                          ? "Switch to split diff"
                          : "Switch to inline diff"
                      }
                      className="grid size-6 place-items-center rounded-sm text-foreground transition-colors hover:bg-foreground/15"
                    >
                      {activeDiffMode === "unified" ? (
                        <Columns2 className="size-3.5" />
                      ) : (
                        <Rows3 className="size-3.5" />
                      )}
                    </button>
                  }
                />
                <TooltipContent>
                  {activeDiffMode === "unified" ? "Split diff" : "Inline diff"}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      )}
      <div className="relative flex-1">
        {project &&
          hasTabs &&
          project.tabs.map((t) => (
            <div
              key={t.id}
              aria-hidden={t.id !== resolvedActiveTabId}
              className={cn(
                "absolute inset-0 transition-opacity duration-75",
                t.id !== resolvedActiveTabId && "pointer-events-none opacity-0"
              )}
            >
              <PaneContent
                tab={t}
                project={project}
                isActive={isActive && t.id === resolvedActiveTabId}
                terminalFocusRequest={terminalFocusRequest}
                diffViewMode={diffViewModes[t.id] ?? defaultDiffMode}
                mdMode={mdMode}
                onTitleChange={onTitleChange}
                onAgentStatusChange={onAgentStatusChange}
                onStartTerminal={onStartTerminal}
                onSplitTerminal={onSplitTerminal}
                onClosePane={onClosePane}
                onFocusPane={onFocusPane}
                onTerminalFocusChange={onTerminalFocusChange}
                onRenamePane={onRenamePane}
                onDropPane={onDropPane}
                onLayoutChange={onLayoutChange}
                onExtractPaneToTab={onExtractPaneToTab}
                onOpenFile={onOpenFile}
                onFileDirtyChange={handleFileDirtyChange}
                fileReveal={fileReveal}
              />
            </div>
          ))}
        {project && !hasTabs && (
          <div
            role="button"
            tabIndex={0}
            aria-label="Start terminal"
            onClick={onAddTerminal}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onAddTerminal?.()
              }
            }}
            className="group grid h-full cursor-pointer place-items-center"
          >
            <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
              <img
                src={logoGrayUrl}
                alt=""
                aria-hidden="true"
                className="mb-3 h-20 w-auto opacity-80"
              />
              <span>Click here to start a new terminal</span>
              <div className="flex items-center gap-1.5 text-[11px]">
                <span>Press</span>
                <KeyChip accelerator={bindings["terminal.new"][0]} />
                <span>or</span>
                <KeyChip accelerator={bindings["terminal.split"][0]} />
                <span>/</span>
                <KeyChip accelerator={bindings["terminal.splitVertical"][0]} />
              </div>
            </div>
          </div>
        )}
        {!project && (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">
            No project open
          </div>
        )}
      </div>
    </div>
  )
}
