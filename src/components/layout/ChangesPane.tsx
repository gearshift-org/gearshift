import { useCallback, useEffect, useState } from "react"
import { Columns2, Rows3 } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { useTheme } from "@/components/theme-provider"
import { DiffViewer } from "./DiffViewer"

type Status = "M" | "A" | "D" | "R" | "C" | "U" | string
type GitFile = { path: string; status: Status; staged?: boolean }

const STATUS_STYLES: Record<Status, string> = {
  M: "text-amber-500",
  A: "text-emerald-500",
  D: "text-red-500",
  R: "text-sky-500",
  C: "text-sky-500",
  U: "text-red-500",
}

type Props = {
  cwd: string | null
}

export function ChangesPane({ cwd }: Props) {
  const { resolvedTheme } = useTheme()
  const [files, setFiles] = useState<GitFile[]>([])
  const [patch, setPatch] = useState("")
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshChanges = useCallback(
    async (nextCwd: string, options?: { showLoading?: boolean }) => {
      if (options?.showLoading) setLoading(true)
      setError(null)

      try {
        const [status, diff] = await Promise.all([
          window.git.status(nextCwd),
          window.git.diffAll(nextCwd),
        ])

        if (!status.ok) {
          setError(status.error ?? "Failed to load Git status")
          setFiles([])
        } else {
          setFiles([
            ...status.unstaged.map((file) => ({ ...file, staged: false })),
            ...status.staged.map((file) => ({ ...file, staged: true })),
          ])
        }

        if (!diff.ok) {
          setError(diff.error ?? "Failed to load diff")
          setPatch("")
        } else {
          setPatch(
            [diff.unstagedPatch, diff.stagedPatch].filter(Boolean).join("\n"),
          )
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (options?.showLoading) setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (!cwd) {
      setFiles([])
      setPatch("")
      setError(null)
      return
    }

    let cancelled = false
    refreshChanges(cwd, { showLoading: true }).finally(() => {
      if (cancelled) return
    })

    return () => {
      cancelled = true
    }
  }, [cwd, refreshChanges])

  useEffect(() => {
    if (!cwd) return
    let watchId: string | null = null
    let refreshTimer: number | null = null

    const clearRefreshTimer = () => {
      if (refreshTimer === null) return
      window.clearTimeout(refreshTimer)
      refreshTimer = null
    }

    const scheduleRefresh = () => {
      clearRefreshTimer()
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null
        void refreshChanges(cwd)
      }, 250)
    }

    const offChanged = window.fsApi.onChanged((event) => {
      if (event.watchId !== watchId) return
      scheduleRefresh()
    })

    window.fsApi.watchProject(cwd).then((result) => {
      if (!result.ok || !result.watchId) return
      watchId = result.watchId
    })

    return () => {
      clearRefreshTimer()
      offChanged()
      if (watchId) window.fsApi.unwatchProject(watchId)
    }
  }, [cwd, refreshChanges])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
      <Tabs defaultValue="changes" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          <TabsList className="h-7">
            <TabsTrigger value="changes" className="text-xs">
              Changes
            </TabsTrigger>
            <TabsTrigger value="diff" className="text-xs">
              Diff
            </TabsTrigger>
          </TabsList>
          <div className="ml-auto flex h-7 items-center rounded-md bg-muted p-[3px]">
            <button
              type="button"
              title="Inline diff"
              aria-label="Inline diff"
              aria-pressed={viewMode === "unified"}
              onClick={() => setViewMode("unified")}
              className={cn(
                "grid h-full w-7 place-items-center rounded-sm text-muted-foreground hover:text-foreground",
                viewMode === "unified" && "bg-background text-foreground shadow-sm",
              )}
            >
              <Rows3 className="size-3.5" />
            </button>
            <button
              type="button"
              title="Split diff"
              aria-label="Split diff"
              aria-pressed={viewMode === "split"}
              onClick={() => setViewMode("split")}
              className={cn(
                "grid h-full w-7 place-items-center rounded-sm text-muted-foreground hover:text-foreground",
                viewMode === "split" && "bg-background text-foreground shadow-sm",
              )}
            >
              <Columns2 className="size-3.5" />
            </button>
          </div>
        </div>
        <TabsContent
          value="changes"
          keepMounted
          className="min-h-0 flex-1 overflow-hidden"
        >
          <ScrollArea className="h-full border-b border-border/60">
            {!cwd && (
              <div className="px-4 py-3 text-xs text-muted-foreground">
                No project open
              </div>
            )}
            {cwd && loading && files.length === 0 && (
              <div className="px-4 py-3 text-xs text-muted-foreground">
                Loading changes...
              </div>
            )}
            {cwd && error && (
              <div className="px-4 py-3 text-xs text-red-500">{error}</div>
            )}
            {cwd && !loading && !error && files.length === 0 && (
              <div className="px-4 py-3 text-xs text-muted-foreground">
                No changes
              </div>
            )}
            {files.length > 0 && (
              <ul className="divide-y divide-border/60">
                {files.map((c) => (
                  <li
                    key={`${c.staged ? "staged" : "unstaged"}-${c.path}`}
                    className="flex items-center gap-3 px-4 py-2 text-xs hover:bg-accent/40"
                  >
                    <span
                      className={cn(
                        "w-4 text-center font-mono font-medium",
                        STATUS_STYLES[c.status] ?? "text-muted-foreground",
                      )}
                    >
                      {c.status}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {c.path}
                    </span>
                    {c.staged && (
                      <span className="text-[10px] text-muted-foreground">
                        staged
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </TabsContent>
        <TabsContent
          value="diff"
          keepMounted
          className="min-h-0 flex-1 overflow-hidden"
        >
          <DiffViewer
            patch={patch}
            themeType={resolvedTheme}
            viewMode={viewMode}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
