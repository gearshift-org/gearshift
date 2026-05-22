import { useEffect, useRef } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { useTheme } from "@/components/theme-provider"
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
}
const LIGHT_THEME = {
  background: "#ffffff",
  foreground: "#171717",
  cursor: "#171717",
  selectionBackground: "#3b82f655",
  selectionForeground: "#171717",
  selectionInactiveBackground: "#3b82f630",
}

function resolveIsDark(theme: "dark" | "light" | "system") {
  if (theme === "dark") return true
  if (theme === "light") return false
  return window.matchMedia("(prefers-color-scheme: dark)").matches
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
  const { theme } = useTheme()
  const isDark = resolveIsDark(theme)
  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      scrollback: 5000,
      theme: isDark ? DARK_THEME : LIGHT_THEME,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    termRef.current = term

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
    term.focus()

    const offData = window.term.onData(sessionId, (chunk) => term.write(chunk))
    const offExit = window.term.onExit(sessionId, () => {
      term.write("\r\n\x1b[31m[process exited]\x1b[0m\r\n")
    })

    const inputSub = term.onData((d) => window.term.write(sessionId, d))
    const titleSub = term.onTitleChange((t) => {
      const trimmed = t.trim()
      // Skip the default "user@host:path" titles shells set on every prompt.
      if (/^[^@\s]+@[^:\s]+:/.test(trimmed)) return
      onTitleChangeRef.current?.(trimmed)
    })

    let resizeTimer: number | undefined
    const ro = new ResizeObserver(() => {
      if (resizeTimer) window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(safeFit, 50)
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
      offData()
      offExit()
      inputSub.dispose()
      titleSub.dispose()
      term.dispose()
      termRef.current = null
    }
  }, [sessionId])

  const themeObj = isDark ? DARK_THEME : LIGHT_THEME
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = themeObj
  }, [themeObj])

  useEffect(() => {
    if (isActive) termRef.current?.focus()
  }, [isActive])

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

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className={`${WRAPPER_BG} block h-full w-full bg-[var(--xterm-bg)] px-3 py-3`}
      >
        <div ref={containerRef} className="h-full w-full" />
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
      </ContextMenuContent>
    </ContextMenu>
  )
}
