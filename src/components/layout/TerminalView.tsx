import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronUp, X } from "lucide-react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { SearchAddon } from "@xterm/addon-search"
import { WebglAddon } from "@xterm/addon-webgl"
import { useTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

type Props = {
  sessionId: string
  isActive?: boolean
  onTitleChange?: (title: string) => void
}

const DARK_THEME = {
  background: "#0a0a0a",
  foreground: "#e5e5e5",
  cursor: "#e5e5e5",
  selectionBackground: "#ffffff40",
  selectionForeground: "#ffffff",
  selectionInactiveBackground: "#ffffff25",
  black: "#1a1a1a",
  red: "#ef4444",
  green: "#22c55e",
  yellow: "#eab308",
  blue: "#3b82f6",
  magenta: "#a855f7",
  cyan: "#06b6d4",
  white: "#e5e5e5",
  // Bright variants — brightBlack drives zsh-autosuggestions "ghost" text.
  brightBlack: "#5a5a5a",
  brightRed: "#f87171",
  brightGreen: "#4ade80",
  brightYellow: "#facc15",
  brightBlue: "#60a5fa",
  brightMagenta: "#c084fc",
  brightCyan: "#22d3ee",
  brightWhite: "#fafafa",
}
const LIGHT_THEME = {
  background: "#ffffff",
  foreground: "#171717",
  cursor: "#171717",
  selectionBackground: "#3b82f655",
  selectionForeground: "#171717",
  selectionInactiveBackground: "#3b82f630",
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

const SEARCH_DECORATIONS = {
  matchBackground: "#a8a8a833",
  matchBorder: "#a8a8a866",
  matchOverviewRuler: "#a8a8a8",
  activeMatchBackground: "#facc15aa",
  activeMatchBorder: "#facc15",
  activeMatchColorOverviewRuler: "#facc15",
}

const WRAPPER_BG = "[--xterm-bg:#ffffff] dark:[--xterm-bg:#0a0a0a]"

function shellQuote(s: string) {
  if (/^[A-Za-z0-9_\-./]+$/.test(s)) return s
  return `'${s.replace(/'/g, `'\\''`)}'`
}

async function pasteClipboard(term: Terminal, sessionId: string) {
  // If clipboard has an image, send Ctrl+V (0x16) so CLIs like Claude Code
  // and Codex can pick up the image themselves. Matches Ghostty/VS Code.
  try {
    if (await window.clipboardApi.hasImage()) {
      window.term.write(sessionId, "\x16")
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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const webglRef = useRef<WebglAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState({
    resultIndex: -1,
    resultCount: 0,
  })

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
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      scrollback: 5000,
      // We hide xterm's native scrollbar and keep the background stable during
      // resize, so avoid reserving the default 14px scrollbar gutter.
      overviewRuler: { width: 1 },
      theme: isDark ? DARK_THEME : LIGHT_THEME,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.open(container)
    termRef.current = term
    searchRef.current = search

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
      },
    )
    const kittyKeyboardPushSub = term.parser.registerCsiHandler(
      { prefix: ">", final: "u" },
      () => {
        modifiedEnterSequence = "\x1b[13;2u"
        return true
      },
    )
    const kittyKeyboardPopSub = term.parser.registerCsiHandler(
      { prefix: "<", final: "u" },
      () => {
        modifiedEnterSequence = "\x1b\r"
        return true
      },
    )
    const modifyOtherKeysSub = term.parser.registerCsiHandler(
      { prefix: ">", final: "m" },
      (params) => {
        const first = Array.isArray(params[0]) ? params[0][0] : params[0]
        const second = Array.isArray(params[1]) ? params[1][0] : params[1]
        if (first !== 4) return false
        modifiedEnterSequence = second === 0 ? "\x1b\r" : "\x1b[27;2;13~"
        return true
      },
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
          void navigator.clipboard.writeText(term.getSelection())
          return false
        }
        if (key === "v") {
          e.preventDefault()
          void pasteClipboard(term, sessionId)
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
          key === "arrowleft" ? LINE_START : LINE_END,
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
          key === "arrowleft" ? WORD_BACK : WORD_FORWARD,
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
        window.term.write(sessionId, modifiedEnterSequence)
        return false
      }

      return true
    })

    // Initial size + send to PTY.
    const safeFit = () => {
      try {
        fit.fit()
        window.term.resize(sessionId, term.cols, term.rows)
      } catch {
        // ignore
      }
    }
    safeFit()
    if (isActive) term.focus()

    const offData = window.term.onData(sessionId, (chunk) => term.write(chunk))
    const offExit = window.term.onExit(sessionId, () => {
      term.write("\r\n\x1b[31m[process exited]\x1b[0m\r\n")
    })

    const inputSub = term.onData((d) => window.term.write(sessionId, d))
    const titleSub = term.onTitleChange((t) => {
      const trimmed = t.trim()
      onTitleChangeRef.current?.(trimmed)
    })

    // Debounce + rAF: ResizeObserver can fire many times per frame while a
    // split-pane handle is dragged or panes are added. Collapse those into a
    // single fit() per animation frame to prevent visible reflow/flicker.
    let resizeTimer: number | undefined
    let rafId: number | undefined
    let lastCols = term.cols
    let lastRows = term.rows
    const scheduleFit = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        try {
          fit.fit()
          if (term.cols !== lastCols || term.rows !== lastRows) {
            lastCols = term.cols
            lastRows = term.rows
            window.term.resize(sessionId, term.cols, term.rows)
          }
        } catch {
          // ignore
        }
      })
    }
    const ro = new ResizeObserver(() => {
      if (resizeTimer) window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(scheduleFit, 16)
    })
    ro.observe(container)

    // Drag & drop: append shell-quoted file paths to the prompt.
    const isFileDrag = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files")
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
    }
    const onDrop = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return
      const paths: string[] = []
      for (let i = 0; i < files.length; i++) {
        const p = window.electronUtils.getPathForFile(files[i])
        if (p) paths.push(p)
      }
      if (paths.length === 0) return
      term.paste(paths.map(shellQuote).join(" ") + " ")
      term.focus()
    }
    container.addEventListener("dragover", onDragOver)
    container.addEventListener("drop", onDrop)

    return () => {
      ro.disconnect()
      container.removeEventListener("dragover", onDragOver)
      container.removeEventListener("drop", onDrop)
      if (resizeTimer) window.clearTimeout(resizeTimer)
      if (rafId) cancelAnimationFrame(rafId)
      offData()
      offExit()
      inputSub.dispose()
      titleSub.dispose()
      resultsSub.dispose()
      kittyKeyboardQuerySub.dispose()
      kittyKeyboardPushSub.dispose()
      kittyKeyboardPopSub.dispose()
      modifyOtherKeysSub.dispose()
      search.dispose()
      webglRef.current?.dispose()
      webglRef.current = null
      term.dispose()
      termRef.current = null
      searchRef.current = null
    }
  }, [sessionId, openSearch])

  // Keep WebGL enabled for crisp terminal rendering. Load it after xterm opens,
  // matching the original GearShift pattern, so xterm has stable cell metrics.
  useEffect(() => {
    const term = termRef.current
    if (!term || webglRef.current) return

    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl.dispose()
        if (webglRef.current === webgl) webglRef.current = null
      })
      term.loadAddon(webgl)
      webglRef.current = webgl
    } catch {
      // WebGL unavailable; xterm keeps using the default renderer.
    }
  }, [])

  const themeObj = isDark ? DARK_THEME : LIGHT_THEME
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = themeObj
  }, [themeObj])

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
    [],
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
    const sel = term.getSelection()
    if (sel) await navigator.clipboard.writeText(sel)
    term.focus()
  }

  const pasteFromClipboard = async () => {
    const term = termRef.current
    if (!term) return
    await pasteClipboard(term, sessionId)
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
        className={`${WRAPPER_BG} relative block h-full w-full bg-[var(--xterm-bg)] px-3 py-3`}
      >
        <div ref={containerRef} className="terminal-fit-host" />
        {searchOpen && (
          <div
            className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md border border-border bg-popover/95 px-1.5 py-1 text-xs shadow-md backdrop-blur"
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
                  : "text-muted-foreground",
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
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={async () => {
            const cwd = await window.term.getCwd(sessionId)
            if (cwd) await window.shellApi.openInVSCode(cwd)
          }}
        >
          Open in VS Code
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
