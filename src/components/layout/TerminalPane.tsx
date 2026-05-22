import { cn } from "@/lib/utils"
import { TerminalView } from "./TerminalView"
import { displayName } from "./terminalName"
import type { Project, TerminalTab } from "./types"

type Props = {
  project: Project | undefined
  onTitleChange?: (terminalId: string, title: string) => void
  onStartTerminal?: (tabId: string) => void
}

export function TerminalPane({
  project,
  onTitleChange,
  onStartTerminal,
}: Props) {
  const activeTab = project?.terminals.find(
    (t) => t.id === project.activeTerminalId,
  )

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex h-10 items-center border-b border-border px-4 text-xs text-muted-foreground">
        {activeTab ? displayName(activeTab) : project ? "No terminal" : "No project"}
      </div>
      <div className="relative flex-1">
        {project?.terminals.map((t) => (
          <div
            key={t.id}
            className={cn(
              "absolute inset-0",
              t.id === project.activeTerminalId
                ? "visible"
                : "invisible pointer-events-none",
            )}
          >
            {t.pendingStart ? (
              <PendingPane tab={t} onStart={() => onStartTerminal?.(t.id)} />
            ) : (
              <TerminalView
                sessionId={t.id}
                isActive={t.id === project.activeTerminalId}
                onTitleChange={(title) => onTitleChange?.(t.id, title)}
              />
            )}
          </div>
        ))}
        {project && project.terminals.length === 0 && (
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
