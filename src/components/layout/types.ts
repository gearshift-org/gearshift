export type TerminalTab = {
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

export type Project = {
  id: string
  name: string
  path: string
  terminals: TerminalTab[]
  activeTerminalId: string
}
