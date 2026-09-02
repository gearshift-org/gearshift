/**
 * Lightweight per-session signals between a terminal's body (TerminalView) and
 * its header (PaneHeader). Uses window CustomEvents keyed by sessionId — the
 * same pattern as the app's other cross-component signals (see projects.ts) —
 * so no shared store or prop threading is needed across the pane boundary.
 */

const HISTORY_POPOVER_EVENT = (sessionId: string) =>
  `gearshift:terminalHistoryPopover:${sessionId}`

const CLIPBOARD_PASTE_EVENT = (sessionId: string) =>
  `gearshift:terminalClipboardPaste:${sessionId}`

const TOGGLE_ACTIVE_TERMINAL_EXPAND_EVENT =
  "gearshift:toggleActiveTerminalExpand"

type ClipboardPasteEventDetail = { handled: boolean; text?: string }

/** Ask the active terminal tab to maximize or restore its active split. */
export function requestToggleActiveTerminalExpand() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(TOGGLE_ACTIVE_TERMINAL_EXPAND_EVENT))
}

/** Subscribe to active-terminal maximize/restore requests. */
export function onToggleActiveTerminalExpand(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  window.addEventListener(TOGGLE_ACTIVE_TERMINAL_EXPAND_EVENT, cb)
  return () =>
    window.removeEventListener(TOGGLE_ACTIVE_TERMINAL_EXPAND_EVENT, cb)
}

/** Ask the header's chat-history popover for this session to open. */
export function openTerminalHistoryPopover(sessionId: string) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(HISTORY_POPOVER_EVENT(sessionId)))
}

/** Subscribe to open requests for this session's chat-history popover. */
export function onOpenTerminalHistoryPopover(
  sessionId: string,
  cb: () => void
): () => void {
  if (typeof window === "undefined") return () => {}
  const name = HISTORY_POPOVER_EVENT(sessionId)
  window.addEventListener(name, cb)
  return () => window.removeEventListener(name, cb)
}

/** Ask a mounted terminal body to paste from the system clipboard. */
export function requestTerminalClipboardPaste(
  sessionId: string,
  text?: string
): boolean {
  if (typeof window === "undefined") return false
  const detail: ClipboardPasteEventDetail = { handled: false, text }
  window.dispatchEvent(
    new CustomEvent(CLIPBOARD_PASTE_EVENT(sessionId), { detail })
  )
  return detail.handled
}

/** Subscribe to clipboard paste requests for this terminal session. */
export function onRequestTerminalClipboardPaste(
  sessionId: string,
  cb: (text?: string) => void
): () => void {
  if (typeof window === "undefined") return () => {}
  const name = CLIPBOARD_PASTE_EVENT(sessionId)
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<ClipboardPasteEventDetail>).detail
    if (detail) detail.handled = true
    cb(detail?.text)
  }
  window.addEventListener(name, handler)
  return () => window.removeEventListener(name, handler)
}
