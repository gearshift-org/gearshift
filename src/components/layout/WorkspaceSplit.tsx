import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { TerminalPane } from "./TerminalPane"
import { ChangesPane } from "./ChangesPane"
import type { Project } from "./types"

type Props = {
  projects: Project[]
  activeProjectId: string
  terminalTabs: ReactNode
  onTerminalTitleChange?: (terminalId: string, title: string) => void
  onStartTerminal?: (tabId: string) => void
}

export function WorkspaceSplit({
  projects,
  activeProjectId,
  terminalTabs,
  onTerminalTitleChange,
  onStartTerminal,
}: Props) {
  const activeProject = projects.find((p) => p.id === activeProjectId)
  return (
    <ResizablePanelGroup orientation="horizontal" className="flex-1">
      <ResizablePanel defaultSize={50} minSize={25}>
        <div className="flex h-full flex-col">
          {terminalTabs}
          <div className="relative flex-1 min-h-0">
            {projects.map((p) => (
              <div
                key={p.id}
                className={cn(
                  "absolute inset-0",
                  p.id !== activeProjectId && "invisible pointer-events-none",
                )}
              >
                <TerminalPane
                  project={p}
                  isActive={p.id === activeProjectId}
                  onTitleChange={onTerminalTitleChange}
                  onStartTerminal={onStartTerminal}
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
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={50} minSize={25}>
        <div className="relative h-full">
          {projects.map((p) => (
            <div
              key={p.id}
              className={cn(
                "absolute inset-0",
                p.id !== activeProjectId && "invisible pointer-events-none",
              )}
            >
              <ChangesPane cwd={p.path} isActive={p.id === activeProjectId} />
            </div>
          ))}
          {!activeProject && <ChangesPane cwd={null} />}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
