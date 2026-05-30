import type { Project } from "@/components/layout/types"

function tabHasWorkingAgent(tab: Project["tabs"][number]): boolean {
  return (
    tab.kind === "terminal" &&
    tab.panes.some((pane) => pane.agentStatus?.working)
  )
}

export function projectHasWorkingAgent(project: Project): boolean {
  return project.tabs.some(tabHasWorkingAgent)
}

function projectHasCompletedAgent(project: Project): boolean {
  return project.tabs.some(
    (tab) =>
      tab.kind === "terminal" &&
      tab.panes.some((pane) => pane.agentStatus?.completed)
  )
}

export function projectHasDoneAgent(project: Project): boolean {
  return (
    !!project.agentDone &&
    !projectHasWorkingAgent(project) &&
    projectHasCompletedAgent(project)
  )
}

export function projectHasAttentionAgent(project: Project): boolean {
  return project.tabs.some(
    (tab) =>
      tab.kind === "terminal" &&
      tab.panes.some((pane) => pane.agentStatus?.needsAttention),
  )
}
