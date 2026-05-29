import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { FileIcon } from "@/components/icons/FileIcon"
import { setPathDragData } from "@/lib/pathDrag"
import {
  CodeView,
  type CodeViewHandle,
  type CodeViewItem,
} from "@pierre/diffs/react"
import { parsePatchFiles } from "@pierre/diffs"
import type { FileDiffMetadata } from "@pierre/diffs"

type Props = {
  cwd: string
  patch: string
  themeType: "light" | "dark"
  viewMode: "unified" | "split"
  onCollapsedStateChange?: (state: {
    collapsed: number
    total: number
  }) => void
}

export type DiffViewerHandle = {
  scrollToFile: (path: string) => void
  collapseAll: () => void
  expandAll: () => void
}

function countHunkChanges(file: FileDiffMetadata) {
  let additions = 0
  let deletions = 0
  for (const hunk of file.hunks) {
    additions += hunk.additionLines
    deletions += hunk.deletionLines
  }
  return { additions, deletions }
}

function absolutePath(cwd: string, path: string) {
  if (path.startsWith("/")) return path
  return `${cwd.replace(/\/+$/, "")}/${path}`
}

const DIFFS_UNSAFE_CSS = `
:host {
  display: block;
  margin: 0;
  padding: 0;
  background: var(--card);
  color: var(--foreground);
  font-family: "SF Mono", "SFMono-Regular", Menlo, monospace;
  font-size: 12px;

  /* Anchor the diff's base background/foreground to the app palette so every
     theme variant (Default, Cool, Atom One, …) matches — the library otherwise
     derives these from the Shiki theme's own bg/fg. All context/addition/
     deletion/gutter backgrounds are mixed from --diffs-bg, so this one anchor
     re-tints the whole diff. !important wins over the library's :host rule. */
  --diffs-bg: var(--card) !important;
  --diffs-fg: var(--card-foreground) !important;
}
* { box-sizing: border-box; }
[data-diffs-header] {
  margin: 0 !important;
  padding: 0 !important;
  min-height: 0 !important;
  border: 0 !important;
}
[data-code] {
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}
/* Allow text selection / copy inside the diff. The library disables
   user-select on the code area by default which makes Cmd+C a no-op. We
   override it globally inside the shadow root rather than guess at the
   exact selector the library uses. */
*, *::before, *::after {
  user-select: text !important;
  -webkit-user-select: text !important;
}
`

const DiffViewerComponent = forwardRef<DiffViewerHandle, Props>(
  function DiffViewerComponent(
    { cwd, patch, themeType, viewMode, onCollapsedStateChange },
    ref,
  ) {
    const files = useMemo(() => {
      if (!patch.trim()) return []
      try {
        return parsePatchFiles(patch).flatMap((parsed) => parsed.files)
      } catch {
        return []
      }
    }, [patch])

    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
    const toggleCollapsed = (id: string) =>
      setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))

    useEffect(() => {
      if (!onCollapsedStateChange) return
      let count = 0
      files.forEach((file, index) => {
        if (collapsed[`${file.name}-${index}`]) count++
      })
      onCollapsedStateChange({ collapsed: count, total: files.length })
    }, [collapsed, files, onCollapsedStateChange])

    const handleRef = useRef<CodeViewHandle<unknown> | null>(null)

    // Map file path → first matching item id so external callers can
    // jump to "src/foo.ts" without knowing the internal index suffix.
    const pathToId = useMemo(() => {
      const m = new Map<string, string>()
      files.forEach((file, index) => {
        const id = `${file.name}-${index}`
        if (!m.has(file.name)) m.set(file.name, id)
      })
      return m
    }, [files])

    useImperativeHandle(
      ref,
      () => ({
        scrollToFile(path: string) {
          const id = pathToId.get(path)
          if (!id) return
          setCollapsed((prev) =>
            prev[id] ? { ...prev, [id]: false } : prev,
          )
          handleRef.current?.scrollTo({ type: "item", id, align: "start" })
        },
        collapseAll() {
          const next: Record<string, boolean> = {}
          files.forEach((file, index) => {
            next[`${file.name}-${index}`] = true
          })
          setCollapsed(next)
        },
        expandAll() {
          setCollapsed({})
        },
      }),
      [files, pathToId],
    )

    const patchVersion = useMemo(() => {
      let hash = 0
      for (let i = 0; i < patch.length; i++) {
        hash = (hash * 31 + patch.charCodeAt(i)) | 0
      }
      return hash
    }, [patch])

    const items = useMemo<CodeViewItem[]>(
      () =>
        files.map((file, index) => {
          const id = `${file.name}-${index}`
          const isCollapsed = !!collapsed[id]
          return {
            id,
            type: "diff",
            fileDiff: file,
            collapsed: isCollapsed,
            version: patchVersion + (isCollapsed ? 1 : 0),
          }
        }),
      [files, collapsed, patchVersion],
    )

    const options = useMemo(
      () => ({
        diffStyle: viewMode,
        overflow: "scroll" as const,
        stickyHeaders: true,
        // Match the code editor's syntax palette (Atom One) so the diff
        // preview doesn't read as GitHub-themed against the rest of the app.
        theme: { dark: "one-dark-pro", light: "one-light" },
        themeType,
        hunkSeparators: "line-info" as const,
        lineDiffType: "word-alt" as const,
        tokenizeMaxLineLength: 1000,
        unsafeCSS: DIFFS_UNSAFE_CSS,
        layout: { paddingTop: 0, paddingBottom: 0, gap: 0 },
        itemMetrics: { diffHeaderHeight: 32, spacing: 0 },
      }),
      [themeType, viewMode],
    )

    if (!patch.trim()) {
      return <div className="diff-viewer-empty">No diff to show</div>
    }

    if (files.length === 0) {
      return <div className="diff-viewer-empty">No renderable diff</div>
    }

    // Manual copy handler — if a selection exists anywhere on the page
    // (including inside the diff viewer's shadow root), serialize it to the
    // clipboard. This makes Cmd+C work even when the library suppresses
    // default copy behavior on its code area.
    const handleCopy = (e: React.ClipboardEvent) => {
      try {
        const sel = window.getSelection?.()
        const text = sel ? sel.toString() : ""
        if (!text) return
        e.preventDefault()
        e.clipboardData?.setData("text/plain", text)
      } catch {
        // ignore
      }
    }

    return (
      <div
        onCopy={handleCopy}
        style={{ height: "100%" }}
      >
      <CodeView
        ref={handleRef}
        className="diff-viewer-scroll"
        items={items}
        options={options}
        renderCustomHeader={(item) => {
          if (item.type !== "diff") return null
          const { additions, deletions } = countHunkChanges(item.fileDiff)
          const isCollapsed = !!item.collapsed
          return (
            <button
              type="button"
              draggable
              onDragStart={(e) =>
                setPathDragData(e.dataTransfer, [
                  absolutePath(cwd, item.fileDiff.name),
                ])
              }
              onClick={() => toggleCollapsed(item.id)}
              aria-expanded={!isCollapsed}
              className="diff-viewer-file-header"
            >
              {isCollapsed ? (
                <ChevronRight className="diff-viewer-chevron" />
              ) : (
                <ChevronDown className="diff-viewer-chevron" />
              )}
              <FileIcon
                name={item.fileDiff.name.split("/").pop() ?? item.fileDiff.name}
                className="size-4 shrink-0"
              />
              <span className="diff-viewer-file-name">{item.fileDiff.name}</span>
              <span className="diff-viewer-plugin-stats">
                {additions > 0 && (
                  <span className="diff-viewer-add">+{additions}</span>
                )}
                {deletions > 0 && (
                  <span className="diff-viewer-del">-{deletions}</span>
                )}
              </span>
            </button>
          )
        }}
      />
      </div>
    )
  },
)

export const DiffViewer = memo(DiffViewerComponent)
