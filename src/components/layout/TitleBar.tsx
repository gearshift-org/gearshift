import type { ReactNode } from "react"
import { PanelRight } from "lucide-react"
import { ProjectGitStatusBadge } from "./ProjectGitStatusBadge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useActionAccelerator } from "@/lib/keybindings/useKeybindings"
import type { Project } from "./types"

type Props = {
  projects: Project[]
  activeProjectId: string
  sidebarOpen?: boolean
  onToggleSidebar?: () => void
  onOpenChanges?: () => void
  showRightControls?: boolean
  // Reserve the leading 88px gap for the macOS traffic lights.
  showTrafficLightSpacer?: boolean
  // Rendered just after the traffic-light spacer (e.g. an expand control when
  // the vertical project sidebar is collapsed).
  leading?: ReactNode
}

export function TitleBar({
  projects,
  activeProjectId,
  sidebarOpen,
  onToggleSidebar,
  onOpenChanges,
  showRightControls = true,
  showTrafficLightSpacer = true,
  leading,
}: Props) {
  const activeProject = projects.find(
    (project) => project.id === activeProjectId
  )
  const sidebarShortcut = useActionAccelerator("sidebar.toggle")

  return (
    <div className="flex h-[34px] shrink-0 items-stretch border-b border-border bg-background [-webkit-app-region:drag]">
      {showTrafficLightSpacer && <div className="w-[88px] shrink-0" />}
      {leading}
      <div className="flex-1" />
      {showRightControls && (
        <>
          {onOpenChanges && (
            <ProjectGitStatusBadge
              cwd={activeProject?.path ?? null}
              onOpenChanges={onOpenChanges}
            />
          )}
          {onToggleSidebar && (
            <div className="flex items-center pr-4 [-webkit-app-region:no-drag]">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={onToggleSidebar}
                      aria-pressed={sidebarOpen}
                      aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                      className="grid size-5 place-items-center rounded-sm text-foreground transition-colors hover:bg-foreground/15"
                    >
                      <PanelRight className="size-3.5" />
                    </button>
                  }
                />
                <TooltipContent>
                  {(sidebarOpen ? "Hide sidebar" : "Show sidebar") +
                    (sidebarShortcut ? ` (${sidebarShortcut})` : "")}
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </>
      )}
    </div>
  )
}
