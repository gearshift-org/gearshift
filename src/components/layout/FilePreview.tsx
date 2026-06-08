import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  copyLineDown,
  copyLineUp,
  indentLess,
  indentMore,
  indentWithTab,
  moveLineDown,
  moveLineUp,
  toggleLineComment,
} from "@codemirror/commands"
import { LanguageDescription, StreamLanguage } from "@codemirror/language"
import { languages } from "@codemirror/language-data"
import { Compartment, EditorState, Prec } from "@codemirror/state"
import { keymap } from "@codemirror/view"
import { SearchQuery, setSearchQuery } from "@codemirror/search"
import { basicSetup, EditorView } from "codemirror"
import { oneDark } from "@codemirror/theme-one-dark"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"
import { ChevronDown, ChevronUp, X } from "lucide-react"
import { store } from "@/lib/store"
import { buildMatchRanges } from "@/lib/dom-search"

const PREVIEW_HIGHLIGHT_NAME = "gearshift-md-search"
const PREVIEW_HIGHLIGHT_ACTIVE_NAME = "gearshift-md-search-active"
const PREVIEW_HIGHLIGHT_STYLE = `
::highlight(${PREVIEW_HIGHLIGHT_NAME}) { background-color: rgba(250, 204, 21, 0.5); color: inherit; }
::highlight(${PREVIEW_HIGHLIGHT_ACTIVE_NAME}) { background-color: rgb(250, 204, 21); color: black; }
`

const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "avif",
])

const AUDIO_EXTS = new Set(["mp3", "wav"])
const PDF_EXTS = new Set(["pdf"])

const MARKDOWN_EXTS = new Set(["md", "markdown", "mdown", "mkd"])

function extOf(path: string): string {
  const i = path.lastIndexOf(".")
  return i < 0 ? "" : path.slice(i + 1).toLowerCase()
}

function isEnvPath(path: string): boolean {
  const fileName = path.split(/[\\/]/).pop()?.toLowerCase() ?? ""
  return fileName.startsWith(".env") || extOf(fileName) === "env"
}

type DotenvState = {
  afterEquals: boolean
}

const dotenvLanguage = StreamLanguage.define<DotenvState>({
  name: "dotenv",
  startState: () => ({ afterEquals: false }),
  token(stream, state) {
    if (stream.sol()) state.afterEquals = false
    if (stream.eatSpace()) return null

    if (stream.peek() === "#") {
      stream.skipToEnd()
      return "comment"
    }

    if (!state.afterEquals && stream.match("export")) return "keyword"

    if (!state.afterEquals && stream.match(/[A-Za-z_][\w.-]*/)) {
      return "variableName"
    }

    if (stream.peek() === "=") {
      stream.next()
      state.afterEquals = true
      return "operator"
    }

    if (state.afterEquals && stream.match(/\$\{?[A-Za-z_][\w]*\}?/)) {
      return "variableName.special"
    }

    const quote = stream.peek()
    if (state.afterEquals && (quote === '"' || quote === "'")) {
      stream.next()
      while (!stream.eol()) {
        const next = stream.next()
        if (next === "\\") stream.next()
        else if (next === quote) break
      }
      return "string"
    }

    if (state.afterEquals) {
      stream.eatWhile(/[^#\s]/)
      return "string"
    }

    stream.next()
    return null
  },
  languageData: {
    commentTokens: { line: "#" },
  },
})

export type MdMode = "raw" | "preview"

const MD_MODE_KEY = "fp:md-mode"

export function readMdMode(): MdMode {
  const v = store.get(MD_MODE_KEY)
  return v === "raw" ? "raw" : "preview"
}

export function writeMdMode(mode: MdMode): void {
  store.set(MD_MODE_KEY, mode)
}

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTS.has(extOf(path))
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTS.has(extOf(path))
}

export function isAudioPath(path: string): boolean {
  return AUDIO_EXTS.has(extOf(path))
}

export function isPdfPath(path: string): boolean {
  return PDF_EXTS.has(extOf(path))
}

export function AudioPreview({ src, path }: { src: string; path: string }) {
  return (
    <div className="grid h-full place-items-center overflow-auto bg-card p-4">
      <audio controls src={src} aria-label={path} className="w-full max-w-xl" />
    </div>
  )
}

export function PdfPreview({ src, path }: { src: string; path: string }) {
  const [previewUrl, setPreviewUrl] = useState(src)

  useEffect(() => {
    if (!src.startsWith("data:")) {
      setPreviewUrl(src)
      return
    }

    let cancelled = false
    let objectUrl: string | null = null

    fetch(src)
      .then((res) => res.blob())
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setPreviewUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl(src)
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src])

  return (
    <div className="h-full overflow-hidden bg-card p-2">
      <iframe
        src={previewUrl}
        title={path}
        className="h-full w-full rounded border border-border bg-background"
      />
    </div>
  )
}

export function MarkdownView({ source }: { source: string }) {
  return (
    <div
      className={cn(
        "h-full max-w-none overflow-auto px-8 py-6 text-sm leading-relaxed",
        "[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold",
        "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold",
        "[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold",
        "[&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:text-base [&_h4]:font-semibold",
        "[&_p]:my-2",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6",
        "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6",
        "[&_li]:my-0.5",
        "[&_a]:text-blue-500 [&_a]:underline-offset-2 hover:[&_a]:underline",
        "[&_code]:rounded [&_code]:bg-foreground/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]",
        "[&_pre]:my-3 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-foreground/5 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-foreground/20 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse",
        "[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
        "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
        "[&_hr]:my-4 [&_hr]:border-border",
        "[&_img]:my-3 [&_img]:max-w-full"
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </div>
  )
}

type Props = {
  cwd: string
  /** Path relative to project root. */
  path: string
  /** True when this preview is in the visible workspace tab. */
  isActive?: boolean
  /** Markdown render mode — used only when the file is markdown. */
  mdMode?: MdMode
  onDirtyChange?: (status: { dirty: boolean; saving: boolean }) => void
  /** 1-based line to scroll to + select (e.g. from a content-search hit). */
  revealLine?: number
  /** Nonce bumped per reveal request so the same line re-triggers a scroll. */
  revealSeq?: number
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; content: string }
  | { kind: "too-large"; size: number }
  | { kind: "binary" }
  | { kind: "error"; message: string }

function currentThemeType(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

function joinPath(cwd: string, rel: string): string {
  if (rel.startsWith("/")) return rel
  return `${cwd.replace(/\/+$/, "")}/${rel}`
}

function findAllMatches(text: string, query: string): [number, number][] {
  if (!query) return []
  const result: [number, number][] = []
  const needle = query.toLowerCase()
  const haystack = text.toLowerCase()
  let index = 0
  while (index <= haystack.length - needle.length) {
    const match = haystack.indexOf(needle, index)
    if (match === -1) break
    result.push([match, match + needle.length])
    index = match + Math.max(needle.length, 1)
  }
  return result
}

type CodeEditorProps = {
  value: string
  path: string
  themeType: "light" | "dark"
  onChange: (value: string) => void
  onSave: () => void
  onOpenSearch: () => void
  onViewReady: (view: EditorView | null) => void
}

function CodeEditor({
  value,
  path,
  themeType,
  onChange,
  onSave,
  onOpenSearch,
  onViewReady,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const languageCompartment = useMemo(() => new Compartment(), [])
  const envCommentCompartment = useMemo(() => new Compartment(), [])
  const themeCompartment = useMemo(() => new Compartment(), [])
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onOpenSearchRef = useRef(onOpenSearch)
  const onViewReadyRef = useRef(onViewReady)
  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
    onOpenSearchRef.current = onOpenSearch
    onViewReadyRef.current = onViewReady
  })

  const editorTheme = useMemo(
    () =>
      EditorView.theme(
        {
          "&": {
            height: "100%",
            backgroundColor: "var(--card)",
            color: "var(--foreground)",
          },
          "&.cm-editor, .cm-scroller": {
            backgroundColor: "var(--card)",
          },
          "&.cm-focused": {
            outline: "none",
          },
          ".cm-scroller": {
            fontFamily:
              '"SF Mono", "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
            fontSize: "12px",
            lineHeight: "1.625",
          },
          ".cm-content": {
            minHeight: "100%",
            padding: "16px",
            userSelect: "text",
            WebkitUserSelect: "text",
          },
          ".cm-gutters, .cm-gutter": {
            backgroundColor: "var(--card)",
            color: "var(--muted-foreground)",
          },
          ".cm-gutters": {
            borderRight: "1px solid var(--border)",
          },
          ".cm-activeLine": {
            backgroundColor:
              themeType === "dark"
                ? "color-mix(in srgb, var(--accent) 42%, transparent)"
                : "rgba(72, 118, 214, 0.12)",
          },
          ".cm-activeLineGutter, .cm-lineNumbers .cm-activeLineGutter": {
            backgroundColor:
              themeType === "dark"
                ? "color-mix(in srgb, var(--accent) 52%, transparent)"
                : "rgba(72, 118, 214, 0.22)",
            color: "var(--foreground)",
            fontWeight: "600",
          },
          "&.cm-editor .cm-selectionBackground, &.cm-editor.cm-focused > .cm-scroller .cm-selectionBackground, & ::selection":
            {
              backgroundColor:
                themeType === "dark"
                  ? "rgba(120, 150, 200, 0.45)"
                  : "rgba(70, 110, 180, 0.30)",
            },
          ".cm-cursor": {
            borderLeftColor: "var(--foreground)",
          },
          ".cm-panels": {
            display: "none",
          },
          ".cm-searchMatch": {
            backgroundColor: "rgba(250, 204, 21, 0.35)",
            outline: "1px solid rgba(250, 204, 21, 0.9)",
            borderRadius: "2px",
            color: themeType === "dark" ? "#fff" : "inherit",
          },
          ".cm-searchMatch-selected, &.cm-focused .cm-selectionBackground.cm-searchMatch, .cm-searchMatch.cm-searchMatch-selected":
            {
              backgroundColor: "rgb(250, 204, 21)",
              color: "#000",
            },
        },
        { dark: themeType === "dark" }
      ),
    [themeType]
  )

  const themeExtension = useMemo(
    () => [themeType === "dark" ? oneDark : [], editorTheme],
    [editorTheme, themeType]
  )

  const envCommentExtension = useMemo(
    () =>
      isEnvPath(path)
        ? EditorState.languageData.of(() => [
            { commentTokens: { line: "#" } },
          ])
        : [],
    [path]
  )

  const extensions = useMemo(
    () => [
      basicSetup,
      themeCompartment.of(themeExtension),
      languageCompartment.of([]),
      envCommentCompartment.of(envCommentExtension),
      Prec.highest(
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSaveRef.current()
              return true
            },
          },
          {
            key: "Mod-f",
            preventDefault: true,
            run: () => {
              onOpenSearchRef.current()
              return true
            },
          },
          indentWithTab,
          {
            key: "Shift-Tab",
            preventDefault: true,
            run: indentLess,
          },
          {
            key: "Mod-]",
            preventDefault: true,
            run: indentMore,
          },
          {
            key: "Mod-[",
            preventDefault: true,
            run: indentLess,
          },
          {
            key: "Alt-ArrowUp",
            preventDefault: true,
            run: moveLineUp,
          },
          {
            key: "Alt-ArrowDown",
            preventDefault: true,
            run: moveLineDown,
          },
          {
            key: "Shift-Alt-ArrowUp",
            preventDefault: true,
            run: copyLineUp,
          },
          {
            key: "Shift-Alt-ArrowDown",
            preventDefault: true,
            run: copyLineDown,
          },
          {
            key: "Mod-/",
            preventDefault: true,
            run: toggleLineComment,
          },
        ])
      ),
      EditorView.updateListener.of((update) => {
        if (update.docChanged)
          onChangeRef.current(update.state.doc.toString())
      }),
    ],
    // Intentionally stable: theme/language swaps via Compartment, handlers via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [envCommentCompartment, languageCompartment, themeCompartment]
  )

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: envCommentCompartment.reconfigure(envCommentExtension),
    })
  }, [envCommentCompartment, envCommentExtension])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.reconfigure(themeExtension),
    })
  }, [themeCompartment, themeExtension])

  useEffect(() => {
    const parent = containerRef.current
    if (!parent) return

    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: value, extensions }),
    })
    viewRef.current = view
    onViewReadyRef.current(view)
    view.focus()

    return () => {
      view.destroy()
      if (viewRef.current === view) viewRef.current = null
      onViewReadyRef.current(null)
    }
    // Create/recreate only when editor setup changes. Document changes are
    // synchronized by the value effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensions])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  useEffect(() => {
    let cancelled = false
    if (isEnvPath(path)) {
      viewRef.current?.dispatch({
        effects: languageCompartment.reconfigure(dotenvLanguage),
      })
      return
    }

    const description = LanguageDescription.matchFilename(languages, path)
    if (!description) {
      viewRef.current?.dispatch({
        effects: languageCompartment.reconfigure([]),
      })
      return
    }

    description
      .load()
      .then((support) => {
        if (cancelled) return
        viewRef.current?.dispatch({
          effects: languageCompartment.reconfigure(support),
        })
      })
      .catch(() => {
        if (cancelled) return
        viewRef.current?.dispatch({
          effects: languageCompartment.reconfigure([]),
        })
      })

    return () => {
      cancelled = true
    }
  }, [languageCompartment, path])

  return <div ref={containerRef} className="h-full min-h-0" />
}

export function FilePreview({
  cwd,
  path,
  isActive = true,
  mdMode = "preview",
  onDirtyChange,
  revealLine,
  revealSeq,
}: Props) {
  const abs = useMemo(() => joinPath(cwd, path), [cwd, path])
  const ext = useMemo(() => extOf(path), [path])
  const isImage = IMAGE_EXTS.has(ext)
  const isAudio = AUDIO_EXTS.has(ext)
  const isPdf = PDF_EXTS.has(ext)
  const isMarkdown = MARKDOWN_EXTS.has(ext)

  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)

  useEffect(() => {
    if (!isImage) {
      setImageUrl(null)
      setImageError(null)
      return
    }
    let cancelled = false
    setImageUrl(null)
    setImageError(null)
    window.fsApi.readImage(abs).then((res) => {
      if (cancelled) return
      if (!res.ok || !res.dataUrl) {
        setImageError(res.error ?? "Failed to load image")
      } else {
        setImageUrl(res.dataUrl)
      }
    })
    return () => {
      cancelled = true
    }
  }, [abs, isImage])

  useEffect(() => {
    if (!isAudio) {
      setAudioUrl(null)
      setAudioError(null)
      return
    }
    let cancelled = false
    setAudioUrl(null)
    setAudioError(null)
    window.fsApi.readAudio(abs).then((res) => {
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
  }, [abs, isAudio])

  useEffect(() => {
    if (!isPdf) {
      setPdfUrl(null)
      setPdfError(null)
      return
    }
    let cancelled = false
    setPdfUrl(null)
    setPdfError(null)
    window.fsApi.readPdf(abs).then((res) => {
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
  }, [abs, isPdf])

  const [state, setState] = useState<LoadState>({ kind: "loading" })
  const [savedContent, setSavedContent] = useState<string>("")
  const [draft, setDraft] = useState<string>("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [themeType, setThemeType] = useState<"light" | "dark">(() =>
    currentThemeType()
  )

  useEffect(() => {
    if (document.head.querySelector("style[data-gearshift-cm-selection]")) return
    const s = document.createElement("style")
    s.dataset.gearshiftCmSelection = "1"
    s.textContent = `
      .cm-editor .cm-selectionLayer { z-index: 1 !important; }
      .cm-editor ::selection,
      .cm-editor *::selection,
      .cm-editor ::-moz-selection,
      .cm-editor *::-moz-selection {
        background: transparent !important;
        color: inherit !important;
      }
      .cm-editor .cm-selectionLayer { opacity: 1 !important; }
      .cm-editor .cm-selectionBackground,
      .cm-editor.cm-focused .cm-selectionBackground {
        background: rgba(100, 120, 160, 0.22) !important;
      }
      [data-theme="dark"] .cm-editor .cm-selectionBackground,
      [data-theme="dark"] .cm-editor.cm-focused .cm-selectionBackground,
      .dark .cm-editor .cm-selectionBackground,
      .dark .cm-editor.cm-focused .cm-selectionBackground {
        background: rgba(140, 165, 210, 0.22) !important;
      }
    `
    document.head.appendChild(s)
  }, [])

  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState("")
  const editorViewRef = useRef<EditorView | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const lastSelectedQueryRef = useRef("")
  const rootRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const [previewMatchIdx, setPreviewMatchIdx] = useState(0)
  const [previewMatchCount, setPreviewMatchCount] = useState(0)
  // A line reveal only works in the raw code editor, so revealing a line in a
  // markdown file temporarily forces the raw view over the rendered preview.
  const [revealRawOverride, setRevealRawOverride] = useState(false)
  const pendingRevealRef = useRef<{ line: number; tries: number } | null>(null)
  // The abs path whose content is currently loaded into the editor. A reveal is
  // only applied once this matches the target file, so switching files via a
  // content hit waits for the new content before scrolling (instead of scrolling
  // inside the previous file's still-loaded text).
  const loadedAbsRef = useRef<string | null>(null)

  const isPreview = isMarkdown && mdMode === "preview" && !revealRawOverride

  const dirty = state.kind === "ready" && draft !== savedContent

  const matches = useMemo(
    () => (state.kind === "ready" ? findAllMatches(draft, query) : []),
    [state, draft, query]
  )
  const matchCount = matches.length
  const overlayCount = isPreview ? previewMatchCount : matchCount

  useEffect(() => {
    const view = editorViewRef.current
    if (!view) return
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({ search: query, caseSensitive: false })
      ),
    })
    if (!query || matches.length === 0) {
      lastSelectedQueryRef.current = query
      return
    }
    if (lastSelectedQueryRef.current === query) return
    lastSelectedQueryRef.current = query
    const cursor = view.state.selection.main.from
    const target =
      matches.find(([from]) => from >= cursor) ?? matches[0]
    const [from, to] = target
    view.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: "center" }),
    })
  }, [query, searchOpen, matches])

  const clearPreviewHighlights = useCallback(() => {
    if (typeof CSS === "undefined" || !("highlights" in CSS)) return
    const highlights = CSS.highlights as Map<string, Highlight>
    highlights.delete(PREVIEW_HIGHLIGHT_NAME)
    highlights.delete(PREVIEW_HIGHLIGHT_ACTIVE_NAME)
  }, [])

  // Ensure a top-level <style> for the preview highlight names exists once.
  useEffect(() => {
    if (typeof document === "undefined") return
    if (document.head.querySelector("style[data-gearshift-md-search]")) return
    const s = document.createElement("style")
    s.dataset.gearshiftMdSearch = "1"
    s.textContent = PREVIEW_HIGHLIGHT_STYLE
    document.head.appendChild(s)
  }, [])

  // Rebuild ranges + paint highlights when the query / active match / content
  // changes while the markdown preview is showing.
  useEffect(() => {
    if (!isPreview) return
    if (
      typeof CSS === "undefined" ||
      !("highlights" in CSS) ||
      typeof Highlight === "undefined"
    )
      return
    const highlights = CSS.highlights as Map<string, Highlight>
    // Defer a frame so react-markdown has committed the latest DOM.
    const id = requestAnimationFrame(() => {
      const ranges = query
        ? buildMatchRanges(previewRef.current, query, PREVIEW_HIGHLIGHT_STYLE)
        : []
      setPreviewMatchCount(ranges.length)
      if (ranges.length === 0) {
        highlights.delete(PREVIEW_HIGHLIGHT_NAME)
        highlights.delete(PREVIEW_HIGHLIGHT_ACTIVE_NAME)
        return
      }
      const current = previewMatchIdx >= ranges.length ? 0 : previewMatchIdx
      if (current !== previewMatchIdx) setPreviewMatchIdx(current)
      const active = ranges[current]
      const rest = ranges.filter((_, i) => i !== current)
      highlights.set(PREVIEW_HIGHLIGHT_NAME, new Highlight(...rest))
      highlights.set(PREVIEW_HIGHLIGHT_ACTIVE_NAME, new Highlight(active))
      const el =
        active.startContainer.parentElement ??
        (active.startContainer as Element)
      el?.scrollIntoView?.({ block: "center", behavior: "smooth" })
    })
    return () => cancelAnimationFrame(id)
  }, [isPreview, query, previewMatchIdx, draft])

  // Clear preview highlights when leaving preview mode or unmounting.
  useEffect(() => {
    if (!isPreview) clearPreviewHighlights()
    return () => clearPreviewHighlights()
  }, [isPreview, clearPreviewHighlights])

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    lastSelectedQueryRef.current = ""
    clearPreviewHighlights()
    setPreviewMatchIdx(0)
    const view = editorViewRef.current
    if (view) {
      view.dispatch({
        effects: setSearchQuery.of(new SearchQuery({ search: "" })),
      })
      view.focus()
    }
  }, [clearPreviewHighlights])

  const jumpTo = useCallback(
    (direction: 1 | -1) => {
      const view = editorViewRef.current
      if (!view || matches.length === 0) return
      const cursor = view.state.selection.main
      let idx: number
      if (direction === 1) {
        idx = matches.findIndex(([from]) => from > cursor.from)
        if (idx === -1) idx = 0
      } else {
        for (idx = matches.length - 1; idx >= 0; idx--) {
          if (matches[idx][0] < cursor.from) break
        }
        if (idx < 0) idx = matches.length - 1
      }
      const [from, to] = matches[idx]
      view.dispatch({
        selection: { anchor: from, head: to },
        effects: EditorView.scrollIntoView(from, { y: "center" }),
      })
    },
    [matches]
  )

  const nextMatch = useCallback(() => {
    if (isPreview) {
      setPreviewMatchIdx((i) =>
        previewMatchCount ? (i + 1) % previewMatchCount : 0
      )
      return
    }
    jumpTo(1)
  }, [isPreview, previewMatchCount, jumpTo])

  const prevMatch = useCallback(() => {
    if (isPreview) {
      setPreviewMatchIdx((i) =>
        previewMatchCount ? (i - 1 + previewMatchCount) % previewMatchCount : 0
      )
      return
    }
    jumpTo(-1)
  }, [isPreview, previewMatchCount, jumpTo])

  // Cmd/Ctrl+F opens search in preview mode (the raw editor binds it via the
  // CodeMirror keymap instead). Respond only when this preview is hovered or
  // focused so split panes don't all react to one keypress.
  useEffect(() => {
    if (!isPreview) return
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.shiftKey || e.altKey) return
      if (e.key !== "f" && e.key !== "F") return
      const root = rootRef.current
      if (!root) return
      if (!root.matches(":hover") && !root.contains(document.activeElement))
        return
      e.preventDefault()
      openSearch()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isPreview, openSearch])

  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() =>
      setThemeType(currentThemeType())
    )
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (isImage || isAudio || isPdf) return
    let cancelled = false
    loadedAbsRef.current = null
    queueMicrotask(() => {
      if (cancelled) return
      setState({ kind: "loading" })
      setSaveError(null)
    })
    window.fsApi.readFile(abs).then((res) => {
      if (cancelled) return
      if (!res.ok) {
        setState({ kind: "error", message: res.error ?? "Failed to read file" })
      } else if (res.tooLarge) {
        setState({ kind: "too-large", size: res.size ?? 0 })
      } else if (res.binary) {
        setState({ kind: "binary" })
      } else {
        const content = res.content ?? ""
        loadedAbsRef.current = abs
        setState({ kind: "ready", content })
        setSavedContent(content)
        setDraft(content)
      }
    })
    return () => {
      cancelled = true
    }
  }, [abs, isAudio, isImage, isPdf])

  const save = useCallback(async () => {
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
  }, [abs, dirty, draft, saving, state.kind])

  useEffect(() => {
    onDirtyChange?.({ dirty, saving })
    return () => onDirtyChange?.({ dirty: false, saving: false })
  }, [dirty, onDirtyChange, saving])

  // Scroll the editor to + select a pending reveal line, once the content is
  // loaded and the CodeMirror view exists. Safe to call repeatedly; it no-ops
  // until everything is ready, then consumes the pending line.
  const applyPendingReveal = useCallback(() => {
    const pending = pendingRevealRef.current
    if (!pending || state.kind !== "ready") return
    // New tabs can mount one render before the router marks them active. During
    // that hidden render CodeMirror has no useful height, so wait until the tab
    // is visible before measuring and consuming the reveal request.
    if (!isActive) return
    // Wait until the file read has finished for this tab's current path.
    if (loadedAbsRef.current !== abs) return
    const view = editorViewRef.current
    if (!view) return

    // When an existing preview tab is reused for a file that was not open yet,
    // React can render the new `draft` before CodeMirror has synchronized its
    // internal document. If we scroll during that small gap, CodeMirror uses the
    // old file's line count and lands on the wrong line. Wait one frame and try
    // again until the editor document is the newly-loaded file content.
    if (view.state.doc.toString() !== draft) {
      requestAnimationFrame(applyPendingReveal)
      return
    }

    const target = Math.max(1, Math.min(pending.line, view.state.doc.lines))
    const { from, to } = view.state.doc.line(target)
    const centerLine = (): boolean => {
      if (view.scrollDOM.clientHeight <= 0) return false
      view.requestMeasure({
        read: (v) => {
          const block = v.lineBlockAt(from)
          return block.top - v.scrollDOM.clientHeight / 2 + block.height / 2
        },
        write: (scrollTop, v) => {
          v.scrollDOM.scrollTop = Math.max(0, scrollTop)
        },
      })
      return true
    }

    view.focus()
    view.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: "center" }),
    })
    const measured = centerLine()

    // A freshly-created CodeMirror view can need a few frames before its
    // virtual line heights settle. Keep re-centering briefly; already-open files
    // usually succeed on the first pass.
    if (!measured || pending.tries < 8) {
      pendingRevealRef.current = {
        line: pending.line,
        tries: pending.tries + 1,
      }
      requestAnimationFrame(applyPendingReveal)
      return
    }
    pendingRevealRef.current = null
  }, [abs, draft, isActive, state])

  // Reset the markdown raw override when the file or md mode changes (e.g. the
  // user toggles back to preview, or a different file opens).
  useEffect(() => {
    setRevealRawOverride(false)
  }, [mdMode, path])

  // A new reveal request: stash the line and, for markdown previews, flip to the
  // raw editor so the line is visible.
  useEffect(() => {
    if (revealSeq == null || revealLine == null) return
    pendingRevealRef.current = { line: revealLine, tries: 0 }
    if (isMarkdown && mdMode === "preview") setRevealRawOverride(true)
    applyPendingReveal()
    // Only react to a new request (seq), not to incidental dependency changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealSeq])

  // Apply any pending reveal once the content loads or the raw editor mounts.
  useEffect(() => {
    applyPendingReveal()
  }, [applyPendingReveal, revealRawOverride])

  if (isImage) {
    if (imageError) {
      return (
        <div className="grid h-full place-items-center text-xs text-red-500">
          {imageError === "unsupported-type"
            ? "Unsupported file preview"
            : imageError}
        </div>
      )
    }
    if (!imageUrl) {
      return (
        <div className="grid h-full place-items-center text-xs text-muted-foreground">
          Loading…
        </div>
      )
    }
    return (
      <div className="grid h-full place-items-center overflow-auto bg-card p-4">
        <img
          src={imageUrl}
          alt={path}
          className="max-h-full max-w-full object-contain"
          style={{ imageRendering: "auto" }}
        />
      </div>
    )
  }

  if (isAudio) {
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

  if (isPdf) {
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
        Unsupported file preview
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
      ref={rootRef}
      className="relative flex h-full flex-col bg-card"
      onKeyDown={(e) => {
        if (e.key === "Escape" && searchOpen) {
          e.preventDefault()
          closeSearch()
        }
      }}
      onContextMenu={(e) => {
        const view = editorViewRef.current
        if (!view) return
        const target = e.target as HTMLElement | null
        if (!target || !view.dom.contains(target)) return
        e.preventDefault()
        const sel = view.state.selection.main
        const canCopy = !sel.empty
        ;(async () => {
          const action = await window.menuApi?.showEditContext({
            canCut: canCopy,
            canCopy,
            canPaste: true,
          })
          if (!action) return
          view.focus()
          if (action === "copy" || action === "cut") {
            const text = view.state.sliceDoc(sel.from, sel.to)
            if (text) await navigator.clipboard.writeText(text)
            if (action === "cut" && text) {
              view.dispatch({
                changes: { from: sel.from, to: sel.to, insert: "" },
              })
            }
          } else if (action === "paste") {
            try {
              const text = await navigator.clipboard.readText()
              if (text) {
                view.dispatch({
                  changes: { from: sel.from, to: sel.to, insert: text },
                  selection: { anchor: sel.from + text.length },
                })
              }
            } catch {
              // clipboard permission denied — ignore
            }
          }
        })()
      }}
    >
      {searchOpen && (
        <div className="absolute right-3 top-2 z-20 flex items-center gap-1 rounded-md border border-border bg-popover px-1 py-1 text-xs shadow-md">
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPreviewMatchIdx(0)
            }}
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
            {overlayCount === 0
              ? query
                ? "0/0"
                : ""
              : isPreview
                ? `${previewMatchIdx + 1}/${overlayCount}`
                : `${overlayCount}`}
          </span>
          <button
            type="button"
            onClick={prevMatch}
            disabled={!overlayCount}
            aria-label="Previous match"
            className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/15 hover:text-foreground disabled:opacity-30"
          >
            <ChevronUp className="size-3" />
          </button>
          <button
            type="button"
            onClick={nextMatch}
            disabled={!overlayCount}
            aria-label="Next match"
            className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/15 hover:text-foreground disabled:opacity-30"
          >
            <ChevronDown className="size-3" />
          </button>
          <button
            type="button"
            onClick={closeSearch}
            aria-label="Close search"
            className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/15 hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </div>
      )}
      {saveError && (
        <div className="flex h-6 shrink-0 items-center border-b border-border/60 px-3 text-[11px] text-red-500">
          {saveError}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {isPreview ? (
          <div ref={previewRef} className="h-full">
            <MarkdownView source={draft} />
          </div>
        ) : (
          <CodeEditor
            value={draft}
            path={path}
            themeType={themeType}
            onChange={setDraft}
            onSave={save}
            onOpenSearch={openSearch}
            onViewReady={(view) => {
              editorViewRef.current = view
              // Apply a pending reveal as soon as the view exists for this file.
              if (view) applyPendingReveal()
            }}
          />
        )}
      </div>
    </div>
  )
}
