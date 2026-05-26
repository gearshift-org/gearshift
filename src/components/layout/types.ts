export type TerminalPane = {
  /** Stable DOM-key id (renderer-assigned). Persists across restarts. */
  id: string
  /** Daemon session id. Set on attach/create; cleared on exit. */
  sessionId?: string
  /** Saved session id from disk — tried via adopt before falling back to a fresh create. */
  pendingSessionId?: string
  /** Title emitted by the running process (OSC sequence). */
  autoTitle?: string
  /** User-set name for this specific pane; overrides the auto title. */
  customName?: string
  /** Ephemeral coding-agent status detected from the PTY process/output. */
  agentStatus?: TerminalAgentStatus
  /** True for restored panes whose PTY has not been spawned (or adopted) yet. */
  pendingStart?: boolean
}

export type TerminalAgentName =
  | "claude"
  | "codex"
  | "opencode"
  | "pi"
  | "gemini"

export type TerminalAgentStatus = {
  running: boolean
  working: boolean
  agentName?: TerminalAgentName
  /** Timestamp when the current agent task started working. */
  workStartedAt?: number
  /** Timestamp when the current agent task completed. */
  completedAt?: number
  /** True only when an authoritative completion signal was received. */
  completed?: boolean
  /** True when the agent is blocked waiting on the user (permission/idle prompt). */
  needsAttention?: boolean
}

export type TerminalTab = {
  kind: "terminal"
  /** Stable tab id used by router. Independent of any PTY session id. */
  id: string
  /** Fallback name used when no custom and no auto title is present. */
  name: string
  /** User-set name; overrides everything else when present. */
  customName?: string
  panes: TerminalPane[]
  /** Which pane currently has focus. */
  activePaneId: string
}

export type DiffTab = {
  kind: "diff"
  id: string
  name: string
  /** Path relative to project root. */
  path: string
  staged: boolean
  /** True when opened as a "preview" — gets replaced by the next preview open. */
  preview?: boolean
}

export type FileTab = {
  kind: "file"
  id: string
  name: string
  /** Path relative to project root. */
  path: string
  /** True when opened as a "preview" — gets replaced by the next preview open. */
  preview?: boolean
}

export type WorkspaceTab = TerminalTab | DiffTab | FileTab

export type Project = {
  id: string
  name: string
  path: string
  tabs: WorkspaceTab[]
  activeTabId: string
  /** Ephemeral marker shown after a background coding agent finishes work. */
  agentDone?: boolean
}
