/**
 * Lightweight per-session signals between a terminal's body (TerminalView) and
 * its header (PaneHeader). Uses window CustomEvents keyed by sessionId — the
 * same pattern as the app's other cross-component signals (see projects.ts) —
 * so no shared store or prop threading is needed across the pane boundary.
 */

const HISTORY_POPOVER_EVENT = (sessionId: string) =>
  `gearshift:terminalHistoryPopover:${sessionId}`

/** Ask the header's chat-history popover for this session to open. */
export function openTerminalHistoryPopover(sessionId: string) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(HISTORY_POPOVER_EVENT(sessionId)))
}

/** Subscribe to open requests for this session's chat-history popover. */
export function onOpenTerminalHistoryPopover(
  sessionId: string,
  cb: () => void,
): () => void {
  if (typeof window === "undefined") return () => {}
  const name = HISTORY_POPOVER_EVENT(sessionId)
  window.addEventListener(name, cb)
  return () => window.removeEventListener(name, cb)
}
