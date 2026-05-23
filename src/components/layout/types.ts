export type TerminalPane = {
  /** PTY session id (also acts as DOM key). */
  id: string
  /** Title emitted by the running process (OSC sequence). */
  autoTitle?: string
  /** True for restored panes whose PTY has not been spawned yet. */
  pendingStart?: boolean
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
}
