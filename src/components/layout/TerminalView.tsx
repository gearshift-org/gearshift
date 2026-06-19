import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react"
import { ChevronDown, ChevronUp, X } from "lucide-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { SearchAddon } from "@xterm/addon-search"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { WebglAddon } from "@xterm/addon-webgl"
import { VSCodeIcon } from "@/components/icons/VSCodeIcon"
import { THEMES, type ThemeId, useTheme } from "@/components/theme-provider"
import { getPathDragData, hasPathDragData } from "@/lib/pathDrag"
import { useTerminalAppearance } from "@/lib/terminalAppearance"
import { cn } from "@/lib/utils"
import { agentActivityTitleSignal, formatAutoTitle } from "./terminalName"
import { fetchGitQueryData, gitQueryKey } from "@/lib/gitStatusQuery"
import type { TerminalAgentName, TerminalAgentStatus } from "./types"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { TerminalRecapBox } from "@/components/terminal/TerminalRecapBox"
import { Button } from "@/components/ui/button"
import type { ChatHistoryMessage } from "../../../electron/preload"

type Props = {
  sessionId: string
  // Project working directory for this pane. Used to read the shared git-status
  // query (the same data behind the sidebar change counter) so the post-task
  // "Commit changes" affordance only appears when there are changes.
  cwd?: string
  isActive?: boolean
  // Number of panes in this terminal tab. Changes when a split opens/closes;
  // used to force an authoritative refit since the pane resizes without
  // remounting. See the paneCount effect below.
  paneCount?: number
  focusRequest?: number
  onTitleChange?: (title: string) => void
  onFocusChange?: (focused: boolean) => void
  initialAgentStatus?: TerminalAgentStatus
  onAgentStatusChange?: (status: TerminalAgentStatus) => void
  onClose?: () => void
}

const DARK_THEME = {
  background: "#151515",
  foreground: "#d4d4d4",
  cursor: "#d4d4d4",
  selectionBackground: "#264f78",
  selectionForeground: "#ffffff",
  selectionInactiveBackground: "#3a3d41",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  // Bright variants — brightBlack drives zsh-autosuggestions "ghost" text.
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#fafafa",
}
const LIGHT_THEME = {
  background: "#f8f8f8",
  foreground: "#2f3033",
  cursor: "#2f3033",
  selectionBackground: "#d8d7de",
  selectionForeground: "#2f3033",
  selectionInactiveBackground: "#e5e4e9",
  black: "#171717",
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#ca8a04",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0891b2",
  white: "#e5e5e5",
  brightBlack: "#9ca3af",
  brightRed: "#ef4444",
  brightGreen: "#22c55e",
  brightYellow: "#eab308",
  brightBlue: "#3b82f6",
  brightMagenta: "#a855f7",
  brightCyan: "#06b6d4",
  brightWhite: "#171717",
}

// Per-variant "chrome" overrides (background/foreground/cursor/selection) so the
// terminal matches the selected theme tint. ANSI colors inherit from the base
// dark/light palette. Keyed by ThemeId; the defaults reuse DARK_THEME/LIGHT_THEME.
const TERMINAL_VARIANTS: Partial<Record<ThemeId, Partial<typeof DARK_THEME>>> =
  {
    "light-cool": {
      background: "#f5f7fa",
      foreground: "#3a4252",
      cursor: "#3a4252",
      selectionBackground: "#cfd9e8",
      selectionForeground: "#3a4252",
      selectionInactiveBackground: "#e0e6f0",
    },
    "light-warm": {
      background: "#faf8f4",
      foreground: "#4a4338",
      cursor: "#4a4338",
      selectionBackground: "#e8dec9",
      selectionForeground: "#4a4338",
      selectionInactiveBackground: "#efe7d8",
    },
    "dark-cool": {
      background: "#15181d",
      foreground: "#d3d8e0",
      cursor: "#d3d8e0",
      selectionBackground: "#2d4a6b",
      selectionInactiveBackground: "#33414f",
    },
    "dark-warm": {
      background: "#1a1815",
      foreground: "#d9d2c7",
      cursor: "#d9d2c7",
      selectionBackground: "#5c4a2e",
      selectionInactiveBackground: "#413a30",
    },
    "light-rose": {
      background: "#faf6f7",
      foreground: "#4a3a40",
      cursor: "#4a3a40",
      selectionBackground: "#ecd6dd",
      selectionForeground: "#4a3a40",
      selectionInactiveBackground: "#f0e0e5",
    },
    "light-forest": {
      background: "#f5f8f4",
      foreground: "#384439",
      cursor: "#384439",
      selectionBackground: "#d2e6d4",
      selectionForeground: "#384439",
      selectionInactiveBackground: "#e0ece1",
    },
    "light-violet": {
      background: "#f8f6fb",
      foreground: "#423a52",
      cursor: "#423a52",
      selectionBackground: "#ddd2ee",
      selectionForeground: "#423a52",
      selectionInactiveBackground: "#e7e0f2",
    },
    "dark-rose": {
      background: "#1d181a",
      foreground: "#e0d2d6",
      cursor: "#e0d2d6",
      selectionBackground: "#6b2d42",
      selectionInactiveBackground: "#4a3338",
    },
    "dark-forest": {
      background: "#161916",
      foreground: "#d2dbd0",
      cursor: "#d2dbd0",
      selectionBackground: "#2d6b3a",
      selectionInactiveBackground: "#334a37",
    },
    "dark-violet": {
      background: "#19161f",
      foreground: "#d8d2e0",
      cursor: "#d8d2e0",
      selectionBackground: "#4a2d6b",
      selectionInactiveBackground: "#3a3349",
    },
    "light-atom-one": {
      background: "#fafafa",
      foreground: "#383a42",
      cursor: "#383a42",
      selectionBackground: "#e5e5e6",
      selectionForeground: "#383a42",
      selectionInactiveBackground: "#ececed",
    },
    "light-nebula-pandas": {
      background: "#f8f6ff",
      foreground: "#27273a",
      cursor: "#6bc75f",
      selectionBackground: "#dff7d9",
      selectionForeground: "#27273a",
      selectionInactiveBackground: "#ede9f8",
    },
    "light-night-owl": {
      background: "#fbfbfb",
      foreground: "#403f53",
      cursor: "#90a7b2",
      selectionBackground: "#e0e0e0",
      selectionForeground: "#403f53",
      selectionInactiveBackground: "#f0f0f0",
    },
    "dark-atom-one": {
      background: "#282c34",
      foreground: "#abb2bf",
      cursor: "#abb2bf",
      selectionBackground: "#3e4451",
      selectionInactiveBackground: "#353b45",
    },
    "dark-nebula-pandas": {
      background: "#27273a",
      foreground: "#fcf6ff",
      cursor: "#97ee91",
      selectionBackground: "#42557b",
      selectionInactiveBackground: "#353551",
    },
    "dark-night-owl": {
      background: "#011627",
      foreground: "#d6deeb",
      cursor: "#80a4c2",
      selectionBackground: "#1d3b53",
      selectionInactiveBackground: "#0b2942",
    },
    "light-palenight": {
      background: "#f7f7fb",
      foreground: "#2f3354",
      cursor: "#7e57c2",
      selectionBackground: "#ddd2ee",
      selectionForeground: "#2f3354",
      selectionInactiveBackground: "#ecedf5",
    },
    "dark-palenight": {
      background: "#292d3e",
      foreground: "#bfc7d5",
      cursor: "#7e57c2",
      selectionBackground: "#444a73",
      selectionInactiveBackground: "#3a3f58",
    },
    "light-material-color": {
      background: "#fafafa",
      foreground: "#2e3235",
      cursor: "#3b78e7",
      selectionBackground: "#d4ead9",
      selectionForeground: "#2e3235",
      selectionInactiveBackground: "#ececec",
    },
    "dark-material-color": {
      background: "#212121",
      foreground: "#eeffff",
      cursor: "#82aaff",
      selectionBackground: "#404040",
      selectionInactiveBackground: "#333333",
    },
    "light-monokai-pro": {
      background: "#faf4f2",
      foreground: "#29242a",
      cursor: "#1c8ca8",
      selectionBackground: "#dcd4d2",
      selectionForeground: "#29242a",
      selectionInactiveBackground: "#ede7e5",
    },
    "dark-monokai-pro": {
      background: "#2d2a2e",
      foreground: "#fcfcfa",
      cursor: "#78dce8",
      selectionBackground: "#5b595c",
      selectionInactiveBackground: "#403e41",
    },
    "light-claude": {
      background: "#FDFDFC",
      foreground: "#3d3d3a",
      cursor: "#d97757",
      selectionBackground: "#ece2d8",
      selectionForeground: "#3d3d3a",
      selectionInactiveBackground: "#f0e8dd",
    },
    "dark-claude": {
      background: "#262624",
      foreground: "#c2c0b6",
      cursor: "#d97757",
      selectionBackground: "#5c4030",
      selectionInactiveBackground: "#3f352e",
    },
  }

function getTerminalTheme(themeId: ThemeId): typeof DARK_THEME {
  const base = THEMES[themeId].appearance === "dark" ? DARK_THEME : LIGHT_THEME
  const overrides = TERMINAL_VARIANTS[themeId]
  return overrides ? { ...base, ...overrides } : base
}

const SEARCH_DECORATIONS = {
  matchBackground: "#a8a8a833",
  matchBorder: "#a8a8a866",
  matchOverviewRuler: "#a8a8a8",
  activeMatchBackground: "#facc15aa",
  activeMatchBorder: "#facc15",
  activeMatchColorOverviewRuler: "#facc15",
}

// DEC private mode codes for color-scheme update notifications.
// Spec: https://github.com/contour-terminal/contour/blob/master/docs/vt-extensions/color-palette-update-notifications.md
const DEC_COLOR_SCHEME_UPDATE = 2031 // subscribe via CSI ? 2031 h / l
const DEC_COLOR_SCHEME_QUERY = 996 // explicit query: CSI ? 996 n
const DEC_COLOR_SCHEME_REPORT = 997 // response: CSI ? 997 ; 1|2 n (dark|light)

function csiParamsInclude(
  params: (number | number[])[],
  target: number
): boolean {
  for (let i = 0; i < params.length; i++) {
    const p = params[i]
    if ((typeof p === "number" ? p : p[0]) === target) return true
  }
  return false
}

const URL_CONTINUATION_RE = /^[^\s"'<>`]+/

function trimUrlEnd(value: string): string {
  return value.replace(/[),.!?;:]+$/g, "")
}

function trimTerminalSelection(value: string): string {
  if (!value) return value
  const lines = value.split("\n").map((line) => line.replace(/[ \t]+$/g, ""))
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop()
  }
  return lines.join("\n")
}

function expandWrappedTerminalUrl(term: Terminal, uri: string): string {
  const buffer = term.buffer.active
  const maxLine = buffer.length - 1

  for (let y = 0; y <= maxLine; y += 1) {
    const line = buffer.getLine(y)
    if (!line) continue

    const text = line.translateToString(true)
    const start = text.indexOf(uri)
    if (start === -1) continue

    let expanded = uri
    let cursorY = y
    let cursorEndX = start + uri.length

    while (cursorY < maxLine && cursorEndX >= term.cols - 1) {
      const nextLine = buffer.getLine(cursorY + 1)
      if (!nextLine) break

      const nextText = nextLine.translateToString(true)
      const continuation = nextText.match(URL_CONTINUATION_RE)?.[0]
      if (!continuation) break

      expanded += continuation
      cursorY += 1
      cursorEndX = continuation.length

      if (!nextLine.isWrapped && continuation.length < term.cols) break
    }

    return trimUrlEnd(expanded)
  }

  return uri
}

function refreshTerminalViewport(term: Terminal) {
  try {
    if (term.rows > 0 && ensureTerminalRenderer(term)) {
      term.refresh(0, term.rows - 1)
    }
  } catch {
    // Renderer refresh can fail while xterm is disposing.
  }
}

// Once WebGL's GPU context is lost we stop using it for every subsequent
// terminal (VS Code's pattern) — retrying tends to thrash and lose context
// again. The DOM renderer is the safe fallback.
let suggestedRendererType: "webgl" | "dom" | undefined

type TerminalWithInternalRenderer = Terminal & {
  _core?: {
    _store?: { _isDisposed?: boolean }
    _renderService?: {
      hasRenderer?: () => boolean
      setRenderer?: (renderer: unknown) => void
      handleResize?: (cols: number, rows: number) => void
    }
    _createRenderer?: () => unknown
  }
}

function ensureTerminalRenderer(term: Terminal): boolean {
  try {
    const core = (term as TerminalWithInternalRenderer)._core
    if (core?._store?._isDisposed) return false
    const renderService = core?._renderService
    if (!renderService) return false
    if (renderService.hasRenderer?.()) return true

    const renderer = core?._createRenderer?.()
    if (!renderer || !renderService.setRenderer) return false
    renderService.setRenderer(renderer)
    renderService.handleResize?.(term.cols, term.rows)
    return true
  } catch {
    return false
  }
}

function safeTerminalFocus(term: Terminal) {
  if (!ensureTerminalRenderer(term)) return
  try {
    term.focus()
  } catch {
    // xterm may be between renderer swaps while WebGL falls back to DOM.
  }
}

function recoverTerminalRenderer(term: Terminal) {
  ensureTerminalRenderer(term)
  try {
    term.clearTextureAtlas()
  } catch {
    // No active WebGL renderer, or xterm is already disposing.
  }
  refreshTerminalViewport(term)
}

function openTerminalUrl(term: Terminal, event: MouseEvent, uri: string): void {
  event.preventDefault()
  void window.shellApi.openExternal(expandWrappedTerminalUrl(term, uri))
}
const AGENT_STATUS_POLL_MS = 2000
const AGENT_WORKING_QUIET_MS = 10000
// While a hook event has been seen within this window, the process-detection
// poller is treated as advisory only — it can promote running/agentName but
// must not downgrade the working flag. Hooks are the authoritative signal.
const HOOK_AUTHORITATIVE_WINDOW_MS = 30000
const RESIZE_ACTIVITY_SUPPRESS_MS = 1000
const FOCUS_ACTIVITY_SUPPRESS_MS = 1000
const USER_INPUT_ECHO_SUPPRESS_MS = 750
const TERMINAL_RESIZE_SETTLE_MS = 120
const TERMINAL_PTY_RESIZE_THROTTLE_MS = 120
// Scrollback line count past which a live (per-frame) column resize is deferred
// to the settle fit, since reflowing a large buffer every frame is what makes
// dragging janky. Matches VS Code's StartDebouncingThreshold.
const COLUMN_REFLOW_DEBOUNCE_LINES = 200
// How long the user must stay idle on a terminal after its agent finishes (or
// needs attention) before the floating recap box appears.
const RECAP_IDLE_DELAY_MS = 30000
const TERMINAL_RECAP_BOX_ENABLED = true
// Floating commit affordance temporarily disabled; keep the code path intact.
const FLOATING_COMMIT_AFFORDANCE_ENABLED = false
// Agents with authoritative lifecycle hooks (start/stop via the agent socket).
// Their busy state is driven entirely by those hook events, so the title- and
// output-activity heuristics must NOT mark them working — otherwise plain UI
// interactions that repaint the TUI (opening the model picker, selecting a
// model) get misread as work and stick a false busy dot on the pane.
const HOOK_BACKED_AGENTS = new Set(["claude", "codex", "opencode", "pi"])
// Hookless agents fall back to "terminal produced output while running" as a
// busy signal. Keep this to agents that have no hooks (Gemini, plain shells).
const OUTPUT_ACTIVITY_AGENTS = new Set(["gemini"])
// Delay between writing a prompt and the Enter that submits it, so the agent's
// input box registers the full text first. Mirrors AppShell's writeAgentPrompt.
const AGENT_PROMPT_SUBMIT_DELAY_MS = 80
const COMMIT_STATUS_CHECK_DELAY_MS = 200
const MIN_TERMINAL_FIT_COLS = 20
const MIN_TERMINAL_FIT_ROWS = 2
const KITTY_IMAGE_MIME_BY_FORMAT: Record<string, string> = {
  "100": "image/png",
}

type KittyImagePayload = {
  id: string
  params: Record<string, string>
  data: string
}

function shellQuote(s: string) {
  if (/^[A-Za-z0-9_\-./]+$/.test(s)) return s
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function parseKittyImagePayload(raw: string): KittyImagePayload | null {
  const separator = raw.indexOf(";")
  if (separator === -1) return null
  const params: Record<string, string> = {}
  for (const part of raw.slice(0, separator).split(",")) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    params[part.slice(0, eq)] = part.slice(eq + 1)
  }
  const id = params.i || params.I || "default"
  return { id, params, data: raw.slice(separator + 1) }
}

function cleanBase64(value: string): string {
  return value.replace(/\s/g, "")
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(cleanBase64(value))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

function kittyImageDimensions(term: Terminal, params: Record<string, string>) {
  const cols = Math.max(1, Number.parseInt(params.c || "", 10) || 48)
  const rows = Math.max(1, Number.parseInt(params.r || "", 10) || 18)
  return {
    cols: Math.min(cols, Math.max(1, term.cols)),
    rows: Math.min(rows, Math.max(1, term.rows)),
  }
}

function renderKittyImage(
  term: Terminal,
  params: Record<string, string>,
  src: string,
  marker = term.registerMarker(0)
) {
  if (!marker) return
  const { cols, rows } = kittyImageDimensions(term, params)
  const decoration = term.registerDecoration({
    marker,
    width: cols,
    height: rows,
  })
  if (!decoration) return

  decoration.onRender((element) => {
    element.classList.add("terminal-kitty-image")
    element.textContent = ""

    const img = document.createElement("img")
    img.src = src
    img.alt = ""
    img.draggable = false
    img.style.display = "block"
    img.style.maxWidth = "100%"
    img.style.maxHeight = "100%"
    img.style.objectFit = "contain"
    element.appendChild(img)
  })
}

async function kittyImageSource(params: Record<string, string>, data: string) {
  if (params.t === "f" || params.t === "t") {
    const path = decodeBase64Utf8(data).replace(/\0+$/, "")
    const res = await window.fsApi.readImage(path)
    return res.ok ? (res.dataUrl ?? null) : null
  }

  const mime = KITTY_IMAGE_MIME_BY_FORMAT[params.f || ""]
  if (!mime) return null
  return `data:${mime};base64,${cleanBase64(data)}`
}

function parseInlineImageOptions(value: string): Record<string, string> | null {
  if (!value.startsWith("File=")) return null
  const options: Record<string, string> = {}
  for (const part of value.slice("File=".length).split(";")) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    options[part.slice(0, eq)] = part.slice(eq + 1)
  }
  return options
}

function renderItermImage(term: Terminal, raw: string): boolean {
  const separator = raw.indexOf(":")
  if (separator === -1) return false
  const options = parseInlineImageOptions(raw.slice(0, separator))
  if (!options || options.inline !== "1") return false

  const marker = term.registerMarker(0)
  renderKittyImage(
    term,
    { c: "48", r: "18" },
    `data:image/png;base64,${cleanBase64(raw.slice(separator + 1))}`,
    marker
  )
  return true
}

function pasteText(
  term: Terminal,
  sessionId: string,
  text: string,
  agentName?: TerminalAgentName
) {
  if (!text) return

  if (agentName === "pi") {
    // Pi treats pasted returns like submit. Convert pasted line breaks to the
    // same modified Enter sequence used by Shift+Enter so multiline prompts
    // stay in the composer instead of submitting each line.
    const normalized = text.replace(/\r\n?/g, "\n").replace(/\n+$/g, "")
    if (normalized) {
      window.term.write(
        sessionId,
        normalized.split("\n").join("\x1b[13;2u")
      )
    }
    return
  }

  term.paste(text)
}

async function pasteClipboard(
  term: Terminal,
  sessionId: string,
  agentName?: TerminalAgentName
) {
  try {
    if (await window.clipboardApi.hasImage()) {
      if (agentName) {
        // Agent CLIs (Claude Code, Codex, …) handle image paste themselves
        // when they receive Ctrl+V (0x16). Matches Ghostty/VS Code.
        window.term.write(sessionId, "\x16")
      } else {
        // Plain shell: write the image to a temp file and paste its path.
        const filePath = await window.clipboardApi.getImagePath()
        if (filePath) term.paste(shellQuote(filePath) + " ")
      }
      safeTerminalFocus(term)
      return
    }
  } catch {
    // fall through to text paste
  }
  pasteText(term, sessionId, await navigator.clipboard.readText(), agentName)
  safeTerminalFocus(term)
}

export function TerminalView({
  sessionId,
  cwd,
  isActive = true,
  paneCount = 1,
  focusRequest,
  onTitleChange,
  onFocusChange,
  initialAgentStatus,
  onAgentStatusChange,
  onClose,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const fitTerminalRef = useRef<(() => boolean) | null>(null)
  const didInitialLayoutRef = useRef(false)
  const webglRef = useRef<WebglAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { theme, resolvedTheme } = useTheme()
  const { appearance } = useTerminalAppearance()
  const isDark = resolvedTheme === "dark"
  // `system` follows the resolved appearance's default palette; otherwise the
  // explicit theme id selects its own terminal tint.
  const themeId: ThemeId = theme === "system" ? resolvedTheme : theme
  const themeObj = useMemo(() => getTerminalTheme(themeId), [themeId])
  const themeRef = useRef({ isDark })
  themeRef.current.isDark = isDark
  const colorSchemeSubscribedRef = useRef(false)
  const onTitleChangeRef = useRef(onTitleChange)
  const onFocusChangeRef = useRef(onFocusChange)
  const onAgentStatusChangeRef = useRef(onAgentStatusChange)
  const agentStatusRef = useRef<TerminalAgentStatus>(
    initialAgentStatus ?? {
      running: false,
      working: false,
    }
  )
  // Last agent-native session id reported by a lifecycle hook. Sticky: kept
  // across status churn so every emitted status carries it once known.
  const agentSessionIdRef = useRef<string | undefined>(
    initialAgentStatus?.agentSessionId
  )
  // Last resolved agent session title (AI title / first prompt). Sticky too.
  const agentSessionTitleRef = useRef<string | undefined>(
    initialAgentStatus?.agentSessionTitle
  )
  const agentWorkingTimerRef = useRef<number | undefined>(undefined)
  const lastAgentActivityAtRef = useRef(0)
  const lastUserInputAtRef = useRef(0)
  const lastAgentSubmitAtRef = useRef(0)
  const lastTitleSignalRef = useRef<string | undefined>(undefined)
  const hasSubmittedToAgentRef = useRef(!!initialAgentStatus?.working)
  const suppressAgentActivityUntilRef = useRef(0)
  const lastHookEventAtRef = useRef(0)
  const activeHookWorkRef = useRef(!!initialAgentStatus?.working)
  const recapTimerRef = useRef<number | undefined>(undefined)
  const commitCheckTimerRef = useRef<number | undefined>(undefined)
  const kittyImageChunksRef = useRef(new Map<string, KittyImagePayload>())
  const lastKittyImageChunkIdRef = useRef<string | null>(null)

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState({
    resultIndex: -1,
    resultCount: 0,
  })
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const showScrollToBottomRef = useRef(false)
  const [recap, setRecap] = useState<{
    message: ChatHistoryMessage | null
    kind: "completed" | "needs_attention"
  } | null>(null)
  // Floating "Commit changes" affordance shown after an agent turn finishes with
  // uncommitted changes. Same action as the sidebar's "Commit with AI".
  // "closing" keeps it mounted long enough to play the exit animation.
  const [commitUi, setCommitUi] = useState<"hidden" | "open" | "closing">(
    "hidden"
  )
  const commitDismissedRef = useRef(false)
  // Mirror commitUi into a ref so the terminal's one-time key/input handlers can
  // read the current value without being re-attached on every state change.
  const commitUiRef = useRef(commitUi)
  useEffect(() => {
    commitUiRef.current = commitUi
  }, [commitUi])
  const queryClient = useQueryClient()
  const { data: gitData } = useQuery({
    queryKey: gitQueryKey(cwd ?? null),
    queryFn: () => fetchGitQueryData(cwd!),
    enabled: !!cwd,
  })
  const cwdRef = useRef(cwd)
  useEffect(() => {
    cwdRef.current = cwd
  }, [cwd])

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    searchRef.current?.clearDecorations()
    const term = termRef.current
    if (term) safeTerminalFocus(term)
  }, [])

  useEffect(() => {
    onTitleChangeRef.current = onTitleChange
  }, [onTitleChange])

  useEffect(() => {
    onFocusChangeRef.current = onFocusChange
  }, [onFocusChange])

  useEffect(() => {
    onAgentStatusChangeRef.current = onAgentStatusChange
  }, [onAgentStatusChange])

  const emitAgentStatus = useCallback((next: TerminalAgentStatus) => {
    // Carry the last-known agent-native session id onto every status so it
    // survives status resets and reaches AppShell for persistence.
    const merged: TerminalAgentStatus = {
      ...next,
      agentSessionId: next.agentSessionId ?? agentSessionIdRef.current,
      agentSessionTitle: next.agentSessionTitle ?? agentSessionTitleRef.current,
    }
    const prev = agentStatusRef.current
    if (
      prev.running === merged.running &&
      prev.working === merged.working &&
      prev.agentName === merged.agentName &&
      prev.workStartedAt === merged.workStartedAt &&
      prev.completedAt === merged.completedAt &&
      prev.completed === merged.completed &&
      prev.needsAttention === merged.needsAttention &&
      prev.agentSessionId === merged.agentSessionId &&
      prev.agentSessionTitle === merged.agentSessionTitle
    ) {
      return
    }
    agentStatusRef.current = merged
    onAgentStatusChangeRef.current?.(merged)
  }, [])

  // Resolve the agent's session title from disk (AI title for Claude/OpenCode,
  // first prompt otherwise) and fold it into the live status so it becomes the
  // pane title. Best-effort: a null result leaves the existing title untouched.
  const refreshAgentSessionTitle = useCallback(async () => {
    const agent = agentStatusRef.current.agentName
    const agentSessionId = agentSessionIdRef.current
    if (!agent || !agentSessionId) return
    try {
      const title = await window.term.agentSessionTitle({ agent, agentSessionId })
      if (title && title !== agentSessionTitleRef.current) {
        agentSessionTitleRef.current = title
        emitAgentStatus({ ...agentStatusRef.current, agentSessionTitle: title })
      }
    } catch {
      // ignore — fall back to existing title
    }
  }, [emitAgentStatus])

  const dismissRecap = useCallback(() => {
    if (recapTimerRef.current) {
      window.clearTimeout(recapTimerRef.current)
      recapTimerRef.current = undefined
    }
    setRecap(null)
  }, [])

  // Arm the floating recap box: when an agent finishes (or needs attention), wait
  // for the idle window. If the user hasn't touched this terminal in the meantime,
  // surface the last prompt they sent. Any keystroke (see term.onData) cancels.
  const scheduleRecap = useCallback(
    (kind: "completed" | "needs_attention") => {
      if (!TERMINAL_RECAP_BOX_ENABLED) return
      if (recapTimerRef.current) window.clearTimeout(recapTimerRef.current)
      const triggeredAt = Date.now()
      recapTimerRef.current = window.setTimeout(() => {
        recapTimerRef.current = undefined
        if (lastUserInputAtRef.current > triggeredAt) return
        void window.term.history.list(sessionId).then((rows) => {
          if (lastUserInputAtRef.current > triggeredAt) return
          const latestMessage = rows.reduce<ChatHistoryMessage | null>(
            (latest, row) =>
              !latest || row.createdAt > latest.createdAt ? row : latest,
            null
          )
          setRecap({ message: latestMessage, kind })
        })
      }, RECAP_IDLE_DELAY_MS)
    },
    [sessionId],
  )

  // Animate out, then unmount once the exit animation finishes (onAnimationEnd).
  const dismissCommit = useCallback(() => {
    commitDismissedRef.current = true
    setCommitUi((s) => (s === "open" ? "closing" : s))
  }, [])

  // After an agent turn finishes, surface the commit affordance only when the
  // project actually has changes. Reads the same git-status query that backs the
  // sidebar change counter (shared React Query cache, keyed by cwd) and refetches
  // so the count reflects whatever the agent just wrote.
  const maybeShowCommit = useCallback(() => {
    if (!FLOATING_COMMIT_AFFORDANCE_ENABLED) return
    const dir = cwdRef.current
    if (!dir) return
    // Only offer to commit in terminals that actually have an agent. A plain
    // shell with no agent never triggers the commit affordance.
    if (!agentStatusRef.current.agentName) return
    if (commitCheckTimerRef.current) {
      window.clearTimeout(commitCheckTimerRef.current)
    }
    commitCheckTimerRef.current = window.setTimeout(() => {
      commitCheckTimerRef.current = undefined
      void queryClient
        .fetchQuery({
          queryKey: gitQueryKey(dir),
          queryFn: () => fetchGitQueryData(dir),
        })
        .then((data) => {
          if (cwdRef.current !== dir) return
          if (data.files.length > 0) {
            commitDismissedRef.current = false
            setCommitUi("open")
          }
        })
        .catch(() => {
          // Not a repo / git error — just don't offer the affordance.
        })
    }, COMMIT_STATUS_CHECK_DELAY_MS)
  }, [queryClient])

  // Keep the affordance honest while it's open: if the changes disappear (e.g.
  // the agent committed them), close it. Never auto-opens — the affordance is
  // only surfaced by maybeShowCommit() after an agent finishes a turn, so it
  // can't linger when no agent ran.
  useEffect(() => {
    if (!gitData) return
    if (gitData.files.length === 0) {
      setCommitUi((s) => (s === "open" ? "closing" : s))
    }
  }, [gitData])

  const commitChanges = useCallback(() => {
    // Start the exit animation right away so the pill slides out smoothly on
    // click. The message + Enter are still written on the submit delay in the
    // background, so the agent receives them just after.
    setCommitUi((s) => (s === "open" ? "closing" : s))
    window.term.write(sessionId, "commit changes")
    window.setTimeout(() => {
      window.term.write(sessionId, "\r")
    }, AGENT_PROMPT_SUBMIT_DELAY_MS)
    const term = termRef.current
    if (term) safeTerminalFocus(term)
  }, [sessionId])
  // Ref so the one-time terminal key handler can invoke the latest commitChanges.
  const commitChangesRef = useRef(commitChanges)
  useEffect(() => {
    commitChangesRef.current = commitChanges
  }, [commitChanges])

  const clearAgentWorking = useCallback(() => {
    if (agentWorkingTimerRef.current) {
      window.clearTimeout(agentWorkingTimerRef.current)
      agentWorkingTimerRef.current = undefined
    }
    activeHookWorkRef.current = false
    lastAgentActivityAtRef.current = 0
    hasSubmittedToAgentRef.current = false
    const current = agentStatusRef.current
    if (current.working || current.needsAttention) {
      emitAgentStatus({
        ...current,
        working: false,
        completed: false,
        needsAttention: false,
      })
    }
  }, [emitAgentStatus])

  const markAgentWorking = useCallback(() => {
    const now = Date.now()
    if (now < suppressAgentActivityUntilRef.current) return
    const latestInputWasSubmit =
      lastAgentSubmitAtRef.current >= lastUserInputAtRef.current
    if (
      !latestInputWasSubmit &&
      now - lastUserInputAtRef.current < USER_INPUT_ECHO_SUPPRESS_MS
    ) {
      return
    }
    const current = agentStatusRef.current
    if (!current.running || !hasSubmittedToAgentRef.current) return
    lastAgentActivityAtRef.current = now
    emitAgentStatus({
      ...current,
      working: true,
      workStartedAt: current.working ? (current.workStartedAt ?? now) : now,
      completedAt: undefined,
      completed: false,
      needsAttention: false,
    })
    if (agentWorkingTimerRef.current) {
      window.clearTimeout(agentWorkingTimerRef.current)
    }
    agentWorkingTimerRef.current = window.setTimeout(() => {
      // Hook-backed agents (Claude Code, Codex, OpenCode, pi extension) have
      // an authoritative stop event. Do not let the quiet fallback create a
      // false completion notification while the job is still running.
      if (activeHookWorkRef.current) return
      const latest = agentStatusRef.current
      if (latest.running) {
        // Quiet fallback only clears the "currently active" dot. It is not an
        // authoritative completion signal, so it must not show done UI.
        emitAgentStatus({ ...latest, working: false, completed: false })
      }
    }, AGENT_WORKING_QUIET_MS)
  }, [emitAgentStatus])

  useEffect(() => {
    const suppressFocusActivity = () => {
      suppressAgentActivityUntilRef.current =
        Date.now() + FOCUS_ACTIVITY_SUPPRESS_MS
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        suppressFocusActivity()
      }
    }

    window.addEventListener("focus", suppressFocusActivity)
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      window.removeEventListener("focus", suppressFocusActivity)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (!isActive) return
    suppressAgentActivityUntilRef.current =
      Date.now() + FOCUS_ACTIVITY_SUPPRESS_MS
  }, [isActive])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: appearance.fontSize,
      fontFamily: appearance.fontFamily,
      scrollback: 5000,
      // Keep a small scrollbar gutter so terminal scrollback is visible.
      scrollbar: { width: 8 },
      // Let xterm reflow normal scrollback when the pane changes width, so
      // plain terminal output (ssh, logs, shell commands) fits after resizing.
      theme: themeObj,
      allowProposedApi: true,
      linkHandler: {
        activate: (event, uri) => openTerminalUrl(term, event, uri),
        hover: () => {},
        leave: () => {},
      },
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    const webLinks = new WebLinksAddon((event, uri) => {
      openTerminalUrl(term, event, uri)
    })
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(webLinks)
    term.open(container)
    termRef.current = term
    fitRef.current = fit
    searchRef.current = search

    const scrollSub = term.onScroll(() => {
      const buf = term.buffer.active
      const next = buf.viewportY < buf.baseY
      if (showScrollToBottomRef.current !== next) {
        showScrollToBottomRef.current = next
        setShowScrollToBottom(next)
      }
    })

    const onTerminalFocusIn = () => onFocusChangeRef.current?.(true)
    const onTerminalFocusOut = () => {
      requestAnimationFrame(() => {
        if (!container.contains(document.activeElement)) {
          onFocusChangeRef.current?.(false)
        }
      })
    }
    container.addEventListener("focusin", onTerminalFocusIn)
    container.addEventListener("focusout", onTerminalFocusOut)

    const resultsSub = search.onDidChangeResults((e) => {
      setSearchResults({
        resultIndex: e.resultIndex,
        resultCount: e.resultCount,
      })
    })

    // Snapshot replay paints historical PTY output into a fresh xterm instance.
    // It must be side-effect-free: xterm answers old terminal queries (DA,
    // XTVERSION, OSC color requests, DECRQSS, …) by firing `onData`. Feeding
    // those answers into the current shell makes them appear as prompt text.
    let replayingSnapshot = false

    // Use the legacy ESC+Enter newline sequence by default because Claude Code,
    // Codex, and OpenCode already understand it. If a TUI probes/enables
    // modified keyboard modes (like pi), switch Enter to an explicit modified
    // Enter sequence instead.
    let modifiedEnterSequence = "\x1b\r"
    const kittyKeyboardQuerySub = term.parser.registerCsiHandler(
      { prefix: "?", final: "u" },
      () => {
        if (!replayingSnapshot) modifiedEnterSequence = "\x1b[13;2u"
        return true
      }
    )
    const kittyKeyboardPushSub = term.parser.registerCsiHandler(
      { prefix: ">", final: "u" },
      () => {
        if (!replayingSnapshot) modifiedEnterSequence = "\x1b[13;2u"
        return true
      }
    )
    const kittyKeyboardPopSub = term.parser.registerCsiHandler(
      { prefix: "<", final: "u" },
      () => {
        if (!replayingSnapshot) modifiedEnterSequence = "\x1b\r"
        return true
      }
    )
    const modifyOtherKeysSub = term.parser.registerCsiHandler(
      { prefix: ">", final: "m" },
      (params) => {
        const first = Array.isArray(params[0]) ? params[0][0] : params[0]
        const second = Array.isArray(params[1]) ? params[1][0] : params[1]
        if (first !== 4) return false
        if (!replayingSnapshot) {
          modifiedEnterSequence = second === 0 ? "\x1b\r" : "\x1b[27;2;13~"
        }
        return true
      }
    )

    // DEC private mode 2031 — color-scheme update notifications. Subscribed
    // TUIs (Claude Code, Codex, Bubble Tea, …) send `CSI ? 2031 h` and expect
    // a push of `CSI ? 997 ; 1|2 n` (dark|light) on every theme flip so they
    // repaint live without a restart. `CSI ? 996 n` is an explicit query.
    const colorSchemeSetSub = term.parser.registerCsiHandler(
      { prefix: "?", final: "h" },
      (params) => {
        if (csiParamsInclude(params, DEC_COLOR_SCHEME_UPDATE)) {
          if (replayingSnapshot) return true
          colorSchemeSubscribedRef.current = true
        }
        return false
      }
    )
    const colorSchemeResetSub = term.parser.registerCsiHandler(
      { prefix: "?", final: "l" },
      (params) => {
        if (csiParamsInclude(params, DEC_COLOR_SCHEME_UPDATE)) {
          if (replayingSnapshot) return true
          colorSchemeSubscribedRef.current = false
        }
        return false
      }
    )
    const colorSchemeQuerySub = term.parser.registerCsiHandler(
      { prefix: "?", final: "n" },
      (params) => {
        if (!csiParamsInclude(params, DEC_COLOR_SCHEME_QUERY)) return false
        if (replayingSnapshot) return true
        const reply = themeRef.current.isDark ? 1 : 2
        window.term.write(
          sessionId,
          `\x1b[?${DEC_COLOR_SCHEME_REPORT};${reply}n`
        )
        return true
      }
    )
    const kittyImageSub = term.parser.registerApcHandler(
      { final: "G" },
      (data) => {
        const payload = parseKittyImagePayload(data)
        if (!payload) return false
        const chunks = kittyImageChunksRef.current
        const explicitId = payload.params.i || payload.params.I
        const id = explicitId || lastKittyImageChunkIdRef.current || payload.id
        const previous = chunks.get(id)
        const combined = previous
          ? {
              id,
              params: { ...previous.params, ...payload.params },
              data: previous.data + payload.data,
            }
          : { ...payload, id }

        if (combined.params.m === "1") {
          lastKittyImageChunkIdRef.current = id
          chunks.set(id, combined)
          return true
        }

        chunks.delete(id)
        if (lastKittyImageChunkIdRef.current === id) {
          lastKittyImageChunkIdRef.current = null
        }
        // Capture the line synchronously. Resolving image data can take a tick,
        // and registering the marker later anchors the image near later output.
        const marker = term.registerMarker(0)
        void kittyImageSource(combined.params, combined.data).then((src) => {
          if (src) renderKittyImage(term, combined.params, src, marker)
        })
        return true
      }
    )
    const itermImageSub = term.parser.registerOscHandler(1337, (data) =>
      renderItermImage(term, data)
    )

    // Clipboard + macOS-style readline navigation. xterm otherwise either
    // swallows these or sends raw ^C/^V/etc. to the PTY.
    const LINE_START = "\x01" // Ctrl+A
    const LINE_END = "\x05" // Ctrl+E
    const DELETE_TO_LINE_START = "\x15" // Ctrl+U
    const DELETE_WORD_BACK = "\x17" // Ctrl+W
    const WORD_BACK = "\x1bb" // ESC b
    const WORD_FORWARD = "\x1bf" // ESC f

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true
      const key = e.key.toLowerCase()
      const meta = e.metaKey
      const alt = e.altKey
      const ctrl = e.ctrlKey
      const shift = e.shiftKey

      // Cmd+F — open search overlay. Let Ctrl+F pass through to terminal
      // TUIs like OpenCode, where it can be an in-app shortcut.
      if (meta && !ctrl && !alt && !shift && key === "f") {
        e.preventDefault()
        openSearch()
        return false
      }

      // Cmd-based clipboard / selection shortcuts. Ctrl shortcuts should remain
      // available to terminal TUIs (for example OpenCode uses Ctrl+A/Ctrl+F).
      if (meta && !ctrl && !alt) {
        // Cmd+Shift+C is the global copy-terminal-path shortcut — let it bubble.
        if (key === "c" && !shift && term.hasSelection()) {
          e.preventDefault()
          const sel = trimTerminalSelection(term.getSelection())
          if (sel) void navigator.clipboard.writeText(sel)
          return false
        }
        if (key === "v") {
          e.preventDefault()
          void pasteClipboard(term, sessionId, agentStatusRef.current.agentName)
          return false
        }
        if (key === "a") {
          e.preventDefault()
          term.selectAll()
          return false
        }
        if (key === "k") {
          e.preventDefault()
          term.clear()
          return false
        }
      }

      // Keep Ctrl+C/Ctrl+V conveniences, but only for copy/paste. Other Ctrl
      // combinations pass through to the PTY.
      if (ctrl && !meta && !alt) {
        // Ctrl+Shift+C bubbles to the global copy-terminal-path shortcut.
        if (key === "c" && !shift && term.hasSelection()) {
          e.preventDefault()
          const sel = trimTerminalSelection(term.getSelection())
          if (sel) void navigator.clipboard.writeText(sel)
          return false
        }
        if (key === "v") {
          e.preventDefault()
          void pasteClipboard(term, sessionId, agentStatusRef.current.agentName)
          return false
        }
      }

      // ⌘← / ⌘→ — beginning / end of line
      if (
        meta &&
        !alt &&
        !ctrl &&
        !shift &&
        (key === "arrowleft" || key === "arrowright")
      ) {
        e.preventDefault()
        window.term.write(
          sessionId,
          key === "arrowleft" ? LINE_START : LINE_END
        )
        return false
      }

      // ⌥← / ⌥→ — word back / forward
      if (
        alt &&
        !meta &&
        !ctrl &&
        !shift &&
        (key === "arrowleft" || key === "arrowright")
      ) {
        e.preventDefault()
        window.term.write(
          sessionId,
          key === "arrowleft" ? WORD_BACK : WORD_FORWARD
        )
        return false
      }

      // ⌘⌫ — delete to start of line
      if (meta && !alt && !ctrl && !shift && key === "backspace") {
        e.preventDefault()
        window.term.write(sessionId, DELETE_TO_LINE_START)
        return false
      }

      // ⌥⌫ — delete word back
      if (alt && !meta && !ctrl && !shift && key === "backspace") {
        e.preventDefault()
        window.term.write(sessionId, DELETE_WORD_BACK)
        return false
      }

      // ⌘⏎ — submit the floating "commit changes" affordance while it's showing.
      if (
        meta &&
        !ctrl &&
        !alt &&
        !shift &&
        key === "enter" &&
        commitUiRef.current === "open"
      ) {
        e.preventDefault()
        commitChangesRef.current()
        return false
      }

      // ⇧⏎ / ⌘⇧⏎ — insert newline in TUI prompts (Claude Code, Codex,
      // OpenCode, pi). Terminals send CR (\r) on Enter, so send the active
      // modified-Enter sequence instead of a normal Enter.
      if (key === "enter" && shift && !ctrl && !alt) {
        e.preventDefault()
        const enterSequence =
          agentStatusRef.current.agentName === "pi"
            ? "\x1b[13;2u"
            : modifiedEnterSequence
        window.term.write(sessionId, enterSequence)
        return false
      }

      return true
    })

    let unmounted = false

    // Initial size + send to PTY. Use proposeDimensions() instead of fit() so
    // we avoid FitAddon's render clear, which can visibly blink during live
    // resize. Also ignore transient tiny widths from split-pane layout because
    // resizing xterm to 2 columns reflows the buffer into a vertical line.
    let pendingPtyResizeTimer: number | undefined
    let lastPtyResizeAt = 0
    let lastPtyResizeCols = 0
    let lastPtyResizeRows = 0
    const sendPtyResize = (cols: number, rows: number) => {
      if (lastPtyResizeCols === cols && lastPtyResizeRows === rows) return
      lastPtyResizeAt = Date.now()
      lastPtyResizeCols = cols
      lastPtyResizeRows = rows
      window.term.resize(sessionId, cols, rows)
    }
    const fitTerminal = (syncPty = true) => {
      try {
        const dims = fit.proposeDimensions()
        if (
          !dims ||
          !Number.isFinite(dims.cols) ||
          !Number.isFinite(dims.rows) ||
          dims.cols < MIN_TERMINAL_FIT_COLS ||
          dims.rows < MIN_TERMINAL_FIT_ROWS
        ) {
          return false
        }
        if (term.cols !== dims.cols || term.rows !== dims.rows) {
          if (!ensureTerminalRenderer(term)) return false
          // A column change reflows the entire scrollback buffer and is far more
          // expensive than a row change. During a live drag (syncPty=false) with
          // a large buffer, apply only the cheap row change now and defer the
          // column reflow to the settle fit, so dragging the sidebar/split stays
          // smooth instead of reflowing thousands of lines every frame. Mirrors
          // VS Code's TerminalResizeDebouncer. Small buffers reflow immediately.
          // A running full-screen TUI (Claude Code, Codex, …) uses the alternate
          // screen buffer, where the normal-buffer length stays small but every
          // resize forces the agent to repaint its whole screen — just as costly
          // to do per frame as a large-buffer reflow. Treat both as "deferrable".
          const deferColumn =
            term.buffer.active.type === "alternate" ||
            term.buffer.normal.length >= COLUMN_REFLOW_DEBOUNCE_LINES
          if (!syncPty && deferColumn && term.cols !== dims.cols) {
            if (term.rows !== dims.rows) term.resize(term.cols, dims.rows)
          } else {
            term.resize(dims.cols, dims.rows)
          }
        }
        const ptyCols = term.cols
        const ptyRows = term.rows
        if (syncPty) {
          sendPtyResize(ptyCols, ptyRows)
        } else if (
          Date.now() - lastPtyResizeAt >=
          TERMINAL_PTY_RESIZE_THROTTLE_MS
        ) {
          sendPtyResize(ptyCols, ptyRows)
        } else {
          if (pendingPtyResizeTimer) window.clearTimeout(pendingPtyResizeTimer)
          pendingPtyResizeTimer = window.setTimeout(() => {
            pendingPtyResizeTimer = undefined
            sendPtyResize(term.cols, term.rows)
          }, TERMINAL_PTY_RESIZE_THROTTLE_MS)
        }
        return true
      } catch {
        return false
      }
    }
    fitTerminalRef.current = fitTerminal

    const startupFitTimers: number[] = []
    const queueStartupFit = (delay: number) => {
      const id = window.setTimeout(() => {
        requestAnimationFrame(() => fitTerminal())
      }, delay)
      startupFitTimers.push(id)
    }
    fitTerminal()
    queueStartupFit(0)
    queueStartupFit(50)
    queueStartupFit(150)
    queueStartupFit(350)
    void document.fonts?.ready.then(() => {
      if (!unmounted) fitTerminal()
    })
    if (isActive) safeTerminalFocus(term)

    // Pull whatever scrollback the daemon captured before this view mounted
    // (empty for freshly spawned sessions), THEN subscribe to live data.
    // Subscribing first would race: live chunks would render before the
    // snapshot resolves, and the snapshot would then be appended on top,
    // producing duplicated/out-of-order output. The daemon-client side of
    // snapshot() drops its pendingData buffer so the post-snapshot subscribe
    // only receives bytes that arrived after the snapshot was taken.
    let offData: (() => void) | null = null
    let pendingLiveData = ""
    let liveDataRaf: number | undefined
    let liveDataFallbackTimer: number | undefined
    const flushLiveData = () => {
      if (liveDataRaf !== undefined) {
        cancelAnimationFrame(liveDataRaf)
        liveDataRaf = undefined
      }
      if (liveDataFallbackTimer !== undefined) {
        window.clearTimeout(liveDataFallbackTimer)
        liveDataFallbackTimer = undefined
      }
      if (!pendingLiveData) return
      const chunk = pendingLiveData
      pendingLiveData = ""
      term.write(chunk)
      const current = agentStatusRef.current
      if (
        current.running &&
        current.agentName &&
        OUTPUT_ACTIVITY_AGENTS.has(current.agentName)
      ) {
        markAgentWorking()
      }
    }
    const onDataChunk = (chunk: string) => {
      pendingLiveData += chunk
      if (liveDataRaf === undefined) {
        liveDataRaf = requestAnimationFrame(flushLiveData)
        // rAF stops while the window is hidden/occluded (macOS), which would
        // let pendingLiveData grow without bound under a streaming agent and
        // then land as one giant write. The timeout keeps draining regardless.
        liveDataFallbackTimer = window.setTimeout(flushLiveData, 250)
      }
    }
    void window.term.snapshot(sessionId).then((snap) => {
      if (unmounted) return
      const attachLiveData = () => {
        if (!unmounted && !offData) {
          offData = window.term.onData(sessionId, onDataChunk)
        }
      }
      if (!snap) {
        attachLiveData()
        return
      }
      replayingSnapshot = true
      term.write(snap, () => {
        replayingSnapshot = false
        attachLiveData()
      })
    })
    const offExit = window.term.onExit(sessionId, () => {
      term.write("\r\n\x1b[31m[process exited]\x1b[0m\r\n")
    })

    const inputSub = term.onData((d) => {
      if (replayingSnapshot) return
      // The moment the user types into the terminal, retire the floating commit
      // affordance — they're driving the session themselves. (commitChanges
      // writes via window.term.write, which bypasses onData, so triggering the
      // commit doesn't dismiss itself here.)
      if (commitUiRef.current === "open") {
        commitDismissedRef.current = true
        setCommitUi("closing")
      }
      const current = agentStatusRef.current
      if (current.running) {
        const now = Date.now()
        lastUserInputAtRef.current = now
        // Ctrl+C (\x03) and a bare Esc (\x1b) both interrupt a working agent.
        // Esc is Claude Code's interrupt key ("Interrupted · What should Claude
        // do instead?") and does not emit a Stop hook, so without this the
        // spinner stays stuck: the hook-backed quiet fallback is disabled while
        // activeHookWork is true and no stop event ever arrives. A standalone
        // Esc keypress is exactly "\x1b"; escape sequences (arrows, fn keys)
        // are longer ("\x1b[...", "\x1bO..."), so this won't fire on those.
        if (d.includes("\x03") || d === "\x1b") {
          clearAgentWorking()
        } else if (d.includes("\r")) {
          hasSubmittedToAgentRef.current = true
          lastAgentSubmitAtRef.current = now
          // Submitting another message clears the recap — it described the
          // previous turn. (Plain typing leaves the recap up so it survives
          // until the user actually sends something.)
          dismissRecap()
          // A new prompt supersedes the post-task commit affordance.
          setCommitUi((s) => (s === "open" ? "closing" : s))
        } else {
          suppressAgentActivityUntilRef.current =
            now + USER_INPUT_ECHO_SUPPRESS_MS
        }
      }
      window.term.write(sessionId, d)
    })
    let lastEmittedTitle: string | undefined
    const titleSub = term.onTitleChange((t) => {
      const trimmed = t.trim()
      // TUIs re-set the window title on every repaint, and busy agents animate
      // a leading spinner glyph that the displayed name strips anyway. Emit
      // the display-normalized title, and only when it actually changes —
      // otherwise a working agent (Codex, Claude) churns AppShell state and
      // state persistence at repaint rate, which makes the whole UI laggy.
      const displayTitle = formatAutoTitle(trimmed) ?? ""
      if (displayTitle !== lastEmittedTitle) {
        lastEmittedTitle = displayTitle
        onTitleChangeRef.current?.(displayTitle)
      }
      const titleSignal = agentActivityTitleSignal(trimmed)
      if (!titleSignal) return

      const current = agentStatusRef.current
      const previousTitleSignal = lastTitleSignalRef.current
      lastTitleSignalRef.current = titleSignal

      if (current.agentName === "claude") {
        if (previousTitleSignal && previousTitleSignal !== titleSignal) {
          markAgentWorking()
        }
        return
      }

      // Hook-backed agents (OpenCode, Codex, pi) get authoritative start/stop
      // events from their lifecycle hooks, so busy state is already covered.
      // Their TUI title carries a static leading glyph that repaints on every
      // UI interaction (opening the model picker, selecting a model), which
      // would otherwise be misread as work. Only hookless agents (Gemini, plain
      // shells) need the title-presence fallback.
      if (current.agentName && HOOK_BACKED_AGENTS.has(current.agentName)) return

      markAgentWorking()
    })

    // ResizeObserver can fire many times per frame while a window, split-pane,
    // or sidebar handle is dragged. Fit the visible xterm once per frame so the
    // terminal stays live, then send PTY resize messages at a lower rate.
    let resizeTimer: number | undefined
    let rafId: number | undefined
    let pendingSyncPty = false
    const scheduleFit = (syncPty = false) => {
      pendingSyncPty ||= syncPty
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        const shouldSyncPty = pendingSyncPty
        rafId = undefined
        pendingSyncPty = false
        suppressAgentActivityUntilRef.current =
          Date.now() + RESIZE_ACTIVITY_SUPPRESS_MS
        fitTerminal(shouldSyncPty)
      })
    }
    const ro = new ResizeObserver(() => {
      // During an active sidebar drag, skip the per-frame fit. proposeDimensions
      // forces a synchronous layout read every frame right after the drag
      // mutates the sidebar width — that thrash, on top of a busy agent's
      // rendering, is what makes dragging janky. The settle fit below runs once
      // the drag pauses. Other resizes (window, splits) keep the live fit.
      if (!document.body.classList.contains("gs-sidebar-resizing")) {
        scheduleFit(false)
      }
      if (resizeTimer) window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(
        () => scheduleFit(true),
        TERMINAL_RESIZE_SETTLE_MS
      )
    })
    ro.observe(container)

    // Drag & drop: append shell-quoted file paths to the prompt.
    const isFileDrag = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files")
    const isPathDrag = (e: DragEvent) => hasPathDragData(e.dataTransfer)
    const pastePaths = (paths: string[]) => {
      if (paths.length === 0) return
      term.paste(paths.map(shellQuote).join(" ") + " ")
      safeTerminalFocus(term)
    }
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e) && !isPathDrag(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
    }
    const onDrop = (e: DragEvent) => {
      if (!isFileDrag(e) && !isPathDrag(e)) return
      e.preventDefault()
      const draggedPaths = getPathDragData(e.dataTransfer)
      if (draggedPaths.length > 0) {
        pastePaths(draggedPaths)
        return
      }

      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return
      const paths: string[] = []
      for (let i = 0; i < files.length; i++) {
        const p = window.electronUtils.getPathForFile(files[i])
        if (p) paths.push(p)
      }
      pastePaths(paths)
    }
    container.addEventListener("dragover", onDragOver)
    container.addEventListener("drop", onDrop)

    return () => {
      unmounted = true
      ro.disconnect()
      container.removeEventListener("focusin", onTerminalFocusIn)
      container.removeEventListener("focusout", onTerminalFocusOut)
      container.removeEventListener("dragover", onDragOver)
      container.removeEventListener("drop", onDrop)
      if (resizeTimer) window.clearTimeout(resizeTimer)
      if (pendingPtyResizeTimer) window.clearTimeout(pendingPtyResizeTimer)
      if (liveDataRaf !== undefined) cancelAnimationFrame(liveDataRaf)
      if (liveDataFallbackTimer !== undefined) {
        window.clearTimeout(liveDataFallbackTimer)
      }
      for (const timer of startupFitTimers) window.clearTimeout(timer)
      if (rafId) cancelAnimationFrame(rafId)
      if (agentWorkingTimerRef.current) {
        window.clearTimeout(agentWorkingTimerRef.current)
        agentWorkingTimerRef.current = undefined
      }
      if (recapTimerRef.current) {
        window.clearTimeout(recapTimerRef.current)
        recapTimerRef.current = undefined
      }
      if (commitCheckTimerRef.current) {
        window.clearTimeout(commitCheckTimerRef.current)
        commitCheckTimerRef.current = undefined
      }
      offData?.()
      offExit()
      inputSub.dispose()
      titleSub.dispose()
      resultsSub.dispose()
      scrollSub.dispose()
      webLinks.dispose()
      kittyKeyboardQuerySub.dispose()
      kittyKeyboardPushSub.dispose()
      kittyKeyboardPopSub.dispose()
      modifyOtherKeysSub.dispose()
      colorSchemeSetSub.dispose()
      colorSchemeResetSub.dispose()
      colorSchemeQuerySub.dispose()
      kittyImageSub.dispose()
      itermImageSub.dispose()
      search.dispose()
      webglRef.current?.dispose()
      webglRef.current = null
      term.dispose()
      termRef.current = null
      fitRef.current = null
      fitTerminalRef.current = null
      searchRef.current = null
      // Do NOT reset agent status here. This cleanup also runs when the pane
      // merely remounts (e.g. a split re-nests the surviving pane under a new
      // ResizablePanelGroup). Emitting a reset would clobber a live "working"
      // status — the spinner would vanish while the agent is still running. On
      // a genuine close, AppShell removes the pane from state, so there is
      // nothing to reset anyway.
    }
  }, [
    sessionId,
    openSearch,
    markAgentWorking,
    clearAgentWorking,
    emitAgentStatus,
  ])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontFamily = appearance.fontFamily
    term.options.fontSize = appearance.fontSize
    requestAnimationFrame(() => {
      fitTerminalRef.current?.()
      // Font changes invalidate every cached glyph, so rebuild the atlas once.
      recoverTerminalRenderer(term)
    })
  }, [appearance.fontFamily, appearance.fontSize])

  // Opening/closing a split resizes this pane WITHOUT remounting it (the split
  // tree keeps the surviving terminal's React identity). The ResizeObserver
  // live-fit defers the column reflow for alternate-screen TUIs and long
  // scrollback, and its settle fit can land on an intermediate layout size, so
  // the terminal can stay wrapped at the old width until the next manual
  // resize. Force an authoritative full refit (columns + PTY sync) once the new
  // layout settles. Retries cover react-resizable-panels' post-render reflow.
  useEffect(() => {
    if (!didInitialLayoutRef.current) {
      didInitialLayoutRef.current = true
      return
    }
    const timers = [0, 60, 180].map((delay) =>
      window.setTimeout(() => {
        requestAnimationFrame(() => fitTerminalRef.current?.())
      }, delay)
    )
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [paneCount])

  useEffect(() => {
    let cancelled = false

    const refreshAgentStatus = async () => {
      try {
        const detected = await window.term.agentStatus(sessionId)
        if (cancelled) return
        const current = agentStatusRef.current
        if (!current.running && detected.running) {
          hasSubmittedToAgentRef.current = false
          lastAgentActivityAtRef.current = 0
          lastUserInputAtRef.current = 0
          lastAgentSubmitAtRef.current = 0
        }
        const recentlyActive =
          Date.now() - lastAgentActivityAtRef.current < AGENT_WORKING_QUIET_MS
        const hookAuthoritative =
          activeHookWorkRef.current ||
          Date.now() - lastHookEventAtRef.current < HOOK_AUTHORITATIVE_WINDOW_MS

        // When hooks own the state, the poller can only promote (fill in
        // missing agentName, flip running on once detection catches up) — it
        // must not downgrade running or working, since process detection
        // misses agents launched via node/bun wrappers.
        if (hookAuthoritative) {
          emitAgentStatus({
            running: current.running || detected.running,
            working: current.completed ? false : current.working,
            agentName: current.agentName ?? detected.agentName,
            workStartedAt: current.workStartedAt,
            completedAt: current.completedAt,
            completed: current.completed,
            needsAttention: current.needsAttention,
          })
          return
        }

        emitAgentStatus({
          running: detected.running,
          working: detected.running
            ? current.completed
              ? false
              : current.working || recentlyActive
            : false,
          agentName: detected.agentName,
          workStartedAt:
            detected.running || current.completed
              ? current.workStartedAt
              : undefined,
          completedAt: current.completed
            ? current.completedAt
            : detected.running
              ? undefined
              : current.completedAt,
          completed: current.completed
            ? true
            : detected.running
              ? false
              : current.completed,
          needsAttention: detected.running ? current.needsAttention : false,
        })
      } catch {
        if (!cancelled) {
          // Don't clobber hook state on a transient IPC failure either.
          const hookAuthoritative =
            activeHookWorkRef.current ||
            Date.now() - lastHookEventAtRef.current <
              HOOK_AUTHORITATIVE_WINDOW_MS
          if (!hookAuthoritative) {
            emitAgentStatus({
              running: false,
              working: false,
              completed: false,
            })
          }
        }
      }
    }

    void refreshAgentStatus()
    const interval = window.setInterval(
      () => void refreshAgentStatus(),
      AGENT_STATUS_POLL_MS
    )

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [sessionId, emitAgentStatus])

  useEffect(() => {
    return window.term.onAgentEvent(sessionId, (event) => {
      if (agentWorkingTimerRef.current) {
        window.clearTimeout(agentWorkingTimerRef.current)
        agentWorkingTimerRef.current = undefined
      }
      lastHookEventAtRef.current = Date.now()
      if (event.agentSessionId) {
        agentSessionIdRef.current = event.agentSessionId
      }
      const current = agentStatusRef.current
      if (event.event === "start") {
        // Authoritative "agent is working" signal from the lifecycle hook
        // (UserPromptSubmit). Treats agent as running even before the
        // process-name poll catches up.
        activeHookWorkRef.current = true
        hasSubmittedToAgentRef.current = true
        const now = Date.now()
        lastAgentActivityAtRef.current = now
        // A new turn began — clear any stale recap or pending recap timer.
        dismissRecap()
        // ...and the commit affordance from the previous turn.
        setCommitUi((s) => (s === "open" ? "closing" : s))
        emitAgentStatus({
          running: true,
          working: true,
          agentName: event.agentName,
          workStartedAt: now,
          completedAt: undefined,
          completed: false,
          needsAttention: false,
        })
        // First prompt is on disk now (first-message agents); refresh the title.
        void refreshAgentSessionTitle()
        return
      }
      if (event.event === "needs_attention") {
        // Only a notification that interrupts an active turn means the agent is
        // blocked on the user (a permission/approval prompt). Notifications that
        // arrive once the turn has already stopped are idle prompts — e.g.
        // Claude Code's "waiting for your input" reminder that fires ~60s after
        // a turn finishes — and must NOT flip a completed/idle agent into
        // "needs attention". Gate on the active-turn flag to tell them apart.
        if (!activeHookWorkRef.current) {
          return
        }
        // Stop the busy spinner and flag the pane as waiting on the user, but
        // keep completed false so AppShell does not fire a false completion.
        emitAgentStatus({
          running: current.running || activeHookWorkRef.current,
          working: false,
          agentName: event.agentName,
          workStartedAt: current.workStartedAt,
          completedAt: undefined,
          completed: false,
          needsAttention: true,
        })
        scheduleRecap("needs_attention")
        return
      }
      // Only a stop that closes an active turn is a real completion. Some
      // agents (notably pi) also emit session_end/session_shutdown when the TUI
      // exits or resets while no prompt is running; those must not leave a stale
      // completed dot on the project.
      const hadActiveTurn = activeHookWorkRef.current || current.working
      const wasWaitingForInput = current.needsAttention === true
      activeHookWorkRef.current = false
      lastAgentActivityAtRef.current = 0
      hasSubmittedToAgentRef.current = false
      if (!hadActiveTurn || wasWaitingForInput) {
        emitAgentStatus({
          ...current,
          working: false,
          agentName: event.agentName,
          completedAt: undefined,
          completed: false,
          needsAttention: false,
        })
        return
      }
      emitAgentStatus({
        running: current.running,
        working: false,
        agentName: event.agentName,
        workStartedAt: current.workStartedAt,
        completedAt: Date.now(),
        completed: true,
        needsAttention: false,
      })
      // Turn finished — AI titles (Claude/OpenCode) are finalized by now.
      void refreshAgentSessionTitle()
      scheduleRecap("completed")
      // Offer to commit if the finished turn left uncommitted changes.
      maybeShowCommit()
    })
  }, [
    sessionId,
    emitAgentStatus,
    scheduleRecap,
    dismissRecap,
    refreshAgentSessionTitle,
    maybeShowCommit,
  ])

  // Keep WebGL enabled for crisp terminal rendering. Load it after xterm opens
  // (deferred to a rAF) so xterm has stable cell metrics and we don't race its
  // post-open viewport sync. If the GPU context is ever lost, fall back to the
  // DOM renderer permanently rather than retrying WebGL.
  useEffect(() => {
    const term = termRef.current
    if (!term || webglRef.current || suggestedRendererType === "dom") return

    let disposed = false
    const rafId = requestAnimationFrame(() => {
      if (disposed || suggestedRendererType === "dom") return
      const t = termRef.current
      if (!t) return
      try {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => {
          webgl.dispose()
          if (webglRef.current === webgl) webglRef.current = null
          suggestedRendererType = "dom"
          ensureTerminalRenderer(t)
          refreshTerminalViewport(t)
        })
        t.loadAddon(webgl)
        webglRef.current = webgl
      } catch {
        // WebGL unavailable; xterm keeps using the default DOM renderer.
        suggestedRendererType = "dom"
      }
    })

    return () => {
      disposed = true
      cancelAnimationFrame(rafId)
    }
  }, [])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = themeObj
    recoverTerminalRenderer(term)
    // DEC mode 2031: push color-scheme report so subscribed TUIs (Claude Code,
    // Codex, Bubble Tea) repaint live on theme flip without a restart.
    if (colorSchemeSubscribedRef.current) {
      const reply = isDark ? 1 : 2
      window.term.write(sessionId, `\x1b[?${DEC_COLOR_SCHEME_REPORT};${reply}n`)
    }
  }, [themeObj, isDark, sessionId])

  useEffect(() => {
    const term = termRef.current
    if (isActive && !searchOpen && term) safeTerminalFocus(term)
  }, [isActive, searchOpen])

  useEffect(() => {
    if (focusRequest === undefined || !isActive || searchOpen) return
    const id = requestAnimationFrame(() => {
      const term = termRef.current
      if (term) safeTerminalFocus(term)
    })
    return () => cancelAnimationFrame(id)
  }, [focusRequest, isActive, searchOpen])

  const runSearch = useCallback(
    (q: string, direction: "next" | "prev" = "next") => {
      const search = searchRef.current
      if (!search) return
      if (!q) {
        search.clearDecorations()
        setSearchResults({ resultIndex: -1, resultCount: 0 })
        return
      }
      const opts = { decorations: SEARCH_DECORATIONS }
      if (direction === "next") search.findNext(q, opts)
      else search.findPrevious(q, opts)
    },
    []
  )

  useEffect(() => {
    if (!searchOpen) return
    runSearch(searchQuery, "next")
  }, [searchQuery, searchOpen, runSearch])

  const findNext = () => runSearch(searchQuery, "next")
  const findPrev = () => runSearch(searchQuery, "prev")

  const copySelection = async () => {
    const term = termRef.current
    if (!term) return
    const sel = trimTerminalSelection(term.getSelection())
    if (sel) await navigator.clipboard.writeText(sel)
    safeTerminalFocus(term)
  }

  const pasteFromClipboard = async () => {
    const term = termRef.current
    if (!term) return
    await pasteClipboard(term, sessionId, agentStatusRef.current.agentName)
  }

  const selectAll = () => {
    const term = termRef.current
    if (!term) return
    term.selectAll()
  }

  const clear = () => {
    const term = termRef.current
    if (!term) return
    term.clear()
    safeTerminalFocus(term)
  }

  const matchLabel =
    searchResults.resultCount === 0
      ? searchQuery
        ? "0/0"
        : ""
      : `${searchResults.resultIndex + 1}/${searchResults.resultCount}`

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className="relative block h-full w-full bg-[var(--xterm-bg)] py-3 pr-0 pl-3"
        style={{ "--xterm-bg": themeObj.background } as CSSProperties}
      >
        <div ref={containerRef} className="terminal-fit-host" />
        {TERMINAL_RECAP_BOX_ENABLED && recap && !showScrollToBottom && (
          <div
            className="absolute top-4 right-4 z-10 w-[min(30rem,84%)]"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
          >
            <TerminalRecapBox
              sessionId={sessionId}
              message={recap.message}
              kind={recap.kind}
              onClose={dismissRecap}
            />
          </div>
        )}
        {showScrollToBottom && (
          <Button
            type="button"
            onClick={() => {
              const term = termRef.current
              term?.scrollToBottom()
              if (term) safeTerminalFocus(term)
            }}
            onContextMenu={(e) => e.stopPropagation()}
            aria-label="Scroll to bottom"
            className={cn(
              "absolute left-1/2 z-10 -translate-x-1/2 animate-in rounded-full border border-border bg-background text-foreground shadow-md fade-in slide-in-from-bottom-2 hover:bg-background hover:brightness-95 dark:border-transparent dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary dark:hover:brightness-110",
              "bottom-4"
            )}
          >
            <ChevronDown data-icon="inline-start" />
            Scroll to bottom
          </Button>
        )}
        {FLOATING_COMMIT_AFFORDANCE_ENABLED &&
          commitUi !== "hidden" &&
          !showScrollToBottom && (
          // Outer element owns the bottom-left placement; the inner element owns
          // the slide animation so the exit keyframes do not move the anchor.
          <div
            className="absolute bottom-4 left-4 z-10"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
          >
            <div
              onAnimationEnd={(e) => {
                if (e.target === e.currentTarget && commitUi === "closing") {
                  setCommitUi("hidden")
                }
              }}
              className={cn(
                "flex items-center gap-2",
                commitUi === "closing"
                  ? // fill-mode-forwards holds the final (opacity 0) frame until
                    // unmount; without it the element snaps back to opaque for a
                    // frame at animation end — the exit "flicker".
                    "animate-out fade-out slide-out-to-bottom-2 fill-mode-forwards"
                  : "animate-in fade-in slide-in-from-bottom-2"
              )}
            >
              <Button
                type="button"
                onClick={commitChanges}
                aria-label="Commit changes with AI"
                className="rounded-full border border-border bg-background text-foreground shadow-md hover:bg-background hover:brightness-95 dark:border-transparent dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary dark:hover:brightness-110"
              >
                Commit changes
                <kbd className="ml-1 rounded border border-current/40 bg-foreground/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none opacity-100">
                  ⌘⏎
                </kbd>
              </Button>
              <Button
                type="button"
                size="icon"
                onClick={dismissCommit}
                aria-label="Dismiss"
                className="rounded-full border border-border bg-background text-foreground shadow-md hover:bg-background hover:brightness-95 dark:border-transparent dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary dark:hover:brightness-110"
              >
                <X />
              </Button>
            </div>
          </div>
        )}
        {searchOpen && (
          <div
            className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-md border border-border bg-popover/95 px-1.5 py-1 text-xs shadow-md backdrop-blur"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
          >
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault()
                  closeSearch()
                } else if (e.key === "Enter") {
                  e.preventDefault()
                  if (e.shiftKey) findPrev()
                  else findNext()
                }
              }}
              placeholder="Find"
              className="h-6 w-40 bg-transparent px-1.5 text-xs outline-none placeholder:text-muted-foreground"
            />
            <span
              className={cn(
                "min-w-[2.5rem] px-1 text-right tabular-nums",
                searchResults.resultCount === 0 && searchQuery
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {matchLabel}
            </span>
            <button
              type="button"
              onClick={findPrev}
              aria-label="Previous match"
              className="grid size-6 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <ChevronUp className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={findNext}
              aria-label="Next match"
              className="grid size-6 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <ChevronDown className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={closeSearch}
              aria-label="Close search"
              className="grid size-6 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onClick={copySelection}>
          Copy
          <ContextMenuShortcut>⌘C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={pasteFromClipboard}>
          Paste
          <ContextMenuShortcut>⌘V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={selectAll}>
          Select All
          <ContextMenuShortcut>⌘A</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={clear}>
          Clear
          <ContextMenuShortcut>⌘K</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={openSearch}>
          Find
          <ContextMenuShortcut>⌘F</ContextMenuShortcut>
        </ContextMenuItem>
        {onClose && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onClose}>Close</ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={async () => {
            const cwd = await window.term.getCwd(sessionId)
            if (cwd) await window.shellApi.revealInFinder(cwd)
          }}
        >
          Reveal in Finder
        </ContextMenuItem>
        <ContextMenuItem
          onClick={async () => {
            const cwd = await window.term.getCwd(sessionId)
            if (cwd) await window.shellApi.openInVSCode(cwd)
          }}
        >
          <VSCodeIcon className="size-3.5" />
          Open in VS Code
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
