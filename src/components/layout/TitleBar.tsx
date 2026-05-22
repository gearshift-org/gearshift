import { ProjectTabs } from "./ProjectTabs"
import { ThemeToggle } from "./ThemeToggle"
import type { Project } from "./types"

type Props = {
  projects: Project[]
  activeProjectId: string
  onSelectProject: (id: string) => void
  onAddProject: () => void
  onCloseProject: (id: string) => void
}

export function TitleBar({
  projects,
  activeProjectId,
  onSelectProject,
  onAddProject,
  onCloseProject,
}: Props) {
  return (
    <div className="flex h-10 items-stretch border-b border-border bg-card [-webkit-app-region:drag]">
      <div className="w-[88px] shrink-0" />
      <ProjectTabs
        projects={projects}
        activeId={activeProjectId}
        onSelect={onSelectProject}
        onAdd={onAddProject}
        onClose={onCloseProject}
      />
      <div className="flex-1" />
      <ThemeToggle />
    </div>
  )
}
