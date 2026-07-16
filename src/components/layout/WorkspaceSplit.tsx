import { useEffect, useRef, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { cn } from "@/lib/utils"
import { hiddenLayerClass } from "./hiddenLayer"
import { WorkspacePane } from "./WorkspacePane"
import { RightSidebar } from "./RightSidebar"
import type { HistoryRange } from "@/lib/historySummary"
import {
  loadSidebarWidth,
  saveSidebarWidth,
  type RightSidebarTab,
} from "@/lib/projects"
import { store } from "@/lib/store"
import { fetchGitQueryData, gitQueryKey } from "@/lib/gitStatusQuery"
import type {
  DropZone,
  FileReveal,
  Project,
  TerminalAgentStatus,
  TerminalLayout,
} from "./types"

const SIDEBAR_DEFAULT_PX = 340
const SIDEBAR_MIN_PX = 220
const BACKGROUND_GIT_PREFETCH_STALE_MS = 30_000

// No fixed max: the sidebar may grow until it reaches the container's left
// edge (i.e. the project sidebar); callers pass that live bound as `max`.
function clampWidth(n: number, max = Infinity): number {
  return Math.min(max, Math.max(SIDEBAR_MIN_PX, n))
}

type Props = {
  projects: Project[]
  activeProjectId: string
  activeTabId?: string
  titleBar?: ReactNode
  sidebarTopActions?: ReactNode
  workspaceTabs: ReactNode
  sidebarOpen?: boolean
  onTerminalTitleChange?: (tabId: string, paneId: string, title: string) => void
  onTerminalAgentStatusChange?: (
    tabId: string,
    paneId: string,
    status: TerminalAgentStatus
  ) => void
  terminalFocusRequest?: {
    tabId: string
    paneId: string
    nonce: number
  } | null
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
  onTerminalLayoutChange?: (tabId: string, layout: TerminalLayout) => void
  onExtractPaneToTab?: (tabId: string, paneId: string) => void
  onOpenDiffTab: (path: string, staged: boolean) => void
  onOpenFileTab: (path: string) => void
  onOpenDevPreviewTab?: (url: string) => void
  onOpenCommitTab: (commit: {
    hash: string
    shortHash: string
    subject: string
  }) => void
  onSummarizeHistory?: (agent: string) => void
  onSummarizeChat?: (range: HistoryRange) => void
  onProjectActivity?: (projectId: string) => void
  onFocusSession?: (sessionId: string) => void
  rightSidebarTab?: RightSidebarTab
  onRightSidebarTabChange?: (tab: RightSidebarTab) => void
  activeTreeFilePath?: string
  fileReveal?: FileReveal | null
  // In the vertical project layout the separate title bar is dropped and the
  // workspace tab bar doubles as the top bar (always shown, hosts controls).
  hideTitleBar?: boolean
  inspectFilesInSidebar?: boolean
}

export function WorkspaceSplit({
  projects,
  activeProjectId,
  activeTabId,
  titleBar,
  sidebarTopActions,
  workspaceTabs,
  sidebarOpen = true,
  onTerminalTitleChange,
  onTerminalAgentStatusChange,
  terminalFocusRequest,
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
  onTerminalLayoutChange,
  onExtractPaneToTab,
  onOpenDiffTab,
  onOpenFileTab,
  onOpenDevPreviewTab,
  onOpenCommitTab,
  onSummarizeHistory,
  onSummarizeChat,
  onProjectActivity,
  onFocusSession,
  rightSidebarTab,
  onRightSidebarTabChange,
  activeTreeFilePath,
  fileReveal,
  hideTitleBar = false,
  inspectFilesInSidebar = false,
}: Props) {
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const queryClient = useQueryClient()
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = loadSidebarWidth()
    return stored ? clampWidth(stored) : SIDEBAR_DEFAULT_PX
  })
  useEffect(
    () =>
      store.onReady(() => {
        const stored = loadSidebarWidth()
        if (stored) setSidebarWidth(clampWidth(stored))
      }),
    []
  )
  const rootRef = useRef<HTMLDivElement>(null)
  const workspacePanelRef = useRef<HTMLDivElement>(null)
  const sidebarPanelRef = useRef<HTMLDivElement>(null)
  const sidebarContentRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const dragWidthRef = useRef(sidebarWidth)
  const dragFrameRef = useRef<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Persist whenever width settles (debounced via effect-cleanup style).
  useEffect(() => {
    const id = window.setTimeout(() => saveSidebarWidth(sidebarWidth), 250)
    return () => window.clearTimeout(id)
  }, [sidebarWidth])

  useEffect(() => {
    for (const project of projects) {
      if (project.id === activeProjectId) continue
      void queryClient.prefetchQuery({
        queryKey: gitQueryKey(project.path),
        queryFn: () => fetchGitQueryData(project.path),
        staleTime: BACKGROUND_GIT_PREFETCH_STALE_MS,
      })
    }
  }, [activeProjectId, projects, queryClient])

  // No fit suppression on toggle: the workspace padding snaps in one layout
  // pass at click time and the single terminal reflow lands under the panel's
  // compositor slide. gs-sidebar-resizing is only for width drags (startDrag).

  useEffect(() => {
    dragWidthRef.current = sidebarWidth
  }, [sidebarWidth])

  useEffect(() => {
    const applyDragWidth = () => {
      dragFrameRef.current = null
      const width = `${dragWidthRef.current}px`
      if (workspacePanelRef.current)
        workspacePanelRef.current.style.paddingRight = width
      if (sidebarPanelRef.current) sidebarPanelRef.current.style.width = width
      if (sidebarContentRef.current)
        sidebarContentRef.current.style.width = width
    }

    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      e.preventDefault()
      const dx = d.startX - e.clientX
      dragWidthRef.current = clampWidth(
        d.startWidth + dx,
        rootRef.current?.clientWidth ?? Infinity
      )
      if (dragFrameRef.current === null) {
        dragFrameRef.current = window.requestAnimationFrame(applyDragWidth)
      }
    }
    const onUp = () => {
      if (!dragRef.current) return
      dragRef.current = null
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current)
        dragFrameRef.current = null
      }
      const width = dragWidthRef.current
      const widthPx = `${width}px`
      if (workspacePanelRef.current)
        workspacePanelRef.current.style.paddingRight = widthPx
      if (sidebarPanelRef.current) {
        sidebarPanelRef.current.style.width = widthPx
        sidebarPanelRef.current.style.transition = ""
      }
      if (sidebarContentRef.current)
        sidebarContentRef.current.style.width = widthPx
      setSidebarWidth(width)
      setIsDragging(false)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.body.classList.remove("gs-sidebar-resizing")
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current)
      }
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.body.classList.remove("gs-sidebar-resizing")
    }
  }, [])

  const startDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: sidebarWidth }
    dragWidthRef.current = sidebarWidth
    if (sidebarPanelRef.current)
      sidebarPanelRef.current.style.transition = "none"
    setIsDragging(true)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    document.body.classList.add("gs-sidebar-resizing")
  }

  const activeProjectHasTabs = !!activeProject?.tabs.length

  const workspaceSection = (
    <div className="relative flex h-full flex-col">
      {!hideTitleBar && titleBar}
      {(hideTitleBar || activeProjectHasTabs) && workspaceTabs}
      <div className="relative min-h-0 flex-1">
        {projects.map((p) => (
          <div
            key={p.id}
            aria-hidden={p.id !== activeProjectId}
            // Outside padding (p-2) detaches the terminal view from the panel
            // edges; each pane rounds itself and the resize handles add gaps.
            className={hiddenLayerClass(p.id !== activeProjectId, "p-2")}
          >
            <WorkspacePane
              project={p}
              isActive={p.id === activeProjectId}
              activeTabId={p.id === activeProjectId ? activeTabId : undefined}
              terminalFocusRequest={terminalFocusRequest}
              onTitleChange={onTerminalTitleChange}
              onAgentStatusChange={onTerminalAgentStatusChange}
              onStartTerminal={onStartTerminal}
              onAddTerminal={onAddTerminal}
              onSplitTerminal={onSplitTerminal}
              onClosePane={onClosePane}
              onFocusPane={onFocusPane}
              onTerminalFocusChange={onTerminalFocusChange}
              onRenamePane={onRenamePane}
              onDropPane={onDropPane}
              onQuickSplitPane={onQuickSplitPane}
              onTerminalExpandedPaneChange={onTerminalExpandedPaneChange}
              onLayoutChange={onTerminalLayoutChange}
              onExtractPaneToTab={onExtractPaneToTab}
              onProjectActivity={onProjectActivity}
              onOpenFile={onOpenFileTab}
              onOpenDevPreview={onOpenDevPreviewTab}
              fileReveal={fileReveal}
            />
          </div>
        ))}
        {!activeProject && (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">
            No project open
          </div>
        )}
      </div>
    </div>
  )

  // Keep the tree structurally stable regardless of `sidebarOpen`; the right
  // sidebar stays pinned to the app edge while the workspace reserves its space.
  return (
    <div ref={rootRef} className="relative min-h-0 flex-1 overflow-hidden">
      {/* The workspace padding SNAPS (no transition): animating it relayouts
          the workspace every frame at half the refresh rate, and the terminal
          reflow lands as a hitch. Only the sidebar panel's compositor-driven
          transform below animates, so the reflow hides under a smooth slide. */}
      <div
        ref={workspacePanelRef}
        className="h-full min-w-0"
        style={{ paddingRight: sidebarOpen ? sidebarWidth : 0 }}
      >
        {workspaceSection}
      </div>
      <div
        ref={sidebarPanelRef}
        style={{
          width: sidebarWidth,
          transform: sidebarOpen ? "translateX(0)" : "translateX(100%)",
        }}
        className={cn(
          "absolute inset-y-0 right-0 z-10 h-full overflow-hidden",
          !isDragging && "transition-transform duration-200 ease-in-out",
          !sidebarOpen && "pointer-events-none"
        )}
        aria-hidden={!sidebarOpen}
      >
        <div
          onMouseDown={sidebarOpen ? startDrag : undefined}
          onDoubleClick={
            sidebarOpen ? () => setSidebarWidth(SIDEBAR_DEFAULT_PX) : undefined
          }
          role="separator"
          aria-orientation="vertical"
          aria-hidden={!sidebarOpen}
          className={cn(
            "group absolute inset-y-0 left-0 z-20 w-2 -translate-x-1/2 cursor-col-resize touch-none",
            !sidebarOpen && "pointer-events-none"
          )}
        >
          <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-foreground/30 group-active:bg-foreground/40" />
        </div>
        <div
          ref={sidebarContentRef}
          className={cn(
            // The right sidebar is expensive; keep its own layout/paint isolated
            // while the project sidebar changes the workspace width.
            "absolute inset-0 [contain:layout_paint]",
            !sidebarOpen && "pointer-events-none"
          )}
          style={{ width: sidebarWidth }}
          aria-hidden={!sidebarOpen}
        >
          <RightSidebar
            cwd={activeProject?.path ?? null}
            projectId={activeProject?.id ?? null}
            isActive={!!activeProject}
            activeTab={rightSidebarTab}
            onActiveTabChange={onRightSidebarTabChange}
            activeFilePath={activeTreeFilePath}
            onOpenDiff={onOpenDiffTab}
            onOpenFile={onOpenFileTab}
            onOpenCommit={onOpenCommitTab}
            onSummarizeHistory={onSummarizeHistory}
            onSummarizeChat={onSummarizeChat}
            onFocusSession={onFocusSession}
            topRightActions={sidebarTopActions}
            inspectionEnabled={inspectFilesInSidebar}
          />
        </div>
      </div>
    </div>
  )
}
