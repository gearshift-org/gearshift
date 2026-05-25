import { Fragment, useEffect, useState } from "react"
import { Columns2, Rows3 } from "lucide-react"
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  horizontalListSortingStrategy,
  SortableContext,
} from "@dnd-kit/sortable"
import { cn } from "@/lib/utils"
import { TerminalView } from "./TerminalView"
import { SingleFileDiff } from "./SingleFileDiff"
import { FilePreview } from "./FilePreview"
import { PaneHeader } from "./PaneHeader"
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
import type {
  Project,
  TerminalAgentStatus,
  TerminalPane as TerminalPaneType,
  TerminalTab,
  WorkspaceTab,
} from "./types"

type Props = {
  project: Project | undefined
  isActive?: boolean
  onTitleChange?: (tabId: string, paneId: string, title: string) => void
  onAgentStatusChange?: (
    tabId: string,
    paneId: string,
    status: TerminalAgentStatus
  ) => void
  onStartTerminal?: (tabId: string, paneId: string) => void
  onAddTerminal?: () => void
  onSplitTerminal?: (tabId: string) => void
  onClosePane?: (tabId: string, paneId: string) => void
  onFocusPane?: (tabId: string, paneId: string) => void
  onRenamePane?: (tabId: string, paneId: string, name: string) => void
  onReorderPanes?: (tabId: string, fromPaneId: string, toPaneId: string) => void
  onOpenFile?: (path: string) => void
}

function TerminalPaneView({
  tab,
  pane,
  isTabActive,
  onTitleChange,
  onAgentStatusChange,
  onStartTerminal,
  onClosePane,
  onFocus,
}: {
  tab: TerminalTab
  pane: TerminalPaneType
  isTabActive: boolean
  onTitleChange?: (tabId: string, paneId: string, title: string) => void
  onAgentStatusChange?: (
    tabId: string,
    paneId: string,
    status: TerminalAgentStatus
  ) => void
  onStartTerminal?: (tabId: string, paneId: string) => void
  onClosePane?: (tabId: string, paneId: string) => void
  onFocus?: () => void
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
        sessionId={pane.id}
        isActive={isTabActive && tab.activePaneId === pane.id}
        onTitleChange={(title) => onTitleChange?.(tab.id, pane.id, title)}
        onAgentStatusChange={(status) =>
          onAgentStatusChange?.(tab.id, pane.id, status)
        }
        onClose={() => onClosePane?.(tab.id, pane.id)}
      />
    </div>
  )
}

function TerminalTabContent({
  tab,
  isActive,
  onTitleChange,
  onAgentStatusChange,
  onStartTerminal,
  onSplitTerminal,
  onClosePane,
  onFocusPane,
  onRenamePane,
  onReorderPanes,
}: {
  tab: TerminalTab
  isActive: boolean
  onTitleChange?: (tabId: string, paneId: string, title: string) => void
  onAgentStatusChange?: (
    tabId: string,
    paneId: string,
    status: TerminalAgentStatus
  ) => void
  onStartTerminal?: (tabId: string, paneId: string) => void
  onSplitTerminal?: (tabId: string) => void
  onClosePane?: (tabId: string, paneId: string) => void
  onFocusPane?: (tabId: string, paneId: string) => void
  onRenamePane?: (tabId: string, paneId: string, name: string) => void
  onReorderPanes?: (tabId: string, fromPaneId: string, toPaneId: string) => void
}) {
  const multi = tab.panes.length > 1

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    onReorderPanes?.(tab.id, String(active.id), String(over.id))
  }

  // Mirror panel sizes so the lifted-out header row stays aligned with the
  // terminal column beneath it. Even split until the user drags the handle.
  const [paneSizes, setPaneSizes] = useState<number[]>(() =>
    tab.panes.map(() => 100 / Math.max(1, tab.panes.length))
  )
  useEffect(() => {
    setPaneSizes((prev) => {
      if (prev.length === tab.panes.length) return prev
      return tab.panes.map(() => 100 / Math.max(1, tab.panes.length))
    })
  }, [tab.panes.length])

  const visiblePaneSizes =
    paneSizes.length === tab.panes.length
      ? paneSizes
      : tab.panes.map(() => 100 / Math.max(1, tab.panes.length))

  const renderTerminal = (pane: TerminalPaneType) => (
    <div
      className={cn(
        "group/pane relative h-full",
        multi &&
          tab.activePaneId === pane.id &&
          "ring-1 ring-foreground/15 ring-inset"
      )}
    >
      <TerminalPaneView
        tab={tab}
        pane={pane}
        isTabActive={isActive}
        onTitleChange={onTitleChange}
        onAgentStatusChange={onAgentStatusChange}
        onStartTerminal={onStartTerminal}
        onClosePane={onClosePane}
        onFocus={() => onFocusPane?.(tab.id, pane.id)}
      />
    </div>
  )

  const panelGroup = (
    <ResizablePanelGroup
      orientation="horizontal"
      className="min-h-0 flex-1"
      onLayoutChange={(layout) => {
        const next = tab.panes.map(
          (p) => layout[p.id] ?? 100 / tab.panes.length
        )
        setPaneSizes((prev) => {
          if (
            prev.length === next.length &&
            prev.every((v, i) => Math.abs(v - next[i]) < 0.01)
          ) {
            return prev
          }
          return next
        })
      }}
    >
      {tab.panes.map((pane, idx) => (
        <Fragment key={pane.id}>
          {idx > 0 && <ResizableHandle />}
          <ResizablePanel
            id={pane.id}
            minSize={10}
            defaultSize={100 / tab.panes.length}
          >
            {renderTerminal(pane)}
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={tab.panes.map((p) => p.id)}
        strategy={horizontalListSortingStrategy}
      >
        <div className="flex h-full flex-col">
          {/* Headers live in a flat row above the panels so the sibling-swap
              animation isn't clipped by react-resizable-panels' overflow.
              Same row, same component for single and split — pane count
              just changes the flex basis. */}
          <div className="flex shrink-0">
            {tab.panes.map((pane, idx) => (
              <div
                key={pane.id}
                style={{
                  flexBasis: `${visiblePaneSizes[idx] ?? 100 / tab.panes.length}%`,
                }}
                className={cn("min-w-0", idx > 0 && "border-l border-border")}
              >
                <PaneHeader
                  pane={pane}
                  index={idx}
                  isActive={tab.activePaneId === pane.id}
                  showSplit={tab.activePaneId === pane.id && !!onSplitTerminal}
                  showClose={multi}
                  onFocus={() => onFocusPane?.(tab.id, pane.id)}
                  onClose={() => onClosePane?.(tab.id, pane.id)}
                  onRename={(name) => onRenamePane?.(tab.id, pane.id, name)}
                  onSplit={() => onSplitTerminal?.(tab.id)}
                />
              </div>
            ))}
          </div>
          {panelGroup}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function PaneContent({
  tab,
  project,
  isActive,
  diffViewMode,
  onTitleChange,
  onAgentStatusChange,
  onStartTerminal,
  onSplitTerminal,
  onClosePane,
  onFocusPane,
  onRenamePane,
  onReorderPanes,
  onOpenFile,
}: {
  tab: WorkspaceTab
  project: Project
  isActive: boolean
  diffViewMode: "unified" | "split"
  onTitleChange?: (tabId: string, paneId: string, title: string) => void
  onAgentStatusChange?: (
    tabId: string,
    paneId: string,
    status: TerminalAgentStatus
  ) => void
  onStartTerminal?: (tabId: string, paneId: string) => void
  onSplitTerminal?: (tabId: string) => void
  onClosePane?: (tabId: string, paneId: string) => void
  onFocusPane?: (tabId: string, paneId: string) => void
  onRenamePane?: (tabId: string, paneId: string, name: string) => void
  onReorderPanes?: (tabId: string, fromPaneId: string, toPaneId: string) => void
  onOpenFile?: (path: string) => void
}) {
  if (tab.kind === "terminal") {
    return (
      <TerminalTabContent
        tab={tab}
        isActive={isActive}
        onTitleChange={onTitleChange}
        onAgentStatusChange={onAgentStatusChange}
        onStartTerminal={onStartTerminal}
        onSplitTerminal={onSplitTerminal}
        onClosePane={onClosePane}
        onFocusPane={onFocusPane}
        onRenamePane={onRenamePane}
        onReorderPanes={onReorderPanes}
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
        onOpenFile={onOpenFile}
      />
    )
  }
  return <FilePreview cwd={project.path} path={tab.path} />
}

export function WorkspacePane({
  project,
  isActive = true,
  onTitleChange,
  onAgentStatusChange,
  onStartTerminal,
  onAddTerminal,
  onSplitTerminal,
  onClosePane,
  onFocusPane,
  onRenamePane,
  onReorderPanes,
  onOpenFile,
}: Props) {
  const hasTabs = !!project?.tabs.length
  const activeTab = project?.tabs.find((t) => t.id === project.activeTabId)
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
                    className="ml-auto grid size-6 place-items-center rounded-sm text-foreground transition-colors hover:bg-foreground/15"
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
      )}
      <div className="relative flex-1">
        {project &&
          hasTabs &&
          project.tabs.map((t) => (
            <div
              key={t.id}
              aria-hidden={t.id !== project.activeTabId}
              className={cn(
                "absolute inset-0 transition-opacity duration-75",
                t.id !== project.activeTabId && "pointer-events-none opacity-0"
              )}
            >
              <PaneContent
                tab={t}
                project={project}
                isActive={isActive && t.id === project.activeTabId}
                diffViewMode={diffViewModes[t.id] ?? defaultDiffMode}
                onTitleChange={onTitleChange}
                onAgentStatusChange={onAgentStatusChange}
                onStartTerminal={onStartTerminal}
                onSplitTerminal={onSplitTerminal}
                onClosePane={onClosePane}
                onFocusPane={onFocusPane}
                onRenamePane={onRenamePane}
                onReorderPanes={onReorderPanes}
                onOpenFile={onOpenFile}
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
            <span className="text-xs text-muted-foreground transition-colors group-hover:text-foreground">
              Click here to start a new terminal
            </span>
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
