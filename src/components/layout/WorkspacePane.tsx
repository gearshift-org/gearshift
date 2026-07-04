import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
import { hiddenLayerClass } from "./hiddenLayer"
import { useKeybindings } from "@/lib/keybindings/useKeybindings"
import { matchesModifierChord } from "@/lib/keybindings/registry"
import { TerminalView } from "./TerminalView"
import { SingleFileDiff } from "./SingleFileDiff"
import { CommitDiff } from "./CommitDiff"
import {
  FilePreview,
  isAudioPath,
  isImagePath,
  isMarkdownPath,
  isPdfPath,
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
import { AGENT_TERMINAL_LABELS } from "@/lib/agentTerminalOptions"
import { terminalPaneAgentState } from "@/lib/agentStatus"
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
  onSplitTerminal?: (
    tabId: string,
    direction: "horizontal" | "vertical"
  ) => void
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
  onQuickSplitPane?: (
    tabId: string,
    targetPaneId: string,
    zone: DropZone
  ) => void
  onTerminalExpandedPaneChange?: (tabId: string, paneId: string | null) => void
  onLayoutChange?: (tabId: string, layout: TerminalLayout) => void
  onExtractPaneToTab?: (tabId: string, paneId: string) => void
  onProjectActivity?: (projectId: string) => void
  onOpenFile?: (path: string) => void
  onOpenDevPreview?: (url: string) => void
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
  onOpenDevPreview,
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
  onOpenDevPreview?: (url: string) => void
}) {
  if (pane.pendingStart) {
    const agentLabel = pane.agentName
      ? AGENT_TERMINAL_LABELS[pane.agentName]
      : null
    const actionLabel = agentLabel
      ? pane.agentSessionId
        ? `Resume ${agentLabel}`
        : `Start ${agentLabel}`
      : "Start terminal"
    return (
      <div onClick={onFocus} className="grid h-full place-items-center bg-card">
        <div className="flex flex-col items-center gap-3 text-xs text-muted-foreground">
          <span>"{tab.customName ?? tab.name}" is not running.</span>
          <button
            onClick={() => onStartTerminal?.(tab.id, pane.id)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-accent/40"
          >
            {actionLabel}
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
        isVisible={isTabActive}
        paneCount={tab.panes.length}
        focusRequest={focusRequest}
        onTitleChange={(title) => onTitleChange?.(tab.id, pane.id, title)}
        onFocusChange={(focused) => onTerminalFocusChange?.(pane.id, focused)}
        initialAgentStatus={pane.agentStatus}
        onAgentStatusChange={(status) =>
          onAgentStatusChange?.(tab.id, pane.id, status)
        }
        onClose={() => onClosePane?.(tab.id, pane.id)}
        onOpenDevPreview={onOpenDevPreview}
      />
    </div>
  )
}

function DevPreview({ url }: { url: string }) {
  return (
    <div className="h-full overflow-hidden bg-card p-2">
      <iframe
        src={url}
        title="Dev Preview"
        className="h-full w-full rounded border border-border bg-background"
      />
    </div>
  )
}

// Five drop regions per pane. `hit` is the (invisible) area that registers the
// drop; `preview` is the landing region drawn while hovering. The hit areas
// tile the pane with no gaps/overlap so exactly one matches the pointer.
const DROP_ZONES: { zone: DropZone; hit: string; preview: string }[] = [
  {
    zone: "top",
    hit: "inset-x-0 top-0 h-[30%]",
    preview: "inset-x-0 top-0 h-1/2",
  },
  {
    zone: "bottom",
    hit: "inset-x-0 bottom-0 h-[30%]",
    preview: "inset-x-0 bottom-0 h-1/2",
  },
  {
    zone: "left",
    hit: "inset-y-[30%] left-0 w-[30%]",
    preview: "inset-y-0 left-0 w-1/2",
  },
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
      <div
        ref={setNodeRef}
        className={cn("pointer-events-none absolute", hit)}
      />
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
        <div className="pointer-events-none absolute inset-0 z-20 rounded-t-[calc(var(--radius-md)-1px)] bg-foreground/15 ring-2 ring-foreground/50 ring-inset" />
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

/**
 * Clickable split zones shown while the quick-split modifier chord is held
 * (terminal.quickSplitHold). Reuses the drag-and-drop zone geometry, minus the
 * center swap zone — clicking an edge spawns a new terminal on that side.
 */
function QuickSplitOverlay({ onPick }: { onPick: (zone: DropZone) => void }) {
  const [hovered, setHovered] = useState<DropZone | null>(null)
  const zones = DROP_ZONES.filter((z) => z.zone !== "center")
  const preview = zones.find((z) => z.zone === hovered)?.preview
  return (
    // Container is click-transparent; only the edge zones take pointer events,
    // so the pane center still reaches the terminal while the chord is held.
    <div className="pointer-events-none absolute inset-0 z-40">
      {zones.map((z) => (
        <div
          key={z.zone}
          className={cn("pointer-events-auto absolute cursor-copy", z.hit)}
          onMouseEnter={() => setHovered(z.zone)}
          onMouseLeave={() => setHovered((h) => (h === z.zone ? null : h))}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onPick(z.zone)
          }}
        />
      ))}
      {preview ? (
        <div
          className={cn(
            "pointer-events-none absolute rounded-sm bg-foreground/15 ring-2 ring-foreground/50 ring-inset",
            preview
          )}
        />
      ) : null}
    </div>
  )
}

function TerminalTabContent({
  tab,
  cwd,
  projectId,
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
  onQuickSplitPane,
  onTerminalExpandedPaneChange,
  onLayoutChange,
  onExtractPaneToTab,
  onProjectActivity,
  onOpenDevPreview,
}: {
  tab: TerminalTab
  cwd?: string
  projectId: string
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
  onSplitTerminal?: (
    tabId: string,
    direction: "horizontal" | "vertical"
  ) => void
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
  onQuickSplitPane?: (
    tabId: string,
    targetPaneId: string,
    zone: DropZone
  ) => void
  onTerminalExpandedPaneChange?: (tabId: string, paneId: string | null) => void
  onLayoutChange?: (tabId: string, layout: TerminalLayout) => void
  onExtractPaneToTab?: (tabId: string, paneId: string) => void
  onProjectActivity?: (projectId: string) => void
  onOpenDevPreview?: (url: string) => void
}) {
  const multi = tab.panes.length > 1
  // Among splits with a live agent, mark the one the user most recently
  // submitted a message to, so it's easy to spot which split to return to.
  // Only meaningful when the tab is actually split into multiple panes.
  const lastSubmittedPaneId = useMemo(() => {
    if (!multi) return null
    // lastSubmitAt is only recorded while a coding agent was running, so the
    // pane with the greatest timestamp is the split the user last messaged.
    // Gating on the timestamp (not the live `running` flag) lets the marker
    // survive a restart, where `running` is re-detected asynchronously.
    let bestId: string | null = null
    let bestAt = 0
    for (const pane of tab.panes) {
      const at = pane.agentStatus?.lastSubmitAt ?? 0
      if (at > bestAt) {
        bestAt = at
        bestId = pane.id
      }
    }
    return bestId
  }, [multi, tab.panes])
  // Share the terminal body's background with each pane's header (and the leaf
  // card) so the chrome blends with the terminal instead of the app surface.
  // The terminal body uses the theme's --sidebar token (see TerminalView), so
  // reuse it here directly — it stays in sync with the theme automatically.
  const terminalBg = "var(--sidebar)"
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
  // The pane that currently holds focus anywhere within it — the terminal body,
  // its header, or the rename input. Drives the active-pane border: it shows
  // while you're engaged with the pane and hides once focus leaves it (e.g. the
  // right sidebar or another app).
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null)
  const [expandedPaneId, setExpandedPaneId] = useState<string | null>(null)
  const splitBlocked = expandedPaneId !== null
  const draggingPane = draggingPaneId
    ? tab.panes.find((p) => p.id === draggingPaneId)
    : undefined

  useEffect(() => {
    if (!isActive) setFocusedPaneId(null)
  }, [isActive])

  useEffect(() => {
    if (
      expandedPaneId &&
      !tab.panes.some((pane) => pane.id === expandedPaneId)
    ) {
      setExpandedPaneId(null)
    }
  }, [expandedPaneId, tab.panes])

  useLayoutEffect(() => {
    onTerminalExpandedPaneChange?.(tab.id, expandedPaneId)
    return () => onTerminalExpandedPaneChange?.(tab.id, null)
  }, [expandedPaneId, onTerminalExpandedPaneChange, tab.id])

  // Quick split: arm clickable split zones while the configured modifier chord
  // (terminal.quickSplitHold, default Cmd+Option) is held. Modifier state is
  // read from every keydown/keyup so releasing any part of the chord disarms;
  // visibility gating (active tab, handler present) is derived at render.
  const { bindings: keyBindings } = useKeybindings()
  const quickSplitChord = keyBindings["terminal.quickSplitHold"]
  const [quickSplitChordHeld, setQuickSplitChordHeld] = useState(false)
  useEffect(() => {
    const update = (e: KeyboardEvent) =>
      setQuickSplitChordHeld(matchesModifierChord(quickSplitChord, e))
    const disarm = () => setQuickSplitChordHeld(false)
    window.addEventListener("keydown", update)
    window.addEventListener("keyup", update)
    window.addEventListener("blur", disarm)
    return () => {
      window.removeEventListener("keydown", update)
      window.removeEventListener("keyup", update)
      window.removeEventListener("blur", disarm)
    }
  }, [quickSplitChord])
  const quickSplitArmed =
    quickSplitChordHeld && isActive && !!onQuickSplitPane && !splitBlocked

  const handleTerminalFocusChange = useCallback(
    (paneId: string, focused: boolean) => {
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
    if (
      !(activator instanceof MouseEvent || activator instanceof PointerEvent)
    ) {
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
        onOpenDevPreview={onOpenDevPreview}
      />
    </div>
  )

  const renderHeader = (pane: TerminalPaneType, idx: number) => (
    <PaneHeader
      pane={pane}
      index={idx}
      isActive={tab.activePaneId === pane.id}
      isLastSubmitted={pane.id === lastSubmittedPaneId}
      showSplit={
        tab.activePaneId === pane.id && !!onSplitTerminal && !splitBlocked
      }
      showExpand={multi}
      showClose={multi}
      isExpanded={expandedPaneId === pane.id}
      onFocus={() => onFocusPane?.(tab.id, pane.id)}
      onClose={() => onClosePane?.(tab.id, pane.id)}
      onRename={(name) => onRenamePane?.(tab.id, pane.id, name)}
      onSplitHorizontal={() => {
        if (!splitBlocked) onSplitTerminal?.(tab.id, "horizontal")
      }}
      onSplitVertical={() => {
        if (!splitBlocked) onSplitTerminal?.(tab.id, "vertical")
      }}
      onProjectActivity={() => onProjectActivity?.(projectId)}
      onToggleExpand={() =>
        setExpandedPaneId((current) => (current === pane.id ? null : pane.id))
      }
    />
  )

  // A leaf carries its own header directly above its terminal so it travels
  // with the pane through arbitrary nesting.
  const renderLeaf = (paneId: string) => {
    const pane = tab.panes.find((p) => p.id === paneId)
    if (!pane) return null
    // Show the focus ring only while this active pane actually holds focus
    // (terminal, header, or rename input). Focus-within — rather than the
    // xterm's own focus — keeps the border up while editing the title or
    // clicking the header, but still drops it when focus leaves the pane.
    const activePane =
      isActive && tab.activePaneId === paneId && focusedPaneId === paneId
    // Pulse the pane border instead of a header dot when the agent finished or
    // needs attention. Driven by the same status flags as the sidebar indicators,
    // so it clears the same way (viewing the pane with the app focused).
    const agentState = terminalPaneAgentState(pane)
    const agentWorking = agentState === "working"
    const agentNeedsAttention = agentState === "blocked"
    const agentDone = agentState === "done"
    return (
      <div
        onFocus={() => setFocusedPaneId(paneId)}
        onBlur={(e) => {
          // Only clear when focus truly leaves the pane (not when it moves
          // between the terminal, header, and rename input inside it).
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setFocusedPaneId((current) => (current === paneId ? null : current))
          }
        }}
        className={cn(
          "relative flex h-full flex-col overflow-hidden rounded-md border bg-[var(--xterm-bg)]",
          activePane ? "border-transparent" : "border-border"
        )}
        style={{ "--xterm-bg": terminalBg } as CSSProperties}
      >
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
          {agentWorking ? (
            // Busy agent: a scan line that sweeps along the top of the terminal
            // body (just below the header).
            <span className="gs-agent-header-scan pointer-events-none absolute top-0 left-0 z-30 h-0.5 w-1/2" />
          ) : null}
          {renderTerminal(pane)}
          {quickSplitArmed && draggingPaneId === null && !pane.pendingStart ? (
            <QuickSplitOverlay
              onPick={(zone) => {
                if (!splitBlocked) onQuickSplitPane?.(tab.id, paneId, zone)
              }}
            />
          ) : null}
        </PaneDropZone>
        {activePane ? (
          <div className="pointer-events-none absolute inset-0 z-30 box-border rounded-[calc(var(--radius-md)-1px)] border-2 border-ring" />
        ) : agentNeedsAttention || agentDone ? (
          <div
            className={cn(
              "gs-agent-pulse-border pointer-events-none absolute inset-0 z-30 rounded-[calc(var(--radius-md)-1px)]",
              agentNeedsAttention
                ? "gs-agent-pulse-attention"
                : "gs-agent-pulse-done"
            )}
          />
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
          {idx > 0 && <ResizableHandle disableDoubleClick />}
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
  const renderRoot = (node: TerminalLayout): ReactNode => {
    if (expandedPaneId) return renderLeaf(expandedPaneId)
    return node.type === "leaf"
      ? renderGroup([node], "horizontal", nodeKey(node), undefined)
      : renderNode(node)
  }

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
  onQuickSplitPane,
  onTerminalExpandedPaneChange,
  onLayoutChange,
  onExtractPaneToTab,
  onProjectActivity,
  onOpenFile,
  onOpenDevPreview,
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
  onSplitTerminal?: (
    tabId: string,
    direction: "horizontal" | "vertical"
  ) => void
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
  onQuickSplitPane?: (
    tabId: string,
    targetPaneId: string,
    zone: DropZone
  ) => void
  onTerminalExpandedPaneChange?: (tabId: string, paneId: string | null) => void
  onLayoutChange?: (tabId: string, layout: TerminalLayout) => void
  onExtractPaneToTab?: (tabId: string, paneId: string) => void
  onProjectActivity?: (projectId: string) => void
  onOpenFile?: (path: string) => void
  onOpenDevPreview?: (url: string) => void
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
        projectId={project.id}
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
        onQuickSplitPane={onQuickSplitPane}
        onTerminalExpandedPaneChange={onTerminalExpandedPaneChange}
        onLayoutChange={onLayoutChange}
        onExtractPaneToTab={onExtractPaneToTab}
        onProjectActivity={onProjectActivity}
        onOpenDevPreview={onOpenDevPreview}
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
  if (tab.kind === "commit") {
    return (
      <CommitDiff cwd={project.path} hash={tab.hash} viewMode={diffViewMode} />
    )
  }
  if (tab.kind === "devPreview") {
    return <DevPreview url={tab.url} />
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
  onQuickSplitPane,
  onTerminalExpandedPaneChange,
  onLayoutChange,
  onExtractPaneToTab,
  onProjectActivity,
  onOpenFile,
  onOpenDevPreview,
  fileReveal,
}: Props) {
  const hasTabs = !!project?.tabs.length
  const resolvedActiveTabId =
    activeTabIdOverride &&
    project?.tabs.some((t) => t.id === activeTabIdOverride)
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
  const isPdfActive = !!activeTabPath && isPdfPath(activeTabPath)
  const isMediaDiffActive =
    activeTab?.kind === "diff" &&
    (isImageActive || isAudioActive || isPdfActive)
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
  //   - active tab is a media diff (preview media/PDF vs the textual diff)
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
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-md",
        // Terminal panes frame themselves (each split pane has its own
        // rounded border). For non-terminal preview tabs the WorkspacePane is the
        // frame, so give it the same rounded border as a terminal pane.
        activeTab?.kind === "terminal"
          ? "bg-transparent"
          : "border border-border bg-card"
      )}
    >
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
              className={hiddenLayerClass(t.id !== resolvedActiveTabId)}
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
                onQuickSplitPane={onQuickSplitPane}
                onTerminalExpandedPaneChange={onTerminalExpandedPaneChange}
                onLayoutChange={onLayoutChange}
                onExtractPaneToTab={onExtractPaneToTab}
                onProjectActivity={onProjectActivity}
                onOpenFile={onOpenFile}
                onOpenDevPreview={onOpenDevPreview}
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
