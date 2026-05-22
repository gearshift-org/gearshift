import { ProjectTabs } from "./ProjectTabs"
import { ThemeToggle } from "./ThemeToggle"
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
  onCloseOtherProjects?: (id: string) => void
  onCloseProjectsToRight?: (id: string) => void
  onOpenProjectInVSCode?: (id: string) => void
  onReorderProjects?: (fromId: string, toId: string) => void
}

export function TitleBar({
  projects,
  activeProjectId,
  recents,
  onSelectProject,
  onAddProject,
  onPickRecent,
  onCloseProject,
  onCloseOtherProjects,
  onCloseProjectsToRight,
  onOpenProjectInVSCode,
  onReorderProjects,
}: Props) {
  return (
    <div className="box-content flex h-[34px] shrink-0 items-stretch border-b border-border bg-background [-webkit-app-region:drag]">
      <div className="w-[88px] shrink-0" />
      <ProjectTabs
        projects={projects}
        activeId={activeProjectId}
        recents={recents}
        onSelect={onSelectProject}
        onAdd={onAddProject}
        onPickRecent={onPickRecent}
        onClose={onCloseProject}
        onCloseOthers={onCloseOtherProjects}
        onCloseToRight={onCloseProjectsToRight}
        onOpenInVSCode={onOpenProjectInVSCode}
        onReorder={onReorderProjects}
      />
      <div className="flex-1" />
      <ThemeToggle />
    </div>
  )
}
