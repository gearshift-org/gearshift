import React, { memo, useMemo } from "react"
import { FileDiff, Virtualizer } from "@pierre/diffs/react"
import {
  DEFAULT_VIRTUAL_FILE_METRICS,
  parsePatchFiles,
} from "@pierre/diffs"
import type { FileDiffMetadata, VirtualFileMetrics } from "@pierre/diffs"

type Props = {
  patch: string
  themeType: "light" | "dark"
  viewMode: "unified" | "split"
}

class FileDiffErrorBoundary extends React.Component<
  { filePath: string; children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="diff-viewer-error">
          Could not render diff for {this.props.filePath}
        </div>
      )
    }
    return this.props.children
  }
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

function metricsForFile(
  file: FileDiffMetadata,
  viewMode: "unified" | "split",
): VirtualFileMetrics {
  return {
    ...DEFAULT_VIRTUAL_FILE_METRICS,
    hunkLineCount:
      viewMode === "split" ? file.splitLineCount : file.unifiedLineCount,
  }
}

const DIFFS_UNSAFE_CSS = `
:host {
  display: block;
  background: var(--card);
  color: var(--foreground);
  font-family: "SF Mono", "SFMono-Regular", Menlo, monospace;
  font-size: 12px;
}
* { box-sizing: border-box; }
`

function DiffViewerComponent({ patch, themeType, viewMode }: Props) {
  const files = useMemo(() => {
    if (!patch.trim()) return []
    try {
      return parsePatchFiles(patch).flatMap((parsed) => parsed.files)
    } catch {
      return []
    }
  }, [patch])

  const diffOptions = useMemo(
    () => ({
      diffStyle: viewMode,
      overflow: "scroll" as const,
      stickyHeader: true,
      theme: { dark: "github-dark", light: "github-light" },
      themeType,
      hunkSeparators: "line-info" as const,
      lineDiffType: "word-alt" as const,
      tokenizeMaxLineLength: 1000,
      unsafeCSS: DIFFS_UNSAFE_CSS,
    }),
    [themeType, viewMode],
  )

  if (!patch.trim()) {
    return <div className="diff-viewer-empty">No diff to show</div>
  }

  if (files.length === 0) {
    return <div className="diff-viewer-empty">No renderable diff</div>
  }

  return (
    <Virtualizer
      className="diff-viewer-scroll"
      contentClassName="diff-viewer-content"
    >
        {files.map((file, index) => {
          const { additions, deletions } = countHunkChanges(file)
          return (
            <div key={`${file.name}-${index}`} className="diff-viewer-file">
              <FileDiffErrorBoundary filePath={file.name}>
                <FileDiff
                  fileDiff={file}
                  options={diffOptions}
                  metrics={metricsForFile(file, viewMode)}
                  className="diff-viewer-file-inner"
                  renderHeaderMetadata={() => (
                    <span className="diff-viewer-plugin-stats">
                      {additions > 0 && (
                        <span className="diff-viewer-add">+{additions}</span>
                      )}
                      {deletions > 0 && (
                        <span className="diff-viewer-del">-{deletions}</span>
                      )}
                    </span>
                  )}
                />
              </FileDiffErrorBoundary>
            </div>
          )
        })}
    </Virtualizer>
  )
}

export const DiffViewer = memo(DiffViewerComponent)
