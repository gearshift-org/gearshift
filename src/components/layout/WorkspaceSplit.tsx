import { useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { WorkspacePane } from "./WorkspacePane"
import { RightSidebar } from "./RightSidebar"
import { loadSidebarWidth, saveSidebarWidth } from "@/lib/projects"
import { store } from "@/lib/store"
import type { Project } from "./types"

const SIDEBAR_DEFAULT_PX = 410
const SIDEBAR_MIN_PX = 220
const SIDEBAR_MAX_PX = 800

function clampWidth(n: number): number {
  return Math.min(SIDEBAR_MAX_PX, Math.max(SIDEBAR_MIN_PX, n))
}

type Props = {
  projects: Project[]
  activeProjectId: string
  workspaceTabs: ReactNode
  sidebarOpen?: boolean
  onTerminalTitleChange?: (
    tabId: string,
    paneId: string,
    title: string,
  ) => void
  onStartTerminal?: (tabId: string, paneId: string) => void
  onSplitTerminal?: (tabId: string) => void
  onClosePane?: (tabId: string, paneId: string) => void
  onFocusPane?: (tabId: string, paneId: string) => void
  onOpenDiffTab: (path: string, staged: boolean) => void
  onOpenFileTab: (path: string) => void
  rightSidebarTab?: "changes" | "files"
  onRightSidebarTabChange?: (tab: "changes" | "files") => void
  activeTreeFilePath?: string
}

export function WorkspaceSplit({
  projects,
  activeProjectId,
  workspaceTabs,
  sidebarOpen = true,
  onTerminalTitleChange,
  onStartTerminal,
  onSplitTerminal,
  onClosePane,
  onFocusPane,
  onOpenDiffTab,
  onOpenFileTab,
  rightSidebarTab,
  onRightSidebarTabChange,
  activeTreeFilePath,
}: Props) {
  const activeProject = projects.find((p) => p.id === activeProjectId)
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
    [],
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  // Persist whenever width settles (debounced via effect-cleanup style).
  useEffect(() => {
    const id = window.setTimeout(() => saveSidebarWidth(sidebarWidth), 250)
    return () => window.clearTimeout(id)
  }, [sidebarWidth])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = d.startX - e.clientX
      setSidebarWidth(clampWidth(d.startWidth + dx))
    }
    const onUp = () => {
      dragRef.current = null
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
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }

  const workspaceSection = (
    <div className="flex h-full flex-col">
      {workspaceTabs}
      <div className="relative flex-1 min-h-0">
        {projects.map((p) => (
          <div
            key={p.id}
            className={cn(
              "absolute inset-0",
              p.id !== activeProjectId && "invisible pointer-events-none",
            )}
          >
            <WorkspacePane
              project={p}
              isActive={p.id === activeProjectId}
              onTitleChange={onTerminalTitleChange}
              onStartTerminal={onStartTerminal}
              onSplitTerminal={onSplitTerminal}
              onClosePane={onClosePane}
              onFocusPane={onFocusPane}
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

  if (!sidebarOpen) {
    return <div className="flex-1 min-h-0">{workspaceSection}</div>
  }

  return (
    <div ref={containerRef} className="flex flex-1 min-h-0">
      <div className="min-w-0 flex-1">{workspaceSection}</div>
      <div
        onMouseDown={startDrag}
        role="separator"
        aria-orientation="vertical"
        className="group relative -mx-[3px] w-[7px] shrink-0 cursor-col-resize"
      >
        <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-foreground/30 group-active:bg-foreground/40" />
      </div>
      <div
        style={{ width: sidebarWidth }}
        className="relative h-full shrink-0"
      >
        {projects.map((p) => (
          <div
            key={p.id}
            className={cn(
              "absolute inset-0",
              p.id !== activeProjectId && "invisible pointer-events-none",
            )}
          >
            <RightSidebar
              cwd={p.path}
              isActive={p.id === activeProjectId}
              activeTab={rightSidebarTab}
              onActiveTabChange={onRightSidebarTabChange}
              activeFilePath={activeTreeFilePath}
              onOpenDiff={onOpenDiffTab}
              onOpenFile={onOpenFileTab}
            />
          </div>
        ))}
        {!activeProject && (
          <RightSidebar
            cwd={null}
            activeTab={rightSidebarTab}
            onActiveTabChange={onRightSidebarTabChange}
            activeFilePath={activeTreeFilePath}
            onOpenDiff={onOpenDiffTab}
            onOpenFile={onOpenFileTab}
          />
        )}
      </div>
    </div>
  )
}
