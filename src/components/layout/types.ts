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
  /**
   * The coding agent's own session id (e.g. Claude's resumable session UUID),
   * reported via lifecycle hooks. Persisted so a restored pane knows which
   * agent conversation it belongs to.
   */
  agentSessionId?: string
  /**
   * Human-readable title for the agent session — the agent's own AI title
   * (Claude/OpenCode) or first user message (codex/pi/gemini). Used as the
   * pane/tab title, below an explicit customName. Resolved from disk via the
   * agentSessionId.
   */
  agentSessionTitle?: string
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
  /** The agent's own session id (e.g. Claude's resumable session UUID), if reported by a hook. */
  agentSessionId?: string
  /** Human-readable session title resolved from the agent's transcript (AI title or first prompt). */
  agentSessionTitle?: string
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
  /**
   * Recursive split arrangement over the tab's pane ids (Ghostty-style nested
   * splits). When absent, panes fall back to a single horizontal row.
   */
  layout?: TerminalLayout
}

export type SplitDirection = "horizontal" | "vertical"

/**
 * Where a dragged pane is dropped relative to a target pane. Edges reposition
 * the pane into a split on that side; "center" swaps the two panes.
 */
export type DropZone = "left" | "right" | "top" | "bottom" | "center"

/**
 * Binary-ish split tree. A leaf points at a pane id; a split arranges its
 * children left-to-right ("horizontal") or top-to-bottom ("vertical").
 */
export type TerminalLayout =
  | { type: "leaf"; paneId: string }
  | {
      type: "split"
      direction: SplitDirection
      children: TerminalLayout[]
      /** Panel percentages from react-resizable-panels, persisted per split. */
      sizes?: number[]
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

/**
 * A request to reveal (scroll to + select) a specific line of a file, e.g. from
 * a content-search hit. `seq` is a monotonic nonce so re-opening the same
 * file/line still re-triggers the scroll even though the props are unchanged.
 */
export type FileReveal = {
  path: string
  line: number
  seq: number
}

export type Project = {
  id: string
  name: string
  path: string
  tabs: WorkspaceTab[]
  activeTabId: string
  /** Ephemeral marker shown after a background coding agent finishes work. */
  agentDone?: boolean
  /** Ephemeral marker shown after a background coding agent needs input. */
  agentNeedsAttention?: boolean
}
