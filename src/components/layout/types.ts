export type TerminalTab = {
  kind: "terminal"
  id: string
  /** Fallback name used when no custom and no auto title is present. */
  name: string
  /** User-set name; overrides everything else when present. */
  customName?: string
  /** Title emitted by the running process (OSC sequence). */
  autoTitle?: string
  /** True for restored tabs whose PTY has not been spawned yet. */
  pendingStart?: boolean
}

export type DiffTab = {
  kind: "diff"
  id: string
  name: string
  /** Path relative to project root. */
  path: string
  staged: boolean
}

export type FileTab = {
  kind: "file"
  id: string
  name: string
  /** Path relative to project root. */
  path: string
}

export type WorkspaceTab = TerminalTab | DiffTab | FileTab

export type Project = {
  id: string
  name: string
  path: string
  tabs: WorkspaceTab[]
  activeTabId: string
}
