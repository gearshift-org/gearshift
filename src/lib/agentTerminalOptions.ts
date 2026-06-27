import * as React from "react"
import type { TerminalAgentName } from "@/components/layout/types"
import { store } from "@/lib/store"

const STORAGE_KEY = "gearshift.agentTerminalOptions"

export const AGENT_TERMINAL_LABELS: Record<TerminalAgentName, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  pi: "Pi",
}

export const AGENT_TERMINAL_NAMES = Object.keys(
  AGENT_TERMINAL_LABELS
) as TerminalAgentName[]

export type AgentTerminalOptions = Record<TerminalAgentName, string>

export const DEFAULT_AGENT_TERMINAL_OPTIONS: AgentTerminalOptions = {
  claude: "",
  codex: "",
  opencode: "",
  pi: "",
}

export const AGENT_TERMINAL_FULL_ACCESS_OPTIONS: AgentTerminalOptions = {
  claude: "--dangerously-skip-permissions",
  codex: "--yolo",
  opencode: "--dangerously-skip-permissions",
  pi: "--tools read,bash,edit,write,grep,find,ls",
}

function parseAgentTerminalOptions(raw: string | null): AgentTerminalOptions {
  if (!raw) return DEFAULT_AGENT_TERMINAL_OPTIONS

  try {
    const parsed = JSON.parse(raw) as Partial<Record<TerminalAgentName, unknown>>
    return AGENT_TERMINAL_NAMES.reduce<AgentTerminalOptions>(
      (options, agentName) => ({
        ...options,
        [agentName]:
          typeof parsed[agentName] === "string"
            ? parsed[agentName].trim()
            : "",
      }),
      { ...DEFAULT_AGENT_TERMINAL_OPTIONS }
    )
  } catch {
    return DEFAULT_AGENT_TERMINAL_OPTIONS
  }
}

function hasCustomOptions(options: AgentTerminalOptions): boolean {
  return AGENT_TERMINAL_NAMES.some((agentName) => options[agentName].trim())
}

export function loadAgentTerminalOptions(): AgentTerminalOptions {
  return parseAgentTerminalOptions(store.get(STORAGE_KEY))
}

export function saveAgentTerminalOptions(options: AgentTerminalOptions): void {
  const cleaned = AGENT_TERMINAL_NAMES.reduce<AgentTerminalOptions>(
    (next, agentName) => ({
      ...next,
      [agentName]: options[agentName].trim(),
    }),
    { ...DEFAULT_AGENT_TERMINAL_OPTIONS }
  )

  if (!hasCustomOptions(cleaned)) {
    store.remove(STORAGE_KEY)
    return
  }

  store.set(STORAGE_KEY, JSON.stringify(cleaned))
}

export function getAgentTerminalOptions(agentName: TerminalAgentName): string {
  return loadAgentTerminalOptions()[agentName]
}

export function useAgentTerminalOptions() {
  const [options, setOptionsState] = React.useState(() =>
    loadAgentTerminalOptions()
  )

  React.useEffect(
    () => store.onReady(() => setOptionsState(loadAgentTerminalOptions())),
    []
  )

  const setAgentOptions = React.useCallback(
    (agentName: TerminalAgentName, value: string) => {
      setOptionsState((current) => {
        const next = { ...current, [agentName]: value }
        saveAgentTerminalOptions(next)
        return next
      })
    },
    []
  )

  const resetOptions = React.useCallback(() => {
    store.remove(STORAGE_KEY)
    setOptionsState(DEFAULT_AGENT_TERMINAL_OPTIONS)
  }, [])

  return {
    options,
    setAgentOptions,
    resetOptions,
    hasCustomOptions: hasCustomOptions(options),
  }
}
