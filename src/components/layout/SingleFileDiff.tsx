import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronUp, X } from "lucide-react"
import { WorkerPoolContextProvider } from "@pierre/diffs/react"
import { useTheme } from "@/components/theme-provider"
import { DiffViewer } from "./DiffViewer"
import {
  diffsHighlighterOptions,
  diffsWorkerPoolOptions,
} from "./diffWorkerConfig"
import {
  AudioPreview,
  MarkdownView,
  PdfPreview,
  isAudioPath,
  isImagePath,
  isMarkdownPath,
  isPdfPath,
  type MdMode,
} from "./FilePreview"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { buildMatchRanges } from "@/lib/dom-search"

type Props = {
  cwd: string
  path: string
  staged: boolean
  /** Whether this tab is currently visible. Content refetches on reveal. */
  isActive?: boolean
  viewMode?: "unified" | "split"
  mdMode?: MdMode
  onOpenFile?: (path: string) => void
}

const HIGHLIGHT_NAME = "gearshift-diff-search"
const HIGHLIGHT_ACTIVE_NAME = "gearshift-diff-search-active"
const HIGHLIGHT_STYLE = `
::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(250, 204, 21, 0.5); color: inherit; }
::highlight(${HIGHLIGHT_ACTIVE_NAME}) { background-color: rgb(250, 204, 21); color: black; }
`

function isUnsupportedDiff(patch: string): boolean {
  return (
    /^Binary files .+ differ$/m.test(patch) || /^GIT binary patch$/m.test(patch)
  )
}

export function SingleFileDiff({
  cwd,
  path,
  staged,
  isActive = true,
  viewMode = "unified",
  mdMode = "preview",
  onOpenFile,
}: Props) {
  const showMarkdownPreview = isMarkdownPath(path) && mdMode === "preview"
  const showImagePreview = isImagePath(path) && mdMode === "preview"
  const showAudioPreview = isAudioPath(path) && mdMode === "preview"
  const showPdfPreview = isPdfPath(path) && mdMode === "preview"
  const absPath = path.startsWith("/")
    ? path
    : `${cwd.replace(/\/+$/, "")}/${path}`

  const [mdSource, setMdSource] = useState<string>("")
  const [mdLoading, setMdLoading] = useState(false)
  const [mdError, setMdError] = useState<string | null>(null)
  // `isActive` dep: re-read on tab reveal so agent edits made while the tab
  // was hidden show up. The fs watcher below covers changes while visible.
  useEffect(() => {
    if (!showMarkdownPreview || !isActive) return
    let cancelled = false
    setMdLoading(true)
    setMdError(null)
    window.fsApi.readFile(absPath).then((res) => {
      if (cancelled) return
      if (!res.ok) {
        setMdError(res.error ?? "Failed to read file")
      } else if (res.tooLarge) {
        setMdError("File too large to preview")
      } else if (res.binary) {
        setMdError("Unsupported file preview")
      } else {
        setMdSource(res.content ?? "")
      }
      setMdLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [absPath, showMarkdownPreview])

  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [imgError, setImgError] = useState<string | null>(null)
  useEffect(() => {
    if (!showImagePreview) return
    let cancelled = false
    setImgUrl(null)
    setImgError(null)
    window.git.readDiffMedia(cwd, path, staged, "image").then((res) => {
      if (cancelled) return
      if (!res.ok || !res.dataUrl) {
        setImgError(res.error ?? "Failed to load image")
      } else {
        setImgUrl(res.dataUrl)
      }
    })
    return () => {
      cancelled = true
    }
  }, [cwd, path, staged, showImagePreview])

  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)
  useEffect(() => {
    if (!showAudioPreview) return
    let cancelled = false
    setAudioUrl(null)
    setAudioError(null)
    window.git.readDiffMedia(cwd, path, staged, "audio").then((res) => {
      if (cancelled) return
      if (!res.ok || !res.dataUrl) {
        setAudioError(res.error ?? "Failed to load audio")
      } else {
        setAudioUrl(res.dataUrl)
      }
    })
    return () => {
      cancelled = true
    }
  }, [cwd, path, staged, showAudioPreview])

  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  useEffect(() => {
    if (!showPdfPreview) return
    let cancelled = false
    setPdfUrl(null)
    setPdfError(null)
    window.git.readDiffMedia(cwd, path, staged, "pdf").then((res) => {
      if (cancelled) return
      if (!res.ok || !res.dataUrl) {
        setPdfError(res.error ?? "Failed to load PDF")
      } else {
        setPdfUrl(res.dataUrl)
      }
    })
    return () => {
      cancelled = true
    }
  }, [cwd, path, staged, showPdfPreview])
  const { resolvedTheme } = useTheme()
  const [patch, setPatch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Search overlay state.
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [matchIdx, setMatchIdx] = useState(0)
  const [matchCount, setMatchCount] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Snapshot of the user's text selection at the moment the context menu
  // opens. base-ui moves focus to the menu and can clear window.getSelection,
  // so we capture it on `contextmenu` and use it inside the Copy handler.
  const selectionTextRef = useRef<string>("")

  // Refetch whenever the tab becomes visible again (`isActive` dep), not just
  // on mount: hidden tabs stay mounted and can miss watcher events while an
  // agent edits the file, which would otherwise leave a stale diff on reveal.
  useEffect(() => {
    if (!isActive) return
    let cancelled = false
    setLoading(true)
    setError(null)
    window.git
      .diffFile(cwd, path, staged)
      .then((res) => {
        if (cancelled) return
        if (!res.ok) {
          setError(res.error ?? "Failed to load diff")
          setPatch("")
        } else {
          setPatch(res.patch || "")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [cwd, path, staged, isActive])

  useEffect(() => {
    const off = window.fsApi.onChanged((event) => {
      if (event.cwd !== cwd) return
      if (event.paths && !event.paths.some((p) => p.endsWith(path))) return
      window.git.diffFile(cwd, path, staged).then((res) => {
        if (res.ok) setPatch(res.patch || "")
      })
      if (showMarkdownPreview) {
        window.fsApi.readFile(absPath).then((res) => {
          if (res.ok && !res.tooLarge && !res.binary) {
            setMdSource(res.content ?? "")
          }
        })
      }
    })
    return () => {
      off()
    }
  }, [cwd, path, staged, showMarkdownPreview, absPath])

  // Ensure a top-level <style> for the highlight names exists once.
  useEffect(() => {
    if (typeof document === "undefined") return
    if (document.head.querySelector("style[data-gearshift-search]")) return
    const s = document.createElement("style")
    s.dataset.gearshiftSearch = "1"
    s.textContent = HIGHLIGHT_STYLE
    document.head.appendChild(s)
  }, [])

  // Rebuild ranges + highlights when query / patch / view changes.
  useEffect(() => {
    if (
      typeof CSS === "undefined" ||
      !("highlights" in CSS) ||
      typeof Highlight === "undefined"
    )
      return
    const highlights = CSS.highlights as Map<string, Highlight>
    if (!query) {
      highlights.delete(HIGHLIGHT_NAME)
      highlights.delete(HIGHLIGHT_ACTIVE_NAME)
      setMatchCount(0)
      return
    }
    // Defer to next frame so DiffViewer has rendered after view-mode/patch swap.
    const id = requestAnimationFrame(() => {
      const ranges = buildMatchRanges(containerRef.current, query, HIGHLIGHT_STYLE)
      setMatchCount(ranges.length)
      if (ranges.length === 0) {
        highlights.delete(HIGHLIGHT_NAME)
        highlights.delete(HIGHLIGHT_ACTIVE_NAME)
        return
      }
      const current = matchIdx >= ranges.length ? 0 : matchIdx
      if (current !== matchIdx) setMatchIdx(current)
      const active = ranges[current]
      const rest = ranges.filter((_, i) => i !== current)
      highlights.set(HIGHLIGHT_NAME, new Highlight(...rest))
      highlights.set(HIGHLIGHT_ACTIVE_NAME, new Highlight(active))
      const el =
        active.startContainer.parentElement ??
        (active.startContainer as Element)
      el?.scrollIntoView?.({ block: "center", behavior: "smooth" })
    })
    return () => cancelAnimationFrame(id)
  }, [query, matchIdx, patch, viewMode])

  // Clean up highlights on unmount.
  useEffect(() => {
    return () => {
      if (typeof CSS !== "undefined" && "highlights" in CSS) {
        ;(CSS.highlights as Map<string, Highlight>).delete(HIGHLIGHT_NAME)
        ;(CSS.highlights as Map<string, Highlight>).delete(
          HIGHLIGHT_ACTIVE_NAME,
        )
      }
    }
  }, [])

  const nextMatch = () => {
    if (!matchCount) return
    setMatchIdx((i) => (i + 1) % matchCount)
  }
  const prevMatch = () => {
    if (!matchCount) return
    setMatchIdx((i) => (i - 1 + matchCount) % matchCount)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
      e.preventDefault()
      setSearchOpen(true)
      requestAnimationFrame(() => {
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      })
    } else if (e.key === "Escape" && searchOpen) {
      setSearchOpen(false)
    }
  }

  const content = useMemo(() => {
    if (loading && !patch) {
      return (
        <div className="grid h-full place-items-center text-xs text-muted-foreground">
          Loading diff…
        </div>
      )
    }
    if (error) {
      return (
        <div className="grid h-full place-items-center text-xs text-red-500">
          {error}
        </div>
      )
    }
    if (!patch.trim()) {
      return (
        <div className="grid h-full place-items-center text-xs text-muted-foreground">
          No changes
        </div>
      )
    }
    if (isUnsupportedDiff(patch)) {
      return (
        <div className="grid h-full place-items-center text-xs text-muted-foreground">
          Unsupported file preview
        </div>
      )
    }
    return (
      <WorkerPoolContextProvider
        poolOptions={diffsWorkerPoolOptions}
        highlighterOptions={diffsHighlighterOptions}
      >
        <DiffViewer
          cwd={cwd}
          patch={patch}
          themeType={resolvedTheme}
          viewMode={viewMode}
        />
      </WorkerPoolContextProvider>
    )
  }, [cwd, loading, patch, error, resolvedTheme, viewMode])

  const copySelectionOrAll = () => {
    const sel = selectionTextRef.current
    const text = sel || patch
    if (!text) return
    void navigator.clipboard.writeText(text)
  }

  if (showMarkdownPreview) {
    // Only block on the first load — refetches (tab reveal, fs change) keep
    // showing the current content instead of flashing a loading state.
    if (mdLoading && !mdSource) {
      return (
        <div className="grid h-full place-items-center text-xs text-muted-foreground">
          Loading…
        </div>
      )
    }
    if (mdError) {
      return (
        <div className="grid h-full place-items-center text-xs text-red-500">
          {mdError}
        </div>
      )
    }
    return <MarkdownView source={mdSource} />
  }

  if (showImagePreview) {
    if (imgError) {
      return (
        <div className="grid h-full place-items-center text-xs text-red-500">
          {imgError === "unsupported-type"
            ? "Unsupported file preview"
            : imgError}
        </div>
      )
    }
    if (!imgUrl) {
      return (
        <div className="grid h-full place-items-center text-xs text-muted-foreground">
          Loading…
        </div>
      )
    }
    return (
      <div className="grid h-full place-items-center overflow-auto bg-card p-4">
        <img
          src={imgUrl}
          alt={path}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    )
  }

  if (showAudioPreview) {
    if (audioError) {
      return (
        <div className="grid h-full place-items-center text-xs text-red-500">
          {audioError === "unsupported-type"
            ? "Unsupported file preview"
            : audioError}
        </div>
      )
    }
    if (!audioUrl) {
      return (
        <div className="grid h-full place-items-center text-xs text-muted-foreground">
          Loading…
        </div>
      )
    }
    return <AudioPreview src={audioUrl} path={path} />
  }

  if (showPdfPreview) {
    if (pdfError) {
      return (
        <div className="grid h-full place-items-center text-xs text-red-500">
          {pdfError === "unsupported-type"
            ? "Unsupported file preview"
            : pdfError}
        </div>
      )
    }
    if (!pdfUrl) {
      return (
        <div className="grid h-full place-items-center text-xs text-muted-foreground">
          Loading…
        </div>
      )
    }
    return <PdfPreview src={pdfUrl} path={path} />
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onContextMenu={() => {
        try {
          const text = window.getSelection?.()?.toString() ?? ""
          selectionTextRef.current = text
        } catch {
          selectionTextRef.current = ""
        }
      }}
      className="relative h-full outline-none"
    >
      {searchOpen && (
        <div className="absolute right-3 top-2 z-10 flex items-center gap-1 rounded-md border border-border bg-popover px-1 py-1 text-xs shadow-md">
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                if (e.shiftKey) prevMatch()
                else nextMatch()
              }
            }}
            placeholder="Find in diff"
            className="w-44 bg-transparent px-2 py-0.5 outline-none placeholder:text-muted-foreground"
          />
          <span className="px-1 text-muted-foreground">
            {matchCount === 0
              ? query
                ? "0/0"
                : ""
              : `${matchIdx + 1}/${matchCount}`}
          </span>
          <button
            type="button"
            onClick={prevMatch}
            disabled={!matchCount}
            aria-label="Previous match"
            className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/15 hover:text-foreground disabled:opacity-30"
          >
            <ChevronUp className="size-3" />
          </button>
          <button
            type="button"
            onClick={nextMatch}
            disabled={!matchCount}
            aria-label="Next match"
            className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/15 hover:text-foreground disabled:opacity-30"
          >
            <ChevronDown className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => setSearchOpen(false)}
            aria-label="Close search"
            className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/15 hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </div>
      )}
      {content}
    </div>
        }
      />
      <ContextMenuContent className="min-w-[180px]">
        {onOpenFile && (
          <>
            <ContextMenuItem onClick={() => onOpenFile(path)}>
              Open file
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onClick={copySelectionOrAll}>
          {selectionTextRef.current ? "Copy selection" : "Copy diff"}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => void navigator.clipboard.writeText(path)}
        >
          Copy file path
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => {
            const root = containerRef.current
            if (!root) return
            const range = document.createRange()
            range.selectNodeContents(root)
            const sel = window.getSelection()
            sel?.removeAllRanges()
            sel?.addRange(range)
          }}
        >
          Select all
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
