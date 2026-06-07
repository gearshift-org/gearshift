import { Check, ChevronsUpDown, Plus } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { AgentAttention } from "./AgentAttention"
import { AgentDone } from "./AgentDone"
import { AgentSpinner } from "./AgentSpinner"
import { ProjectAvatar } from "./ProjectAvatar"
import {
  projectHasAttentionAgent,
  projectHasDoneAgent,
  projectHasWorkingAgent,
} from "@/lib/projectAgentStatus"
import type { Project } from "./types"

type Props = {
  projects: Project[]
  activeProjectId: string
  onSelect: (id: string) => void
  onAdd: () => void
}

function ProjectAgentState({ project }: { project: Project }) {
  const hasWorkingAgent = projectHasWorkingAgent(project)
  const hasAttentionAgent = !hasWorkingAgent && projectHasAttentionAgent(project)
  const hasDoneAgent = projectHasDoneAgent(project)

  if (hasWorkingAgent) return <AgentSpinner className="shrink-0" />
  if (hasAttentionAgent) return <AgentAttention className="shrink-0" />
  if (!hasDoneAgent) return null

  return <AgentDone className="size-3" />
}

/**
 * Compact project switcher shown in the top bar when the vertical project
 * sidebar is collapsed. Mirrors the sidebar's role — pick the active project
 * or add a new one — without taking up the full sidebar width.
 */
export function ProjectSwitcher({
  projects,
  activeProjectId,
  onSelect,
  onAdd,
}: Props) {
  const activeProject = projects.find((p) => p.id === activeProjectId)
  if (!activeProject) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch project"
        className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-foreground outline-none transition-colors hover:bg-foreground/10 [-webkit-app-region:no-drag]"
      >
        <ProjectAvatar name={activeProject.name} path={activeProject.path} />
        <span className="max-w-[200px] truncate">{activeProject.name}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[220px]">
        {projects.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onClick={() => onSelect(p.id)}
            className="gap-2"
          >
            <ProjectAvatar name={p.name} path={p.path} />
            <ProjectAgentState project={p} />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            {p.id === activeProjectId && (
              <Check className="size-3.5 shrink-0 text-muted-foreground" />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onAdd}>
          <Plus className="size-3.5" />
          Add Project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
