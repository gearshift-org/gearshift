import type { Project } from "@/components/layout/types"
import { projectAgentState } from "./agentStatus"

export function projectHasWorkingAgent(project: Project): boolean {
  return projectAgentState(project) === "working"
}

export function projectHasDoneAgent(project: Project): boolean {
  return projectAgentState(project) === "done"
}

export function projectHasAttentionAgent(project: Project): boolean {
  return projectAgentState(project) === "blocked"
}
