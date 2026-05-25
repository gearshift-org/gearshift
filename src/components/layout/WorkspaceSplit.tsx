import { useEffect, useRef, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { cn } from "@/lib/utils"
import { WorkspacePane } from "./WorkspacePane"
import { RightSidebar } from "./RightSidebar"
import { loadSidebarWidth, saveSidebarWidth } from "@/lib/projects"
import { store } from "@/lib/store"
import { fetchGitQueryData, gitQueryKey } from "@/lib/gitStatusQuery"
import type { Project, TerminalAgentStatus } from "./types"

const SIDEBAR_DEFAULT_PX = 340
const SIDEBAR_MIN_PX = 220
const SIDEBAR_MAX_PX = 800

function clampWidth(n: number): number {
  return Math.min(SIDEBAR_MAX_PX, Math.max(SIDEBAR_MIN_PX, n))
}

type Props = {
  projects: Project[]
  activeProjectId: string
  titleBar?: ReactNode
  sidebarTopActions?: ReactNode
  workspaceTabs: ReactNode
  sidebarOpen?: boolean
  sidebarOverlayOpen?: boolean
  sidebarOverlayExiting?: boolean
  onTerminalTitleChange?: (tabId: string, paneId: string, title: string) => void
  onTerminalAgentStatusChange?: (
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
  onOpenDiffTab: (path: string, staged: boolean) => void
  onOpenFileTab: (path: string) => void
  rightSidebarTab?: "changes" | "files" | "history"
  onRightSidebarTabChange?: (tab: "changes" | "files" | "history") => void
  activeTreeFilePath?: string
}

export function WorkspaceSplit({
  projects,
  activeProjectId,
  titleBar,
  sidebarTopActions,
  workspaceTabs,
  sidebarOpen = true,
  sidebarOverlayOpen = false,
  sidebarOverlayExiting = false,
  onTerminalTitleChange,
  onTerminalAgentStatusChange,
  onStartTerminal,
  onAddTerminal,
  onSplitTerminal,
  onClosePane,
  onFocusPane,
  onRenamePane,
  onReorderPanes,
  onOpenDiffTab,
  onOpenFileTab,
  rightSidebarTab,
  onRightSidebarTabChange,
  activeTreeFilePath,
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
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
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
      })
    }
  }, [activeProjectId, projects, queryClient])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = d.startX - e.clientX
      setSidebarWidth(clampWidth(d.startWidth + dx))
    }
    const onUp = () => {
      if (!dragRef.current) return
      dragRef.current = null
      setIsDragging(false)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [])

  const startDrag = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startWidth: sidebarWidth }
    setIsDragging(true)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }

  const activeProjectHasTabs = !!activeProject?.tabs.length
  const showSidebar = sidebarOpen || sidebarOverlayOpen
  const sidebarIsOverlay = sidebarOverlayOpen && !sidebarOpen

  const workspaceSection = (
    <div className="flex h-full flex-col">
      {titleBar}
      {activeProjectHasTabs && workspaceTabs}
      <div className="relative min-h-0 flex-1">
        {projects.map((p) => (
          <div
            key={p.id}
            aria-hidden={p.id !== activeProjectId}
            className={cn(
              "absolute inset-0 transition-opacity duration-75",
              p.id !== activeProjectId && "pointer-events-none opacity-0"
            )}
          >
            <WorkspacePane
              project={p}
              isActive={p.id === activeProjectId}
              onTitleChange={onTerminalTitleChange}
              onAgentStatusChange={onTerminalAgentStatusChange}
              onStartTerminal={onStartTerminal}
              onAddTerminal={onAddTerminal}
              onSplitTerminal={onSplitTerminal}
              onClosePane={onClosePane}
              onFocusPane={onFocusPane}
              onRenamePane={onRenamePane}
              onReorderPanes={onReorderPanes}
              onOpenFile={onOpenFileTab}
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

  // Keep the tree structurally stable regardless of `sidebarOpen` — otherwise
  // toggling unmounts `WorkspacePane`/`TerminalView`, the xterm remeasures
  // before layout settles, and TUIs (Claude Code, etc.) get stuck at cols=1.
  return (
    <div ref={containerRef} className="relative flex min-h-0 flex-1">
      <div className="min-w-0 flex-1">{workspaceSection}</div>
      <div
        onMouseDown={sidebarOpen ? startDrag : undefined}
        onDoubleClick={
          sidebarOpen ? () => setSidebarWidth(SIDEBAR_DEFAULT_PX) : undefined
        }
        role="separator"
        aria-orientation="vertical"
        aria-hidden={!sidebarOpen}
        className={cn(
          "group relative -mx-[3px] shrink-0 cursor-col-resize",
          sidebarOpen ? "w-[7px]" : "pointer-events-none w-0",
          !isDragging && "transition-[width] duration-150 ease-out"
        )}
      >
        <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-foreground/30 group-active:bg-foreground/40" />
      </div>
      <div
        style={{
          width: sidebarIsOverlay
            ? sidebarWidth
            : showSidebar
              ? sidebarWidth
              : 0,
        }}
        className={cn(
          "h-full overflow-hidden",
          sidebarIsOverlay
            ? "absolute inset-y-0 right-0 z-[180] shrink-0 animate-[gs-slide-in-right_180ms_ease] border-l border-border bg-background shadow-2xl [-webkit-app-region:no-drag] [&_*]:[-webkit-app-region:no-drag]"
            : "relative shrink-0",
          sidebarIsOverlay &&
            sidebarOverlayExiting &&
            "animate-[gs-slide-out-right_180ms_ease_forwards]",
          !sidebarIsOverlay &&
            !isDragging &&
            "transition-[width] duration-150 ease-out",
          !showSidebar && "pointer-events-none"
        )}
        aria-hidden={!showSidebar}
      >
        <div className="absolute inset-0" style={{ width: sidebarWidth }}>
          <RightSidebar
            cwd={activeProject?.path ?? null}
            projectId={activeProject?.id ?? null}
            isActive={!!activeProject}
            activeTab={rightSidebarTab}
            onActiveTabChange={onRightSidebarTabChange}
            activeFilePath={activeTreeFilePath}
            onOpenDiff={onOpenDiffTab}
            onOpenFile={onOpenFileTab}
            topRightActions={sidebarTopActions}
          />
        </div>
      </div>
    </div>
  )
}
