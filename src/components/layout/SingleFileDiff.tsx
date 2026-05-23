import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronUp, X } from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import { DiffViewer } from "./DiffViewer"

type Props = {
  cwd: string
  path: string
  staged: boolean
  viewMode?: "unified" | "split"
}

const HIGHLIGHT_NAME = "gearshift-diff-search"
const HIGHLIGHT_ACTIVE_NAME = "gearshift-diff-search-active"
const HIGHLIGHT_STYLE = `
::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(250, 204, 21, 0.5); color: inherit; }
::highlight(${HIGHLIGHT_ACTIVE_NAME}) { background-color: rgb(250, 204, 21); color: black; }
`

/** Collect every Text node under root, descending into shadow roots. */
function collectTextNodes(root: Node): Text[] {
  const out: Text[] = []
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node as Text)
      return
    }
    if (node instanceof Element && node.shadowRoot) {
      // Inject the highlight style into each shadow root once.
      const sr = node.shadowRoot
      if (!sr.querySelector(`style[data-gearshift-search]`)) {
        const s = document.createElement("style")
        s.dataset.gearshiftSearch = "1"
        s.textContent = HIGHLIGHT_STYLE
        sr.appendChild(s)
      }
      sr.childNodes.forEach(walk)
    }
    node.childNodes.forEach(walk)
  }
  walk(root)
  return out
}

function buildMatchRanges(
  root: HTMLElement | null,
  query: string,
): Range[] {
  if (!root || !query) return []
  const nodes = collectTextNodes(root)
  if (nodes.length === 0) return []

  // Build a concatenated string + an index of where each node starts in it,
  // so a query that spans multiple highlighted tokens still matches.
  let combined = ""
  const offsets: number[] = new Array(nodes.length)
  for (let i = 0; i < nodes.length; i++) {
    offsets[i] = combined.length
    combined += nodes[i].data
  }

  const needle = query.toLowerCase()
  const hay = combined.toLowerCase()
  const ranges: Range[] = []

  // Binary-search helper: given an absolute offset, find the index of the node
  // that contains it and the local offset inside that node.
  const locate = (abs: number): { node: Text; offset: number } => {
    let lo = 0
    let hi = nodes.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1
      if (offsets[mid] <= abs) lo = mid
      else hi = mid - 1
    }
    return { node: nodes[lo], offset: abs - offsets[lo] }
  }

  let i = 0
  while (i <= hay.length - needle.length) {
    const idx = hay.indexOf(needle, i)
    if (idx === -1) break
    const startAbs = idx
    const endAbs = idx + needle.length
    const start = locate(startAbs)
    // For the end, locate the node containing endAbs - 1 then adjust offset.
    const endHit = locate(Math.max(endAbs - 1, startAbs))
    const endOffsetInNode =
      endAbs - offsets[nodes.indexOf(endHit.node)] // = endAbs - offsetOf(endHit.node)
    const r = document.createRange()
    try {
      r.setStart(start.node, start.offset)
      r.setEnd(endHit.node, endOffsetInNode)
      ranges.push(r)
    } catch {
      // Range can fail if offsets are inconsistent after DOM mutation — skip.
    }
    i = idx + Math.max(needle.length, 1)
  }
  return ranges
}

export function SingleFileDiff({
  cwd,
  path,
  staged,
  viewMode = "unified",
}: Props) {
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

  useEffect(() => {
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
  }, [cwd, path, staged])

  useEffect(() => {
    const off = window.fsApi.onChanged((event) => {
      if (event.cwd !== cwd) return
      if (event.paths && !event.paths.some((p) => p.endsWith(path))) return
      window.git.diffFile(cwd, path, staged).then((res) => {
        if (res.ok) setPatch(res.patch || "")
      })
    })
    return off
  }, [cwd, path, staged])

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
      const ranges = buildMatchRanges(containerRef.current, query)
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
    return (
      <DiffViewer
        patch={patch}
        themeType={resolvedTheme}
        viewMode={viewMode}
      />
    )
  }, [loading, patch, error, resolvedTheme, viewMode])

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
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
  )
}
