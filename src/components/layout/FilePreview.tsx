import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronUp, X } from "lucide-react"
import { cn } from "@/lib/utils"

type Props = {
  cwd: string
  /** Path relative to project root. */
  path: string
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; content: string }
  | { kind: "too-large"; size: number }
  | { kind: "binary" }
  | { kind: "error"; message: string }

const HIGHLIGHT_NAME = "gearshift-file-search"
const HIGHLIGHT_ACTIVE_NAME = "gearshift-file-search-active"
const HIGHLIGHT_STYLE = `
::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(250, 204, 21, 0.5); color: inherit; }
::highlight(${HIGHLIGHT_ACTIVE_NAME}) { background-color: rgb(250, 204, 21); color: black; }
`

function joinPath(cwd: string, rel: string): string {
  if (rel.startsWith("/")) return rel
  return `${cwd.replace(/\/+$/, "")}/${rel}`
}

function findAllMatches(text: string, query: string): [number, number][] {
  if (!query) return []
  const res: [number, number][] = []
  const needle = query.toLowerCase()
  const hay = text.toLowerCase()
  let i = 0
  while (i <= hay.length - needle.length) {
    const idx = hay.indexOf(needle, i)
    if (idx === -1) break
    res.push([idx, idx + needle.length])
    i = idx + Math.max(needle.length, 1)
  }
  return res
}

export function FilePreview({ cwd, path }: Props) {
  const abs = useMemo(() => joinPath(cwd, path), [cwd, path])
  const [state, setState] = useState<LoadState>({ kind: "loading" })
  const [savedContent, setSavedContent] = useState<string>("")
  const [draft, setDraft] = useState<string>("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bgRef = useRef<HTMLPreElement>(null)

  // Search overlay state.
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [matchIdx, setMatchIdx] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const dirty = state.kind === "ready" && draft !== savedContent

  useEffect(() => {
    let cancelled = false
    setState({ kind: "loading" })
    setSaveError(null)
    window.fsApi.readFile(abs).then((res) => {
      if (cancelled) return
      if (!res.ok) {
        setState({ kind: "error", message: res.error ?? "Failed to read file" })
      } else if (res.tooLarge) {
        setState({ kind: "too-large", size: res.size ?? 0 })
      } else if (res.binary) {
        setState({ kind: "binary" })
      } else {
        const c = res.content ?? ""
        setState({ kind: "ready", content: c })
        setSavedContent(c)
        setDraft(c)
      }
    })
    return () => {
      cancelled = true
    }
  }, [abs])

  // One-time global stylesheet for the highlight names.
  useEffect(() => {
    if (typeof document === "undefined") return
    if (document.head.querySelector("style[data-gearshift-file-search]"))
      return
    const s = document.createElement("style")
    s.dataset.gearshiftFileSearch = "1"
    s.textContent = HIGHLIGHT_STYLE
    document.head.appendChild(s)
  }, [])

  const save = async () => {
    if (state.kind !== "ready" || !dirty || saving) return
    setSaving(true)
    setSaveError(null)
    const res = await window.fsApi.writeFile(abs, draft)
    setSaving(false)
    if (!res.ok) {
      setSaveError(res.error ?? "Save failed")
      return
    }
    setSavedContent(draft)
  }

  const matches = useMemo(
    () => (state.kind === "ready" ? findAllMatches(draft, query) : []),
    [state, draft, query],
  )
  const matchCount = matches.length

  useEffect(() => {
    setMatchIdx(0)
  }, [query])

  // Apply highlights to the bg <pre>'s text node.
  useEffect(() => {
    if (
      typeof CSS === "undefined" ||
      !("highlights" in CSS) ||
      typeof Highlight === "undefined"
    )
      return
    const highlights = CSS.highlights as Map<string, Highlight>
    const pre = bgRef.current
    const textNode = pre?.firstChild as Text | null | undefined
    if (!textNode || matchCount === 0 || !query) {
      highlights.delete(HIGHLIGHT_NAME)
      highlights.delete(HIGHLIGHT_ACTIVE_NAME)
      return
    }
    const currentIdx = matchIdx >= matchCount ? 0 : matchIdx
    const restRanges: Range[] = []
    let activeRange: Range | null = null
    for (let i = 0; i < matches.length; i++) {
      const [s, e] = matches[i]
      const r = document.createRange()
      try {
        r.setStart(textNode, s)
        r.setEnd(textNode, e)
      } catch {
        continue
      }
      if (i === currentIdx) activeRange = r
      else restRanges.push(r)
    }
    highlights.set(HIGHLIGHT_NAME, new Highlight(...restRanges))
    if (activeRange) {
      highlights.set(HIGHLIGHT_ACTIVE_NAME, new Highlight(activeRange))
    } else {
      highlights.delete(HIGHLIGHT_ACTIVE_NAME)
    }
  }, [matches, matchCount, matchIdx, query, draft])

  // Clean up on unmount.
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

  const scrollMatchIntoView = (idx: number) => {
    if (!matchCount) return
    const [start, end] = matches[((idx % matchCount) + matchCount) % matchCount]
    const ta = textareaRef.current
    const pre = bgRef.current
    if (!ta) return
    // setSelectionRange doesn't reliably auto-scroll across browsers, so
    // compute the line and scroll manually. Keep the bg <pre> in sync.
    const cs = window.getComputedStyle(ta)
    const lineHeight =
      parseFloat(cs.lineHeight) ||
      parseFloat(cs.fontSize) * 1.4 ||
      16
    const linesBefore = draft.slice(0, start).split("\n").length - 1
    const target = Math.max(
      0,
      linesBefore * lineHeight - ta.clientHeight / 2 + lineHeight / 2,
    )
    ta.scrollTop = target
    if (pre) pre.scrollTop = target
    // Selection (visible even when textarea isn't focused, just muted).
    ta.setSelectionRange(start, end)
  }

  const nextMatch = () => {
    if (!matchCount) return
    const next = (matchIdx + 1) % matchCount
    setMatchIdx(next)
    scrollMatchIntoView(next)
  }
  const prevMatch = () => {
    if (!matchCount) return
    const next = (matchIdx - 1 + matchCount) % matchCount
    setMatchIdx(next)
    scrollMatchIntoView(next)
  }

  // Cmd/Ctrl+F opens search; Cmd/Ctrl+S saves; Escape closes search.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
      e.preventDefault()
      setSearchOpen(true)
      requestAnimationFrame(() => {
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      })
    } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault()
      void save()
    } else if (e.key === "Escape" && searchOpen) {
      setSearchOpen(false)
      textareaRef.current?.focus()
    }
  }

  if (state.kind === "loading") {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground">
        Loading…
      </div>
    )
  }
  if (state.kind === "too-large") {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground">
        File too large to preview ({Math.round(state.size / 1024)} KB).
      </div>
    )
  }
  if (state.kind === "binary") {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground">
        Binary file
      </div>
    )
  }
  if (state.kind === "error") {
    return (
      <div className="grid h-full place-items-center text-xs text-red-500">
        {state.message}
      </div>
    )
  }

  return (
    <div
      className="relative flex h-full flex-col bg-card"
      onKeyDown={onKeyDown}
    >
      {searchOpen && (
        <div className="absolute right-3 top-2 z-20 flex items-center gap-1 rounded-md border border-border bg-popover px-1 py-1 text-xs shadow-md">
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
            placeholder="Find"
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
            onClick={() => {
              setSearchOpen(false)
              textareaRef.current?.focus()
            }}
            aria-label="Close search"
            className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/15 hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </div>
      )}
      {(dirty || saveError) && (
        <div className="flex h-6 shrink-0 items-center justify-between border-b border-border/60 px-3 text-[11px]">
          <span className={cn(dirty ? "text-muted-foreground" : "")}>
            {dirty
              ? saving
                ? "Saving…"
                : "Modified — ⌘S to save"
              : null}
          </span>
          {saveError && <span className="text-red-500">{saveError}</span>}
        </div>
      )}
      <div className="relative flex-1 min-h-0">
        {/* Background: the text rendered as real text nodes so the CSS
            Highlight API has something to highlight. */}
        <pre
          ref={bgRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 m-0 overflow-auto p-4 font-mono text-xs leading-relaxed whitespace-pre text-foreground"
        >
          {draft}
        </pre>
        {/* Foreground: invisible-text textarea that still accepts input and
            shows the caret. Keep scroll/size identical so highlights line up. */}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onScroll={(e) => {
            const pre = bgRef.current
            if (!pre) return
            pre.scrollTop = e.currentTarget.scrollTop
            pre.scrollLeft = e.currentTarget.scrollLeft
          }}
          spellCheck={false}
          className="absolute inset-0 resize-none bg-transparent p-4 font-mono text-xs leading-relaxed whitespace-pre text-transparent caret-foreground outline-none selection:bg-foreground/20 [-webkit-text-fill-color:transparent]"
        />
      </div>
    </div>
  )
}
