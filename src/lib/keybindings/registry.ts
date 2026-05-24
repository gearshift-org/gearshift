export type ActionId =
  | "sidebar.toggle"
  | "palette.open"
  | "terminal.split"
  | "terminal.new"
  | "terminal.close"
  | "settings.open"

export type Scope = "renderer" | "electron-menu"

export type ActionDef = {
  id: ActionId
  label: string
  description?: string
  defaultAccelerator: string
  scope: Scope
}

export const ACTIONS: readonly ActionDef[] = [
  {
    id: "sidebar.toggle",
    label: "Toggle Sidebar",
    defaultAccelerator: "CmdOrCtrl+2",
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
    label: "Split Terminal",
    defaultAccelerator: "CmdOrCtrl+D",
    scope: "renderer",
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
    id: "settings.open",
    label: "Open Settings",
    defaultAccelerator: "CmdOrCtrl+,",
    scope: "renderer",
  },
] as const

export type BindingsMap = Record<ActionId, string>

export function defaultBindings(): BindingsMap {
  const out = {} as BindingsMap
  for (const a of ACTIONS) out[a.id] = a.defaultAccelerator
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
  const parts = acc.split("+").map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return null
  let cmdOrCtrl = false
  let alt = false
  let shift = false
  let key: string | null = null
  for (const raw of parts) {
    const p = raw
    const lower = p.toLowerCase()
    if (lower === "cmdorctrl" || lower === "mod" || lower === "cmd" || lower === "ctrl" || lower === "control" || lower === "meta") {
      cmdOrCtrl = true
    } else if (lower === "alt" || lower === "option") {
      alt = true
    } else if (lower === "shift") {
      shift = true
    } else {
      key = canonicalKeyFromToken(p)
    }
  }
  if (!key) return null
  return { cmdOrCtrl, alt, shift, key }
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

// Pretty-print an accelerator for UI (macOS symbols on darwin, words elsewhere).
export function prettyAccelerator(acc: string): string[] {
  const n = parseAccelerator(acc)
  if (!n) return [acc]
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
  const out: string[] = []
  if (n.cmdOrCtrl) out.push(isMac ? "⌘" : "Ctrl")
  if (n.alt) out.push(isMac ? "⌥" : "Alt")
  if (n.shift) out.push(isMac ? "⇧" : "Shift")
  out.push(n.key)
  return out
}
