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

  // Reset match index when query/content changes.
  useEffect(() => {
    setMatchIdx(0)
  }, [query])

  const focusMatch = (idx: number) => {
    if (!matchCount) return
    const [start, end] = matches[((idx % matchCount) + matchCount) % matchCount]
    const ta = textareaRef.current
    if (!ta) return
    ta.focus({ preventScroll: false })
    ta.setSelectionRange(start, end)
    // Best-effort scroll: textareas auto-scroll selection into view in most
    // browsers; nudge by re-setting selectionEnd.
    const tmp = ta.selectionEnd
    ta.selectionEnd = tmp
  }

  const nextMatch = () => {
    if (!matchCount) return
    const next = (matchIdx + 1) % matchCount
    setMatchIdx(next)
    focusMatch(next)
  }
  const prevMatch = () => {
    if (!matchCount) return
    const next = (matchIdx - 1 + matchCount) % matchCount
    setMatchIdx(next)
    focusMatch(next)
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
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        className="flex-1 resize-none bg-transparent p-4 font-mono text-xs leading-relaxed whitespace-pre outline-none"
      />
    </div>
  )
}
