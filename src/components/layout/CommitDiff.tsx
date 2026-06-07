import { useEffect, useMemo, useState } from "react"
import { WorkerPoolContextProvider } from "@pierre/diffs/react"
import { useTheme } from "@/components/theme-provider"
import { DiffViewer } from "./DiffViewer"
import {
  diffsHighlighterOptions,
  diffsWorkerPoolOptions,
} from "./diffWorkerConfig"
import type { CommitInfo } from "@/lib/gitStatusQuery"

type Props = {
  cwd: string
  hash: string
  viewMode?: "unified" | "split"
}

export function CommitDiff({ cwd, hash, viewMode = "unified" }: Props) {
  const { resolvedTheme } = useTheme()
  const [patch, setPatch] = useState("")
  const [commit, setCommit] = useState<CommitInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    window.git
      .show(cwd, hash)
      .then((res) => {
        if (cancelled) return
        if (!res.ok) {
          setError(res.error ?? "Failed to load commit")
          setPatch("")
          setCommit(null)
        } else {
          setPatch(res.patch || "")
          setCommit(res.commit)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [cwd, hash])

  const body = useMemo(() => {
    if (loading && !patch) {
      return (
        <div className="grid h-full place-items-center text-xs text-muted-foreground">
          Loading commit…
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
          No changes in this commit
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {commit && (
        <div className="shrink-0 border-b border-border bg-card/80 px-4 py-2.5">
          <div className="truncate text-xs font-medium text-foreground">
            {commit.subject}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="shrink-0 font-mono">{commit.shortHash}</span>
            <span className="shrink-0">·</span>
            <span className="truncate">{commit.authorName}</span>
            <span className="shrink-0">·</span>
            <span className="shrink-0">{commit.relativeDate}</span>
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">{body}</div>
    </div>
  )
}
