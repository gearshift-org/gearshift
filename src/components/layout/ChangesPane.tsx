import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronsDownUp, ChevronsUpDown, Columns2, Rows3 } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useTheme } from "@/components/theme-provider"
import { DiffViewer, type DiffViewerHandle } from "./DiffViewer"

type Status = "M" | "A" | "D" | "R" | "C" | "U" | string
type GitFile = { path: string; status: Status; staged?: boolean }

const REFRESH_DEBOUNCE_MS = 350
const POLL_INTERVAL_MS = 4000
const POLL_INTERVAL_LARGE_MS = 10000
const LARGE_CHANGESET_THRESHOLD = 300

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
  isActive?: boolean
}

export function ChangesPane({ cwd, isActive = true }: Props) {
  const { resolvedTheme } = useTheme()
  const [files, setFiles] = useState<GitFile[]>([])
  const [patch, setPatch] = useState("")
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"changes" | "diff">("changes")
  const [diffCollapseState, setDiffCollapseState] = useState({
    collapsed: 0,
    total: 0,
  })
  const allCollapsed =
    diffCollapseState.total > 0 &&
    diffCollapseState.collapsed === diffCollapseState.total
  const diffViewerRef = useRef<DiffViewerHandle | null>(null)

  const openFileInDiff = useCallback((path: string) => {
    setActiveTab("diff")
    // Wait a frame so the Diff tab is mounted/visible before scrolling.
    requestAnimationFrame(() => {
      diffViewerRef.current?.scrollToFile(path)
    })
  }, [])

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
            [diff.unstagedPatch, diff.stagedPatch].filter(Boolean).join("\n")
          )
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (options?.showLoading) setLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (!cwd) {
      setFiles([])
      setPatch("")
      setError(null)
      return
    }
    if (!isActive) return

    let cancelled = false
    refreshChanges(cwd, { showLoading: true }).finally(() => {
      if (cancelled) return
    })

    return () => {
      cancelled = true
    }
  }, [cwd, isActive, refreshChanges])

  // Shared in-flight guard so the watcher and the polling backstop never
  // stack concurrent `git status` + `git diffAll` calls against each other.
  const inFlightRef = useRef(false)
  const pendingRef = useRef(false)

  const runRefresh = useCallback(async () => {
    if (!cwd) return
    if (inFlightRef.current) {
      pendingRef.current = true
      return
    }
    inFlightRef.current = true
    try {
      await refreshChanges(cwd)
    } finally {
      inFlightRef.current = false
      if (pendingRef.current) {
        pendingRef.current = false
        void runRefresh()
      }
    }
  }, [cwd, refreshChanges])

  // Watcher → debounced refresh.
  useEffect(() => {
    if (!cwd || !isActive) return
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
        void runRefresh()
      }, REFRESH_DEBOUNCE_MS)
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
  }, [cwd, isActive, runRefresh])

  // Polling backstop. Slower cadence when the changeset is large so big
  // refactors don't thrash. Mirrors v1's adaptive interval.
  const largeChangeSet = files.length > LARGE_CHANGESET_THRESHOLD
  useEffect(() => {
    if (!cwd || !isActive) return
    const id = window.setInterval(
      () => void runRefresh(),
      largeChangeSet ? POLL_INTERVAL_LARGE_MS : POLL_INTERVAL_MS
    )
    return () => window.clearInterval(id)
  }, [cwd, isActive, runRefresh, largeChangeSet])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "changes" | "diff")}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          <TabsList className="h-7">
            <TabsTrigger value="changes" className="text-xs">
              Changes
            </TabsTrigger>
            <TabsTrigger value="diff" className="text-xs">
              Diff
            </TabsTrigger>
          </TabsList>
          {activeTab === "diff" && diffCollapseState.total > 0 && (
            <div className="ml-auto flex items-center gap-1">
              {allCollapsed ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label="Expand all"
                        onClick={() => diffViewerRef.current?.expandAll()}
                        className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/15 hover:text-foreground"
                      >
                        <ChevronsUpDown className="size-3.5" />
                      </button>
                    }
                  />
                  <TooltipContent>Expand all</TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label="Collapse all"
                        onClick={() => diffViewerRef.current?.collapseAll()}
                        className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/15 hover:text-foreground"
                      >
                        <ChevronsDownUp className="size-3.5" />
                      </button>
                    }
                  />
                  <TooltipContent>Collapse all</TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
          {viewMode === "unified" ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Switch to split diff"
                    onClick={() => setViewMode("split")}
                    className={cn(
                      "grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/15 hover:text-foreground",
                      activeTab !== "diff" || diffCollapseState.total === 0
                        ? "ml-auto"
                        : "",
                    )}
                  >
                    <Columns2 className="size-3.5" />
                  </button>
                }
              />
              <TooltipContent>Split diff</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Switch to inline diff"
                    onClick={() => setViewMode("unified")}
                    className={cn(
                      "grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/15 hover:text-foreground",
                      activeTab !== "diff" || diffCollapseState.total === 0
                        ? "ml-auto"
                        : "",
                    )}
                  >
                    <Rows3 className="size-3.5" />
                  </button>
                }
              />
              <TooltipContent>Inline diff</TooltipContent>
            </Tooltip>
          )}
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
                    onClick={() => openFileInDiff(c.path)}
                    className="flex cursor-pointer items-center gap-3 px-4 py-2 text-xs hover:bg-accent/40"
                  >
                    <span
                      className={cn(
                        "w-4 text-center font-mono font-medium",
                        STATUS_STYLES[c.status] ?? "text-muted-foreground"
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
            ref={diffViewerRef}
            patch={patch}
            themeType={resolvedTheme}
            viewMode={viewMode}
            onCollapsedStateChange={setDiffCollapseState}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
