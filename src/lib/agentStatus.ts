import type {
  Project,
  RuntimeAgentName,
  TerminalAgentStatus,
  TerminalPane,
  WorkspaceTab,
} from "@/components/layout/types"

export type TerminalAgentState =
  | "blocked"
  | "working"
  | "done"
  | "idle"
  | "unknown"

export type AgentFallbackSignal = Extract<
  TerminalAgentState,
  "blocked" | "working" | "idle"
>

const STATE_PRIORITY: Record<TerminalAgentState, number> = {
  blocked: 4,
  working: 3,
  done: 2,
  idle: 1,
  unknown: 0,
}

const BRAILLE_SPINNER_TITLE_RE = /^[\u2800-\u28ff]\s/
const CLAUDE_IDLE_TITLE_RE = /^\u2733\s/

function higherPriorityState(
  current: TerminalAgentState,
  next: TerminalAgentState
): TerminalAgentState {
  return STATE_PRIORITY[next] > STATE_PRIORITY[current] ? next : current
}

export function terminalAgentState(
  status: TerminalAgentStatus | undefined
): TerminalAgentState {
  if (!status) return "unknown"
  if (status.needsAttention) return "blocked"
  if (status.working) return "working"
  if (status.completed) return "done"
  if (status.running || status.agentName || status.agentSessionId) return "idle"
  return "unknown"
}

export function terminalPaneAgentState(
  pane: Pick<TerminalPane, "agentStatus">
): TerminalAgentState {
  return terminalAgentState(pane.agentStatus)
}

export function terminalTabAgentState(tab: WorkspaceTab): TerminalAgentState {
  if (tab.kind !== "terminal") return "unknown"
  return tab.panes.reduce<TerminalAgentState>(
    (state, pane) => higherPriorityState(state, terminalPaneAgentState(pane)),
    "unknown"
  )
}

function projectHasTerminalPane(project: Project): boolean {
  return project.tabs.some(
    (tab) => tab.kind === "terminal" && tab.panes.length > 0
  )
}

export function projectAgentState(project: Project): TerminalAgentState {
  const tabState = project.tabs.reduce<TerminalAgentState>(
    (state, tab) => higherPriorityState(state, terminalTabAgentState(tab)),
    "unknown"
  )
  const hasTerminalPane = projectHasTerminalPane(project)
  const states: TerminalAgentState[] = [
    tabState,
    hasTerminalPane && project.agentNeedsAttention ? "blocked" : "unknown",
    hasTerminalPane && project.agentDone ? "done" : "unknown",
  ]
  return states.reduce<TerminalAgentState>(higherPriorityState, "unknown")
}

export function terminalAgentIsActive(
  status: TerminalAgentStatus | undefined
): boolean {
  return terminalAgentState(status) !== "unknown"
}

function stripTerminalControlSequences(value: string): string {
  let output = ""
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code === 27) {
      const next = value[index + 1]
      index += 1
      if (next === "[") {
        index += 1
        while (index < value.length) {
          const finalCode = value.charCodeAt(index)
          if (finalCode >= 64 && finalCode <= 126) break
          index += 1
        }
      } else if (next === "]") {
        index += 1
        while (index < value.length) {
          const charCode = value.charCodeAt(index)
          if (charCode === 7) break
          if (charCode === 27 && value[index + 1] === "\\") {
            index += 1
            break
          }
          index += 1
        }
      }
      output += " "
      continue
    }
    if (code < 32 || code === 127) {
      output += " "
      continue
    }
    output += value[index]
  }
  return output
}

function normalizeSignalText(value: string): string {
  return stripTerminalControlSequences(value)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

export function detectAgentTitleFallbackSignal(
  agentName: RuntimeAgentName | undefined,
  title: string
): AgentFallbackSignal | null {
  const trimmed = title.trim()
  if (!trimmed) return null

  if (trimmed.includes("Action Required")) return "blocked"
  if (BRAILLE_SPINNER_TITLE_RE.test(trimmed)) return "working"

  if (agentName === "claude" && CLAUDE_IDLE_TITLE_RE.test(trimmed)) {
    return "idle"
  }

  if (agentName === "codex") return "idle"

  return null
}

export function detectAgentOutputFallbackSignal(
  agentName: RuntimeAgentName | undefined,
  chunk: string
): AgentFallbackSignal | null {
  const text = normalizeSignalText(chunk.slice(-8000))
  if (!text) return null

  if (
    text.includes("action required") ||
    text.includes("press enter to confirm or esc to cancel") ||
    text.includes("enter to submit answer") ||
    text.includes("enter to submit all") ||
    text.includes("allow command?") ||
    (text.includes("enter to select") && text.includes("esc to cancel")) ||
    (agentName === "opencode" &&
      text.includes("enter submit") &&
      text.includes("esc dismiss") &&
      (text.includes("select") || text.includes("type your own answer"))) ||
    (text.includes("do you want to proceed?") &&
      (text.includes("esc to cancel") ||
        text.includes("tab to amend") ||
        text.includes("ctrl+e to explain") ||
        text.includes("bash command") ||
        text.includes("contains expansion")))
  ) {
    return "blocked"
  }

  return null
}
