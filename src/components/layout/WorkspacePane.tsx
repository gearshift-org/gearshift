import { cn } from "@/lib/utils"
import { TerminalView } from "./TerminalView"
import { SingleFileDiff } from "./SingleFileDiff"
import { FilePreview } from "./FilePreview"
import { displayName, tabDisplayName } from "./terminalName"
import type { Project, TerminalTab, WorkspaceTab } from "./types"

type Props = {
  project: Project | undefined
  isActive?: boolean
  onTitleChange?: (terminalId: string, title: string) => void
  onStartTerminal?: (tabId: string) => void
}

function PaneContent({
  tab,
  project,
  isActive,
  onTitleChange,
  onStartTerminal,
}: {
  tab: WorkspaceTab
  project: Project
  isActive: boolean
  onTitleChange?: (terminalId: string, title: string) => void
  onStartTerminal?: (tabId: string) => void
}) {
  if (tab.kind === "terminal") {
    if (tab.pendingStart) {
      return <PendingPane tab={tab} onStart={() => onStartTerminal?.(tab.id)} />
    }
    return (
      <TerminalView
        sessionId={tab.id}
        isActive={isActive}
        onTitleChange={(title) => onTitleChange?.(tab.id, title)}
      />
    )
  }
  if (tab.kind === "diff") {
    return (
      <SingleFileDiff
        cwd={project.path}
        path={tab.path}
        staged={tab.staged}
      />
    )
  }
  return <FilePreview cwd={project.path} path={tab.path} />
}

export function WorkspacePane({
  project,
  isActive = true,
  onTitleChange,
  onStartTerminal,
}: Props) {
  const activeTab = project?.tabs.find((t) => t.id === project.activeTabId)

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex h-[34px] shrink-0 items-center border-b border-border px-4 text-xs text-muted-foreground">
        {activeTab
          ? tabDisplayName(activeTab)
          : project
            ? "No tab"
            : "No project"}
      </div>
      <div className="relative flex-1">
        {project?.tabs.map((t) => (
          <div
            key={t.id}
            className={cn(
              "absolute inset-0",
              t.id !== project.activeTabId && "invisible pointer-events-none",
            )}
          >
            <PaneContent
              tab={t}
              project={project}
              isActive={isActive && t.id === project.activeTabId}
              onTitleChange={onTitleChange}
              onStartTerminal={onStartTerminal}
            />
          </div>
        ))}
        {project && project.tabs.length === 0 && (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">
            No terminals — click + to open one
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

function PendingPane({
  tab,
  onStart,
}: {
  tab: TerminalTab
  onStart: () => void
}) {
  return (
    <div className="grid h-full place-items-center bg-card">
      <div className="flex flex-col items-center gap-3 text-xs text-muted-foreground">
        <span>"{displayName(tab)}" is not running.</span>
        <button
          onClick={onStart}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-accent/40"
        >
          Start terminal
        </button>
      </div>
    </div>
  )
}
