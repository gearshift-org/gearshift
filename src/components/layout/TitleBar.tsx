import { PanelRight } from "lucide-react"
import { ProjectGitStatusBadge } from "./ProjectGitStatusBadge"
import { ProjectTabs } from "./ProjectTabs"
import { ThemeToggle } from "./ThemeToggle"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { RecentProject } from "@/lib/projects"
import type { Project } from "./types"

type Props = {
  projects: Project[]
  activeProjectId: string
  recents: RecentProject[]
  onSelectProject: (id: string) => void
  onAddProject: () => void
  onPickRecent: (recent: RecentProject) => void
  onCloseProject: (id: string) => void
  onCloseAllProjectTerminals?: (id: string) => void
  onCloseOtherProjects?: (id: string) => void
  onCloseProjectsToRight?: (id: string) => void
  onOpenProjectInVSCode?: (id: string) => void
  onRevealProjectInFinder?: (id: string) => void
  onReorderProjects?: (fromId: string, toId: string) => void
  sidebarOpen?: boolean
  onToggleSidebar?: () => void
  onOpenChanges?: () => void
  showRightControls?: boolean
}

export function TitleBar({
  projects,
  activeProjectId,
  recents,
  onSelectProject,
  onAddProject,
  onPickRecent,
  onCloseProject,
  onCloseAllProjectTerminals,
  onCloseOtherProjects,
  onCloseProjectsToRight,
  onOpenProjectInVSCode,
  onRevealProjectInFinder,
  onReorderProjects,
  sidebarOpen,
  onToggleSidebar,
  onOpenChanges,
  showRightControls = true,
}: Props) {
  const activeProject = projects.find(
    (project) => project.id === activeProjectId
  )

  return (
    <div className="flex h-[34px] shrink-0 items-stretch border-b border-border bg-background [-webkit-app-region:drag]">
      <div className="w-[88px] shrink-0" />
      <ProjectTabs
        projects={projects}
        activeId={activeProjectId}
        recents={recents}
        onSelect={onSelectProject}
        onAdd={onAddProject}
        onPickRecent={onPickRecent}
        onClose={onCloseProject}
        onCloseAllTerminals={onCloseAllProjectTerminals}
        onCloseOthers={onCloseOtherProjects}
        onCloseToRight={onCloseProjectsToRight}
        onOpenInVSCode={onOpenProjectInVSCode}
        onRevealInFinder={onRevealProjectInFinder}
        onReorder={onReorderProjects}
      />
      <div className="flex-1" />
      {showRightControls && (
        <>
          {onOpenChanges && (
            <ProjectGitStatusBadge
              cwd={activeProject?.path ?? null}
              onOpenChanges={onOpenChanges}
            />
          )}
          <ThemeToggle />
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
                  {sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </>
      )}
    </div>
  )
}
