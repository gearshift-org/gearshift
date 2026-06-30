export type ActionId =
  | "sidebar.toggle"
  | "projectSidebar.toggle"
  | "palette.open"
  | "terminal.split"
  | "terminal.splitVertical"
  | "terminal.quickSplitHold"
  | "terminal.new"
  | "terminal.close"
  | "terminal.last"
  | "terminal.copyPath"
  | "nav.back"
  | "nav.forward"
  | "spaces.cycle"
  | "settings.open"
  | "titlebar.togglePin"
  | "theme.cycle"

export type Scope = "renderer" | "electron-menu"

export type ActionDef = {
  id: ActionId
  label: string
  description?: string
  defaultAccelerator: string
  scope: Scope
  // The binding is a modifier-only hold chord (e.g. "CmdOrCtrl+Alt") rather
  // than a keystroke. Matched against held modifiers via matchesModifierChord,
  // never against keydown actions.
  modifiersOnly?: boolean
}

export const ACTIONS: readonly ActionDef[] = [
  {
    id: "sidebar.toggle",
    label: "Toggle Right Sidebar",
    description: "Show or hide the right sidebar (Git, Files, History)",
    defaultAccelerator: "CmdOrCtrl+2",
    scope: "renderer",
  },
  {
    id: "projectSidebar.toggle",
    label: "Toggle Project Sidebar",
    description: "Show or hide the left project sidebar (vertical layout)",
    defaultAccelerator: "CmdOrCtrl+1",
    scope: "renderer",
  },
  {
    id: "palette.open",
    label: "Open Command Palette",
    defaultAccelerator: "CmdOrCtrl+P",
    scope: "renderer",
  },
  {
    id: "terminal.split",
    label: "Split Terminal Right",
    defaultAccelerator: "CmdOrCtrl+D",
    scope: "renderer",
  },
  {
    id: "terminal.splitVertical",
    label: "Split Terminal Down",
    defaultAccelerator: "CmdOrCtrl+Shift+D",
    scope: "renderer",
  },
  {
    id: "terminal.quickSplitHold",
    label: "Quick Split (Hold + Click)",
    description:
      "Hold these modifiers to show split zones on terminal panes; click a zone to open a new terminal there",
    defaultAccelerator: "CmdOrCtrl+Alt",
    scope: "renderer",
    modifiersOnly: true,
  },
  {
    id: "terminal.new",
    label: "New Terminal",
    defaultAccelerator: "CmdOrCtrl+T",
    scope: "electron-menu",
  },
  {
    id: "terminal.close",
    label: "Close Terminal",
    defaultAccelerator: "CmdOrCtrl+W",
    scope: "electron-menu",
  },
  {
    id: "terminal.last",
    // Previously CmdOrCtrl+2 — now owned by sidebar.toggle, so unset by default.
    label: "Go to Last Terminal",
    defaultAccelerator: "",
    scope: "renderer",
  },
  {
    id: "terminal.copyPath",
    label: "Copy Terminal Path",
    description:
      "Copy the active terminal's current directory to the clipboard",
    defaultAccelerator: "CmdOrCtrl+Shift+C",
    scope: "renderer",
  },
  {
    id: "nav.back",
    label: "Navigate Back",
    description: "Go back to the previous project/tab in history.",
    defaultAccelerator: "CmdOrCtrl+Shift+ArrowLeft",
    scope: "renderer",
  },
  {
    id: "nav.forward",
    label: "Navigate Forward",
    description: "Go forward to the next project/tab in history.",
    defaultAccelerator: "CmdOrCtrl+Shift+ArrowRight",
    scope: "renderer",
  },
  {
    id: "spaces.cycle",
    label: "Cycle Spaces",
    description: "Switch to the next space in the project sidebar.",
    defaultAccelerator: "",
    scope: "renderer",
  },
  {
    id: "settings.open",
    label: "Open Settings",
    defaultAccelerator: "CmdOrCtrl+,",
    scope: "renderer",
  },
  {
    id: "titlebar.togglePin",
    label: "Pin/Unpin Title Bar",
    description: "Toggle the auto-hide title bar between pinned and hidden",
    defaultAccelerator: "CmdOrCtrl+Shift+S",
    scope: "renderer",
  },
  {
    id: "theme.cycle",
    label: "Cycle Theme",
    description:
      "Cycle through the theme families for the current appearance (light or dark)",
    defaultAccelerator: "CmdOrCtrl+Shift+T",
    scope: "renderer",
  },
] as const

export type BindingsMap = Record<ActionId, string[]>

export function defaultBindings(): BindingsMap {
  const out = {} as BindingsMap
  // An empty default accelerator means "no shortcut" — keep the list empty so
  // it renders cleanly in settings and never matches a keystroke.
  for (const a of ACTIONS)
    out[a.id] = a.defaultAccelerator ? [a.defaultAccelerator] : []
  return out
}

export type NormalizedAccelerator = {
  cmdOrCtrl: boolean
  alt: boolean
  shift: boolean
  key: string // canonical, e.g. "P", "2", ","
}

function canonicalKeyFromToken(token: string): string {
  if (token.length === 1) return token.toUpperCase()
  // Allow longer key names like "ArrowUp", "Enter", "Escape", "Space"
  return token
}

export function parseAccelerator(acc: string): NormalizedAccelerator | null {
  if (!acc) return null
  const parts = acc
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return null
  let cmdOrCtrl = false
  let alt = false
  let shift = false
  let key: string | null = null
  for (const raw of parts) {
    const p = raw
    const lower = p.toLowerCase()
    if (
      lower === "cmdorctrl" ||
      lower === "mod" ||
      lower === "cmd" ||
      lower === "ctrl" ||
      lower === "control" ||
      lower === "meta"
    ) {
      cmdOrCtrl = true
    } else if (lower === "alt" || lower === "option") {
      alt = true
    } else if (lower === "shift") {
      shift = true
    } else {
      key = canonicalKeyFromToken(p)
    }
  }
  if (!key) {
    // Modifier-only chord (hold bindings like "CmdOrCtrl+Alt"). Valid as long
    // as at least one modifier is present; key stays "" so it can never match
    // a keystroke in matchesAccelerator.
    if (!cmdOrCtrl && !alt && !shift) return null
    return { cmdOrCtrl, alt, shift, key: "" }
  }
  return { cmdOrCtrl, alt, shift, key }
}

/**
 * True when the event's held modifiers exactly match one of the modifier-only
 * accelerators (accelerators with a key part never match). Used for hold
 * chords like quick-split, where arming is driven by modifier state alone.
 */
export function matchesModifierChord(
  accelerators: readonly string[],
  e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }
): boolean {
  return accelerators.some((acc) => {
    const n = parseAccelerator(acc)
    if (!n || n.key) return false
    return (
      n.cmdOrCtrl === (e.metaKey || e.ctrlKey) &&
      n.alt === e.altKey &&
      n.shift === e.shiftKey
    )
  })
}

// Build a canonical "CmdOrCtrl+Shift+K" string from a KeyboardEvent.
// Returns null for modifier-only keypresses.
export function formatAccelerator(e: KeyboardEvent): string | null {
  const k = e.key
  if (k === "Meta" || k === "Control" || k === "Shift" || k === "Alt") {
    return null
  }
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push("CmdOrCtrl")
  if (e.altKey) parts.push("Alt")
  if (e.shiftKey) parts.push("Shift")
  let key = k
  if (key === " ") key = "Space"
  if (key.length === 1) key = key.toUpperCase()
  parts.push(key)
  return parts.join("+")
}

export function matchesAccelerator(acc: string, e: KeyboardEvent): boolean {
  const n = parseAccelerator(acc)
  if (!n) return false
  const modOk = n.cmdOrCtrl === (e.metaKey || e.ctrlKey)
  if (!modOk) return false
  if (n.alt !== e.altKey) return false
  if (n.shift !== e.shiftKey) return false
  let eventKey = e.key
  if (eventKey === " ") eventKey = "Space"
  if (eventKey.length === 1) eventKey = eventKey.toUpperCase()
  return eventKey === n.key
}

export function matchesAnyAccelerator(
  accelerators: readonly string[],
  e: KeyboardEvent
): boolean {
  return accelerators.some((acc) => matchesAccelerator(acc, e))
}

const ARROW_SYMBOLS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
}

// Pretty-print an accelerator for UI (macOS symbols on darwin, words elsewhere).
export function prettyAccelerator(acc: string): string[] {
  const n = parseAccelerator(acc)
  if (!n) return [acc]
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
  const out: string[] = []
  if (n.cmdOrCtrl) out.push(isMac ? "⌘" : "Ctrl")
  if (n.alt) out.push(isMac ? "⌥" : "Alt")
  if (n.shift) out.push(isMac ? "⇧" : "Shift")
  // Modifier-only chords have no key part.
  if (n.key) out.push(ARROW_SYMBOLS[n.key] ?? n.key)
  return out
}

// Single-string accelerator label for inline hints (e.g. tooltips): "⌘1" on
// macOS, "Ctrl+1" elsewhere. Returns "" for an unbound/invalid accelerator.
export function acceleratorLabel(acc: string): string {
  const parts = prettyAccelerator(acc)
  if (parts.length === 0 || (parts.length === 1 && !parts[0])) return ""
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
  return parts.join(isMac ? "" : "+")
}
