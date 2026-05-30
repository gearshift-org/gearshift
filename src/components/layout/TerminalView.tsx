import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react"
import { ChevronDown, ChevronUp, X } from "lucide-react"
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
import { agentActivityTitleSignal } from "./terminalName"
import type { TerminalAgentStatus } from "./types"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { TerminalRecapBox } from "@/components/terminal/TerminalRecapBox"
import type { ChatHistoryMessage } from "../../../electron/preload"

type Props = {
  sessionId: string
  isActive?: boolean
  onTitleChange?: (title: string) => void
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
    "dark-atom-one": {
      background: "#282c34",
      foreground: "#abb2bf",
      cursor: "#abb2bf",
      selectionBackground: "#3e4451",
      selectionInactiveBackground: "#353b45",
    },
    "light-claude": {
      background: "#f8f6ef",
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
    if (term.rows > 0) term.refresh(0, term.rows - 1)
  } catch {
    // Renderer refresh can fail while xterm is disposing.
  }
}

// Once WebGL's GPU context is lost we stop using it for every subsequent
// terminal (VS Code's pattern) — retrying tends to thrash and lose context
// again. The DOM renderer is the safe fallback.
let suggestedRendererType: "webgl" | "dom" | undefined

function recoverTerminalRenderer(term: Terminal) {
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
const TERMINAL_RESIZE_SETTLE_MS = 80
// How long the user must stay idle on a terminal after its agent finishes (or
// needs attention) before the floating recap box appears.
const RECAP_IDLE_DELAY_MS = 10000
const OUTPUT_ACTIVITY_AGENTS = new Set(["opencode", "pi", "gemini"])
const MIN_TERMINAL_FIT_COLS = 20
const MIN_TERMINAL_FIT_ROWS = 2

function shellQuote(s: string) {
  if (/^[A-Za-z0-9_\-./]+$/.test(s)) return s
  return `'${s.replace(/'/g, `'\\''`)}'`
}

async function pasteClipboard(
  term: Terminal,
  sessionId: string,
  isAgentInput: boolean
) {
  try {
    if (await window.clipboardApi.hasImage()) {
      if (isAgentInput) {
        // Agent CLIs (Claude Code, Codex, …) handle image paste themselves
        // when they receive Ctrl+V (0x16). Matches Ghostty/VS Code.
        window.term.write(sessionId, "\x16")
      } else {
        // Plain shell: write the image to a temp file and paste its path.
        const filePath = await window.clipboardApi.getImagePath()
        if (filePath) term.paste(shellQuote(filePath) + " ")
      }
      term.focus()
      return
    }
  } catch {
    // fall through to text paste
  }
  const text = await navigator.clipboard.readText()
  if (text) term.paste(text)
  term.focus()
}

export function TerminalView({
  sessionId,
  isActive = true,
  onTitleChange,
  onAgentStatusChange,
  onClose,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const fitTerminalRef = useRef<(() => boolean) | null>(null)
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
  const onAgentStatusChangeRef = useRef(onAgentStatusChange)
  const agentStatusRef = useRef<TerminalAgentStatus>({
    running: false,
    working: false,
  })
  const agentWorkingTimerRef = useRef<number | undefined>(undefined)
  const lastAgentActivityAtRef = useRef(0)
  const lastUserInputAtRef = useRef(0)
  const lastAgentSubmitAtRef = useRef(0)
  const lastTitleSignalRef = useRef<string | undefined>(undefined)
  const hasSubmittedToAgentRef = useRef(false)
  const suppressAgentActivityUntilRef = useRef(0)
  const lastHookEventAtRef = useRef(0)
  const activeHookWorkRef = useRef(false)
  const recapTimerRef = useRef<number | undefined>(undefined)

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState({
    resultIndex: -1,
    resultCount: 0,
  })
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [recap, setRecap] = useState<{
    message: ChatHistoryMessage | null
    kind: "completed" | "needs_attention"
  } | null>(null)

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
    termRef.current?.focus()
  }, [])

  useEffect(() => {
    onTitleChangeRef.current = onTitleChange
  }, [onTitleChange])

  useEffect(() => {
    onAgentStatusChangeRef.current = onAgentStatusChange
  }, [onAgentStatusChange])

  const emitAgentStatus = useCallback((next: TerminalAgentStatus) => {
    const prev = agentStatusRef.current
    if (
      prev.running === next.running &&
      prev.working === next.working &&
      prev.agentName === next.agentName &&
      prev.workStartedAt === next.workStartedAt &&
      prev.completedAt === next.completedAt &&
      prev.completed === next.completed &&
      prev.needsAttention === next.needsAttention
    ) {
      return
    }
    agentStatusRef.current = next
    onAgentStatusChangeRef.current?.(next)
  }, [])

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
      if (recapTimerRef.current) window.clearTimeout(recapTimerRef.current)
      const triggeredAt = Date.now()
      recapTimerRef.current = window.setTimeout(() => {
        recapTimerRef.current = undefined
        if (lastUserInputAtRef.current > triggeredAt) return
        void window.term.history.list(sessionId).then((rows) => {
          if (lastUserInputAtRef.current > triggeredAt) return
          setRecap({ message: rows.at(-1) ?? null, kind })
        })
      }, RECAP_IDLE_DELAY_MS)
    },
    [sessionId],
  )

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
      workStartedAt: current.workStartedAt ?? now,
      completedAt: undefined,
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
      // `width` enables a 1px overview ruler so search-match decorations show
      // up the scrollbar gutter (xterm 6.1 merged overviewRuler into scrollbar).
      scrollbar: { width: 1 },
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
      setShowScrollToBottom(buf.viewportY < buf.baseY)
    })

    const resultsSub = search.onDidChangeResults((e) => {
      setSearchResults({
        resultIndex: e.resultIndex,
        resultCount: e.resultCount,
      })
    })

    // Use the legacy ESC+Enter newline sequence by default because Claude Code,
    // Codex, and OpenCode already understand it. If a TUI probes/enables
    // modified keyboard modes (like pi), switch Enter to an explicit modified
    // Enter sequence instead.
    let modifiedEnterSequence = "\x1b\r"
    const kittyKeyboardQuerySub = term.parser.registerCsiHandler(
      { prefix: "?", final: "u" },
      () => {
        modifiedEnterSequence = "\x1b[13;2u"
        return true
      }
    )
    const kittyKeyboardPushSub = term.parser.registerCsiHandler(
      { prefix: ">", final: "u" },
      () => {
        modifiedEnterSequence = "\x1b[13;2u"
        return true
      }
    )
    const kittyKeyboardPopSub = term.parser.registerCsiHandler(
      { prefix: "<", final: "u" },
      () => {
        modifiedEnterSequence = "\x1b\r"
        return true
      }
    )
    const modifyOtherKeysSub = term.parser.registerCsiHandler(
      { prefix: ">", final: "m" },
      (params) => {
        const first = Array.isArray(params[0]) ? params[0][0] : params[0]
        const second = Array.isArray(params[1]) ? params[1][0] : params[1]
        if (first !== 4) return false
        modifiedEnterSequence = second === 0 ? "\x1b\r" : "\x1b[27;2;13~"
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
          colorSchemeSubscribedRef.current = true
        }
        return false
      }
    )
    const colorSchemeResetSub = term.parser.registerCsiHandler(
      { prefix: "?", final: "l" },
      (params) => {
        if (csiParamsInclude(params, DEC_COLOR_SCHEME_UPDATE)) {
          colorSchemeSubscribedRef.current = false
        }
        return false
      }
    )
    const colorSchemeQuerySub = term.parser.registerCsiHandler(
      { prefix: "?", final: "n" },
      (params) => {
        if (!csiParamsInclude(params, DEC_COLOR_SCHEME_QUERY)) return false
        const reply = themeRef.current.isDark ? 1 : 2
        window.term.write(
          sessionId,
          `\x1b[?${DEC_COLOR_SCHEME_REPORT};${reply}n`
        )
        return true
      }
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

      // Cmd+F — open search overlay.
      if ((meta || ctrl) && !alt && !shift && key === "f") {
        e.preventDefault()
        openSearch()
        return false
      }

      // Clipboard / selection (Cmd or Ctrl).
      if ((meta || ctrl) && !alt) {
        if (key === "c" && term.hasSelection()) {
          e.preventDefault()
          const sel = trimTerminalSelection(term.getSelection())
          if (sel) void navigator.clipboard.writeText(sel)
          return false
        }
        if (key === "v") {
          e.preventDefault()
          void pasteClipboard(term, sessionId, !!agentStatusRef.current.running)
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
    const fitTerminal = () => {
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
          term.resize(dims.cols, dims.rows)
          window.term.resize(sessionId, dims.cols, dims.rows)
          refreshTerminalViewport(term)
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
    if (isActive) term.focus()

    // Pull whatever scrollback the daemon captured before this view mounted
    // (empty for freshly spawned sessions), THEN subscribe to live data.
    // Subscribing first would race: live chunks would render before the
    // snapshot resolves, and the snapshot would then be appended on top,
    // producing duplicated/out-of-order output. The daemon-client side of
    // snapshot() drops its pendingData buffer so the post-snapshot subscribe
    // only receives bytes that arrived after the snapshot was taken.
    let offData: (() => void) | null = null
    const onDataChunk = (chunk: string) => {
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
    void window.term.snapshot(sessionId).then((snap) => {
      if (unmounted) return
      if (snap) term.write(snap)
      offData = window.term.onData(sessionId, onDataChunk)
    })
    const offExit = window.term.onExit(sessionId, () => {
      term.write("\r\n\x1b[31m[process exited]\x1b[0m\r\n")
    })

    const inputSub = term.onData((d) => {
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
        } else {
          suppressAgentActivityUntilRef.current =
            now + USER_INPUT_ECHO_SUPPRESS_MS
        }
      }
      window.term.write(sessionId, d)
    })
    const titleSub = term.onTitleChange((t) => {
      const trimmed = t.trim()
      onTitleChangeRef.current?.(trimmed)
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

      markAgentWorking()
    })

    // Debounce + rAF: ResizeObserver can fire many times per frame while a
    // window or split-pane handle is dragged. Wait briefly for layout to settle
    // so adding a split does not reflow the existing terminal through several
    // intermediate widths.
    let resizeTimer: number | undefined
    let rafId: number | undefined
    const scheduleFit = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        suppressAgentActivityUntilRef.current =
          Date.now() + RESIZE_ACTIVITY_SUPPRESS_MS
        fitTerminal()
        // A resize keeps glyph metrics valid, so just repaint in place; the
        // WebGL renderer handles its own atlas across resizes and DPR changes.
        const term = termRef.current
        if (term) refreshTerminalViewport(term)
      })
    }
    const ro = new ResizeObserver(() => {
      if (resizeTimer) window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(scheduleFit, TERMINAL_RESIZE_SETTLE_MS)
    })
    ro.observe(container)

    // Drag & drop: append shell-quoted file paths to the prompt.
    const isFileDrag = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files")
    const isPathDrag = (e: DragEvent) => hasPathDragData(e.dataTransfer)
    const pastePaths = (paths: string[]) => {
      if (paths.length === 0) return
      term.paste(paths.map(shellQuote).join(" ") + " ")
      term.focus()
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
      container.removeEventListener("dragover", onDragOver)
      container.removeEventListener("drop", onDrop)
      if (resizeTimer) window.clearTimeout(resizeTimer)
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
      search.dispose()
      webglRef.current?.dispose()
      webglRef.current = null
      term.dispose()
      termRef.current = null
      fitRef.current = null
      fitTerminalRef.current = null
      searchRef.current = null
      emitAgentStatus({ running: false, working: false, completed: false })
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
            working: current.working,
            agentName: current.agentName ?? detected.agentName,
            workStartedAt: current.workStartedAt,
            completedAt: undefined,
            completed: false,
            needsAttention: current.needsAttention,
          })
          return
        }

        emitAgentStatus({
          running: detected.running,
          working: detected.running ? current.working || recentlyActive : false,
          agentName: detected.agentName,
          workStartedAt: detected.running ? current.workStartedAt : undefined,
          completedAt: undefined,
          completed: false,
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
        emitAgentStatus({
          running: true,
          working: true,
          agentName: event.agentName,
          workStartedAt: current.workStartedAt ?? now,
          completedAt: undefined,
          completed: false,
          needsAttention: false,
        })
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
      // Only the explicit lifecycle stop event completes hook-backed work.
      activeHookWorkRef.current = false
      lastAgentActivityAtRef.current = 0
      hasSubmittedToAgentRef.current = false
      emitAgentStatus({
        running: current.running,
        working: false,
        agentName: event.agentName,
        workStartedAt: current.workStartedAt,
        completedAt: Date.now(),
        completed: true,
        needsAttention: false,
      })
      scheduleRecap("completed")
    })
  }, [sessionId, emitAgentStatus, scheduleRecap, dismissRecap])

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
    if (isActive && !searchOpen) termRef.current?.focus()
  }, [isActive, searchOpen])

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
    term.focus()
  }

  const pasteFromClipboard = async () => {
    const term = termRef.current
    if (!term) return
    await pasteClipboard(term, sessionId, !!agentStatusRef.current.running)
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
    term.focus()
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
        className="relative block h-full w-full bg-[var(--xterm-bg)] px-3 py-3"
        style={{ "--xterm-bg": themeObj.background } as CSSProperties}
      >
        <div ref={containerRef} className="terminal-fit-host" />
        {recap && (
          <div
            className="absolute top-3 left-1/2 z-10 w-[min(34rem,85%)] -translate-x-1/2"
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
          <button
            type="button"
            onClick={() => {
              termRef.current?.scrollToBottom()
              termRef.current?.focus()
            }}
            onContextMenu={(e) => e.stopPropagation()}
            aria-label="Scroll to bottom"
            className="absolute bottom-4 left-1/2 z-10 flex h-8 -translate-x-1/2 animate-in items-center gap-1.5 rounded-full border border-border bg-popover/95 px-4 text-xs text-muted-foreground shadow-md backdrop-blur transition-colors duration-200 fade-in slide-in-from-bottom-2 hover:bg-accent/60 hover:text-foreground"
          >
            <ChevronDown className="size-3.5" />
            Scroll to bottom
          </button>
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
