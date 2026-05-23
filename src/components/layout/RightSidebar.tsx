import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, Loader2, Minus, Plus, Undo2 } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import { FilesTree } from "./FilesTree"

type Status = "M" | "A" | "D" | "R" | "C" | "U" | string
type GitFile = { path: string; status: Status; staged: boolean }

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
  onOpenDiff: (path: string, staged: boolean) => void
  onOpenFile: (path: string) => void
}

export function RightSidebar({
  cwd,
  isActive = true,
  onOpenDiff,
  onOpenFile,
}: Props) {
  const [tab, setTab] = useState<"changes" | "files">("changes")
  const [files, setFiles] = useState<GitFile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [committing, setCommitting] = useState<null | "commit" | "push">(null)

  const stagedFiles = useMemo(() => files.filter((f) => f.staged), [files])
  const unstagedFiles = useMemo(() => files.filter((f) => !f.staged), [files])

  const refresh = useCallback(
    async (nextCwd: string, options?: { showLoading?: boolean }) => {
      if (options?.showLoading) setLoading(true)
      setError(null)
      try {
        const status = await window.git.status(nextCwd)
        if (!status.ok) {
          setError(status.error ?? "Failed to load Git status")
          setFiles([])
        } else {
          setFiles([
            ...status.unstaged.map((f) => ({ ...f, staged: false })),
            ...status.staged.map((f) => ({ ...f, staged: true })),
          ])
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
      setError(null)
      return
    }
    if (!isActive) return
    refresh(cwd, { showLoading: true })
  }, [cwd, isActive, refresh])

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
      await refresh(cwd)
    } finally {
      inFlightRef.current = false
      if (pendingRef.current) {
        pendingRef.current = false
        void runRefresh()
      }
    }
  }, [cwd, refresh])

  useEffect(() => {
    if (!cwd || !isActive) return
    let watchId: string | null = null
    let refreshTimer: number | null = null
    const scheduleRefresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null
        void runRefresh()
      }, REFRESH_DEBOUNCE_MS)
    }
    const offChanged = window.fsApi.onChanged((event) => {
      if (event.watchId !== watchId) return
      scheduleRefresh()
    })
    window.fsApi.watchProject(cwd).then((res) => {
      if (!res.ok || !res.watchId) return
      watchId = res.watchId
    })
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      offChanged()
      if (watchId) window.fsApi.unwatchProject(watchId)
    }
  }, [cwd, isActive, runRefresh])

  const stagePath = useCallback(
    async (path: string) => {
      if (!cwd || busy) return
      setBusy(true)
      try {
        await window.git.stage(cwd, [path])
        await runRefresh()
      } finally {
        setBusy(false)
      }
    },
    [cwd, busy, runRefresh],
  )

  const unstagePath = useCallback(
    async (path: string) => {
      if (!cwd || busy) return
      setBusy(true)
      try {
        await window.git.unstage(cwd, [path])
        await runRefresh()
      } finally {
        setBusy(false)
      }
    },
    [cwd, busy, runRefresh],
  )

  const stageAll = useCallback(async () => {
    if (!cwd || busy || unstagedFiles.length === 0) return
    setBusy(true)
    try {
      await window.git.stage(
        cwd,
        unstagedFiles.map((f) => f.path),
      )
      await runRefresh()
    } finally {
      setBusy(false)
    }
  }, [cwd, busy, unstagedFiles, runRefresh])

  const discardPath = useCallback(
    async (path: string) => {
      if (!cwd || busy) return
      if (
        !window.confirm(
          `Discard changes to "${path}"?\nThis cannot be undone.`,
        )
      ) {
        return
      }
      setBusy(true)
      try {
        const res = await window.git.discard(cwd, [path])
        if (!res.ok) setError(res.error ?? "Discard failed")
        await runRefresh()
      } finally {
        setBusy(false)
      }
    },
    [cwd, busy, runRefresh],
  )

  const discardAllUnstaged = useCallback(async () => {
    if (!cwd || busy || unstagedFiles.length === 0) return
    if (
      !window.confirm(
        `Discard changes to ${unstagedFiles.length} file${unstagedFiles.length === 1 ? "" : "s"}?\nThis cannot be undone.`,
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const res = await window.git.discard(
        cwd,
        unstagedFiles.map((f) => f.path),
      )
      if (!res.ok) setError(res.error ?? "Discard failed")
      await runRefresh()
    } finally {
      setBusy(false)
    }
  }, [cwd, busy, unstagedFiles, runRefresh])

  const unstageAll = useCallback(async () => {
    if (!cwd || busy || stagedFiles.length === 0) return
    setBusy(true)
    try {
      await window.git.unstage(
        cwd,
        stagedFiles.map((f) => f.path),
      )
      await runRefresh()
    } finally {
      setBusy(false)
    }
  }, [cwd, busy, stagedFiles, runRefresh])

  const commit = useCallback(
    async (opts?: { push?: boolean }) => {
      if (!cwd || busy) return
      const message = commitMessage.trim()
      if (!message) {
        setError("Commit message required")
        return
      }
      if (stagedFiles.length === 0) {
        setError("Nothing staged to commit")
        return
      }
      setBusy(true)
      setCommitting("commit")
      setError(null)
      try {
        const res = await window.git.commit(cwd, message)
        if (!res.ok) {
          setError(res.error ?? "Commit failed")
          return
        }
        setCommitMessage("")
        if (opts?.push) {
          setCommitting("push")
          const pushRes = await window.git.push(cwd)
          if (!pushRes.ok) {
            setError(pushRes.error ?? "Push failed")
          }
        }
        await runRefresh()
      } finally {
        setBusy(false)
        setCommitting(null)
      }
    },
    [cwd, busy, commitMessage, stagedFiles.length, runRefresh],
  )

  const canCommit = stagedFiles.length > 0 && commitMessage.trim().length > 0

  const largeChangeSet = files.length > LARGE_CHANGESET_THRESHOLD
  useEffect(() => {
    if (!cwd || !isActive) return
    const id = window.setInterval(
      () => void runRefresh(),
      largeChangeSet ? POLL_INTERVAL_LARGE_MS : POLL_INTERVAL_MS,
    )
    return () => window.clearInterval(id)
  }, [cwd, isActive, runRefresh, largeChangeSet])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "changes" | "files")}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-border px-3">
          <TabsList variant="line" className="h-full gap-4 bg-transparent p-0">
            <TabsTrigger
              value="changes"
              className="!h-full !border-0 gap-1.5 text-xs after:!bottom-[-1px] after:!h-px"
            >
              Changes
              {files.length > 0 && (
                <span className="grid h-4 min-w-4 place-items-center rounded-full bg-indigo-500 px-1 text-[10px] font-medium leading-none text-white">
                  {files.length > 99 ? "99+" : files.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="files"
              className="!h-full !border-0 text-xs after:!bottom-[-1px] after:!h-px"
            >
              Files
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent
          value="changes"
          keepMounted
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {cwd && (
            <div className="flex shrink-0 flex-col gap-2 border-b border-border/60 p-3">
              <textarea
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Message (Ctrl+Enter to commit)"
                rows={2}
                onKeyDown={(e) => {
                  if (
                    (e.metaKey || e.ctrlKey) &&
                    e.key === "Enter" &&
                    canCommit
                  ) {
                    e.preventDefault()
                    void commit()
                  }
                }}
                className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <div className="flex items-stretch">
                <Button
                  variant="default"
                  size="sm"
                  disabled={!canCommit || busy}
                  onClick={() => void commit()}
                  className="flex-1 rounded-r-none"
                >
                  {committing === "commit" ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Committing…
                    </>
                  ) : committing === "push" ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Pushing…
                    </>
                  ) : (
                    "Commit"
                  )}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="default"
                        size="sm"
                        disabled={busy}
                        aria-label="More commit options"
                        className="rounded-l-none border-l border-l-primary-foreground/20 px-2"
                      >
                        <ChevronDown className="size-3.5" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end" className="min-w-[180px]">
                    <DropdownMenuItem
                      disabled={!canCommit || busy}
                      onClick={() => void commit({ push: true })}
                    >
                      Commit &amp; Push
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={busy}
                      onClick={() => {
                        if (!cwd) return
                        setBusy(true)
                        setCommitting("push")
                        window.git.push(cwd).then((res) => {
                          if (!res.ok) setError(res.error ?? "Push failed")
                          setBusy(false)
                          setCommitting(null)
                        })
                      }}
                    >
                      Push
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          )}
          <ScrollArea className="min-h-0 flex-1">
            {!cwd && (
              <div className="px-4 py-3 text-xs text-muted-foreground">
                No project open
              </div>
            )}
            {cwd && loading && files.length === 0 && (
              <div className="px-4 py-3 text-xs text-muted-foreground">
                Loading changes…
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
            {stagedFiles.length > 0 && (
              <FileGroup
                label="Staged Changes"
                count={stagedFiles.length}
                onActionAll={unstageAll}
                actionAllLabel="Unstage all"
                actionAllIcon={<Minus className="size-3.5" />}
              >
                {stagedFiles.map((c) => (
                  <FileRow
                    key={`staged-${c.path}`}
                    file={c}
                    actionIcon={<Minus className="size-3.5" />}
                    actionLabel="Unstage"
                    onAction={() => unstagePath(c.path)}
                    onOpen={() => onOpenDiff(c.path, true)}
                    busy={busy}
                  />
                ))}
              </FileGroup>
            )}
            {unstagedFiles.length > 0 && (
              <FileGroup
                label="Changes"
                count={unstagedFiles.length}
                onActionAll={stageAll}
                actionAllLabel="Stage all"
                actionAllIcon={<Plus className="size-3.5" />}
                secondaryActionAll={discardAllUnstaged}
                secondaryActionAllLabel="Discard all"
                secondaryActionAllIcon={<Undo2 className="size-3.5" />}
              >
                {unstagedFiles.map((c) => (
                  <FileRow
                    key={`unstaged-${c.path}`}
                    file={c}
                    actionIcon={<Plus className="size-3.5" />}
                    actionLabel="Stage"
                    onAction={() => stagePath(c.path)}
                    secondaryActionIcon={<Undo2 className="size-3.5" />}
                    secondaryActionLabel="Discard changes"
                    onSecondaryAction={() => discardPath(c.path)}
                    onOpen={() => onOpenDiff(c.path, false)}
                    busy={busy}
                  />
                ))}
              </FileGroup>
            )}
          </ScrollArea>
        </TabsContent>
        <TabsContent
          value="files"
          keepMounted
          className="min-h-0 flex-1 overflow-hidden"
        >
          {cwd ? (
            <FilesTree cwd={cwd} onOpenFile={onOpenFile} />
          ) : (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              No project open
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function FileGroup({
  label,
  count,
  onActionAll,
  actionAllLabel,
  actionAllIcon,
  secondaryActionAll,
  secondaryActionAllLabel,
  secondaryActionAllIcon,
  children,
}: {
  label: string
  count: number
  onActionAll?: () => void
  actionAllLabel: string
  actionAllIcon: React.ReactNode
  secondaryActionAll?: () => void
  secondaryActionAllLabel?: string
  secondaryActionAllIcon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="group/section">
      <div className="flex h-7 items-center gap-2 border-y border-border bg-muted/40 px-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>{label}</span>
        <span className="text-muted-foreground/70">{count}</span>
        <div className="ml-auto flex items-center gap-0.5">
          {secondaryActionAll && secondaryActionAllLabel && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={secondaryActionAll}
                    aria-label={secondaryActionAllLabel}
                    className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/15 hover:text-foreground"
                  >
                    {secondaryActionAllIcon}
                  </button>
                }
              />
              <TooltipContent>{secondaryActionAllLabel}</TooltipContent>
            </Tooltip>
          )}
          {onActionAll && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={onActionAll}
                    aria-label={actionAllLabel}
                    className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/15 hover:text-foreground"
                  >
                    {actionAllIcon}
                  </button>
                }
              />
              <TooltipContent>{actionAllLabel}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <ul>{children}</ul>
    </div>
  )
}

function FileRow({
  file,
  actionIcon,
  actionLabel,
  onAction,
  secondaryActionIcon,
  secondaryActionLabel,
  onSecondaryAction,
  onOpen,
  busy,
}: {
  file: GitFile
  actionIcon: React.ReactNode
  actionLabel: string
  onAction: () => void
  secondaryActionIcon?: React.ReactNode
  secondaryActionLabel?: string
  onSecondaryAction?: () => void
  onOpen: () => void
  busy: boolean
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <li
            onClick={onOpen}
            className="group/row flex cursor-pointer items-center gap-3 px-4 py-1.5 text-xs hover:bg-accent/40"
          >
      <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
      <div className="flex items-center gap-0.5">
        {onSecondaryAction && secondaryActionLabel && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  disabled={busy}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSecondaryAction()
                  }}
                  aria-label={secondaryActionLabel}
                  className="grid size-5 place-items-center rounded-sm text-muted-foreground opacity-0 transition-colors hover:bg-foreground/15 hover:text-foreground group-hover/row:opacity-100 disabled:cursor-not-allowed"
                >
                  {secondaryActionIcon}
                </button>
              }
            />
            <TooltipContent>{secondaryActionLabel}</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                disabled={busy}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  onAction()
                }}
                aria-label={actionLabel}
                className="grid size-5 place-items-center rounded-sm text-muted-foreground opacity-0 transition-colors hover:bg-foreground/15 hover:text-foreground group-hover/row:opacity-100 disabled:cursor-not-allowed"
              >
                {actionIcon}
              </button>
            }
          />
          <TooltipContent>{actionLabel}</TooltipContent>
        </Tooltip>
      </div>
      <span
        className={cn(
          "w-4 text-center font-mono font-medium",
          STATUS_STYLES[file.status] ?? "text-muted-foreground",
        )}
      >
        {file.status}
      </span>
          </li>
        }
      />
      <ContextMenuContent className="min-w-[180px] whitespace-nowrap">
        <ContextMenuItem onClick={onOpen}>Open Diff</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={busy} onClick={onAction}>
          {actionLabel}
        </ContextMenuItem>
        {onSecondaryAction && secondaryActionLabel && (
          <ContextMenuItem disabled={busy} onClick={onSecondaryAction}>
            {secondaryActionLabel}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => {
            void navigator.clipboard.writeText(file.path)
          }}
        >
          Copy Path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
