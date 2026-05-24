import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  GitBranch,
  GitPullRequest,
  Loader2,
  Minus,
  Plus,
  PlusCircle,
  RefreshCw,
  Undo2,
} from "lucide-react"
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
import { FileIcon } from "@/components/icons/FileIcon"
import { FilesTree } from "./FilesTree"
import {
  EMPTY_GIT_FILES,
  fetchGitQueryData,
  gitQueryKey,
  moveCachedGitFiles,
  type GitFile,
  type GitQueryData,
  type GitStatus,
  type PullRequestInfo,
} from "@/lib/gitStatusQuery"

const REFRESH_DEBOUNCE_MS = 350
const POLL_INTERVAL_MS = 4000
const POLL_INTERVAL_LARGE_MS = 10000
const LARGE_CHANGESET_THRESHOLD = 300

const STATUS_STYLES: Record<GitStatus, string> = {
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
  activeTab?: "changes" | "files"
  onActiveTabChange?: (tab: "changes" | "files") => void
  activeFilePath?: string
  onOpenDiff: (path: string, staged: boolean) => void
  onOpenFile: (path: string) => void
  topRightActions?: React.ReactNode
}

export function RightSidebar({
  cwd,
  isActive = true,
  activeTab,
  onActiveTabChange,
  activeFilePath,
  onOpenDiff,
  onOpenFile,
  topRightActions,
}: Props) {
  const [internalTab, setInternalTab] = useState<"changes" | "files">("changes")
  const tab = activeTab ?? internalTab
  const [actionError, setActionError] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [committing, setCommitting] = useState<
    null | "commit" | "push" | "sync"
  >(null)
  const [switchingBranch, setSwitchingBranch] = useState(false)
  const [pullRequestBusy, setPullRequestBusy] = useState<
    null | "create" | "open"
  >(null)

  const queryClient = useQueryClient()
  const currentGitQueryKey = useMemo(() => gitQueryKey(cwd), [cwd])
  // Single combined query so switching projects shows the previously cached
  // git state instantly (stale-while-revalidate). Key on cwd; gcTime keeps
  // entries warm for 5 minutes after the last subscriber detaches.
  const gitQuery = useQuery({
    queryKey: currentGitQueryKey,
    enabled: !!cwd,
    queryFn: () => fetchGitQueryData(cwd!),
  })

  // `hasData` distinguishes "we've never seen data for this cwd" from "data
  // loaded and empty". Used to suppress the counter badge / commit-button
  // toggle until we actually know the answer — otherwise switching to a
  // not-yet-loaded project flashes enabled→disabled.
  const hasData = gitQuery.data !== undefined
  const files = gitQuery.data?.files ?? EMPTY_GIT_FILES
  const ahead = gitQuery.data?.ahead ?? 0
  const behind = gitQuery.data?.behind ?? 0
  const hasUpstream = gitQuery.data?.hasUpstream ?? false
  const currentBranch = gitQuery.data?.currentBranch ?? null
  const branches = gitQuery.data?.branches ?? []
  const ghAvailable = gitQuery.data?.ghAvailable ?? false
  const pullRequest = gitQuery.data?.pullRequest ?? null
  const canCreatePullRequest = gitQuery.data?.canCreatePullRequest ?? false
  const queryError = gitQuery.error
    ? gitQuery.error instanceof Error
      ? gitQuery.error.message
      : String(gitQuery.error)
    : null
  const error = actionError ?? queryError
  const loading = gitQuery.isLoading

  const stagedFiles = useMemo(() => files.filter((f) => f.staged), [files])
  const unstagedFiles = useMemo(() => files.filter((f) => !f.staged), [files])

  const updateCachedFiles = useCallback(
    (paths: string[], staged: boolean) => {
      queryClient.setQueryData<GitQueryData>(currentGitQueryKey, (data) =>
        moveCachedGitFiles(data, paths, staged)
      )
    },
    [currentGitQueryKey, queryClient]
  )

  // Coalesce overlapping refreshes — `git status` can take a beat on big
  // repos and we don't want a stampede when fs events fire in bursts.
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
      await queryClient.refetchQueries({ queryKey: currentGitQueryKey })
    } finally {
      inFlightRef.current = false
      if (pendingRef.current) {
        pendingRef.current = false
        void runRefresh()
      }
    }
  }, [cwd, currentGitQueryKey, queryClient])

  // Watch the current project and keep the query cache in sync with external
  // git/file operations.
  useEffect(() => {
    if (!cwd) return
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
  }, [cwd, runRefresh])

  const stagePath = useCallback(
    async (path: string) => {
      if (!cwd || busy) return
      setBusy(true)
      setActionError(null)
      try {
        const res = await window.git.stage(cwd, [path])
        if (!res.ok) {
          setActionError(res.error ?? "Stage failed")
          return
        }
        updateCachedFiles([path], true)
        void runRefresh()
      } finally {
        setBusy(false)
      }
    },
    [cwd, busy, runRefresh, updateCachedFiles]
  )

  const unstagePath = useCallback(
    async (path: string) => {
      if (!cwd || busy) return
      setBusy(true)
      setActionError(null)
      try {
        const res = await window.git.unstage(cwd, [path])
        if (!res.ok) {
          setActionError(res.error ?? "Unstage failed")
          return
        }
        updateCachedFiles([path], false)
        void runRefresh()
      } finally {
        setBusy(false)
      }
    },
    [cwd, busy, runRefresh, updateCachedFiles]
  )

  const stageAll = useCallback(async () => {
    if (!cwd || busy || unstagedFiles.length === 0) return
    setBusy(true)
    setActionError(null)
    try {
      const paths = unstagedFiles.map((f) => f.path)
      const res = await window.git.stage(cwd, paths)
      if (!res.ok) {
        setActionError(res.error ?? "Stage failed")
        return
      }
      updateCachedFiles(paths, true)
      void runRefresh()
    } finally {
      setBusy(false)
    }
  }, [cwd, busy, unstagedFiles, runRefresh, updateCachedFiles])

  const discardPath = useCallback(
    async (path: string) => {
      if (!cwd || busy) return
      if (
        !window.confirm(`Discard changes to "${path}"?\nThis cannot be undone.`)
      ) {
        return
      }
      setBusy(true)
      try {
        const res = await window.git.discard(cwd, [path])
        if (!res.ok) setActionError(res.error ?? "Discard failed")
        await runRefresh()
      } finally {
        setBusy(false)
      }
    },
    [cwd, busy, runRefresh]
  )

  const discardAllUnstaged = useCallback(async () => {
    if (!cwd || busy || unstagedFiles.length === 0) return
    if (
      !window.confirm(
        `Discard changes to ${unstagedFiles.length} file${unstagedFiles.length === 1 ? "" : "s"}?\nThis cannot be undone.`
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const res = await window.git.discard(
        cwd,
        unstagedFiles.map((f) => f.path)
      )
      if (!res.ok) setActionError(res.error ?? "Discard failed")
      await runRefresh()
    } finally {
      setBusy(false)
    }
  }, [cwd, busy, unstagedFiles, runRefresh])

  const unstageAll = useCallback(async () => {
    if (!cwd || busy || stagedFiles.length === 0) return
    setBusy(true)
    setActionError(null)
    try {
      const paths = stagedFiles.map((f) => f.path)
      const res = await window.git.unstage(cwd, paths)
      if (!res.ok) {
        setActionError(res.error ?? "Unstage failed")
        return
      }
      updateCachedFiles(paths, false)
      void runRefresh()
    } finally {
      setBusy(false)
    }
  }, [cwd, busy, stagedFiles, runRefresh, updateCachedFiles])

  const commit = useCallback(
    async (opts?: { push?: boolean }) => {
      if (!cwd || busy) return
      const message = commitMessage.trim()
      if (!message) {
        setActionError("Commit message required")
        return
      }
      if (stagedFiles.length === 0) {
        setActionError("Nothing staged to commit")
        return
      }
      setBusy(true)
      setCommitting("commit")
      setActionError(null)
      try {
        const res = await window.git.commit(cwd, message)
        if (!res.ok) {
          setActionError(res.error ?? "Commit failed")
          return
        }
        setCommitMessage("")
        if (opts?.push) {
          setCommitting("push")
          const pushRes = await window.git.push(cwd)
          if (!pushRes.ok) {
            setActionError(pushRes.error ?? "Push failed")
          }
        }
        await runRefresh()
      } finally {
        setBusy(false)
        setCommitting(null)
      }
    },
    [cwd, busy, commitMessage, stagedFiles.length, runRefresh]
  )

  // Gate on `hasData` so the button doesn't briefly enable on first project
  // open before the initial fetch resolves.
  const canCommit =
    hasData && stagedFiles.length > 0 && commitMessage.trim().length > 0

  const switchBranch = useCallback(
    async (branch: string) => {
      if (!cwd || !branch || branch === currentBranch) return
      setSwitchingBranch(true)
      setActionError(null)
      try {
        const res = await window.git.checkout(cwd, branch)
        if (!res.ok) {
          setActionError(res.error ?? "Checkout failed")
          return
        }
        await runRefresh()
      } finally {
        setSwitchingBranch(false)
      }
    },
    [cwd, currentBranch, runRefresh]
  )

  const createBranch = useCallback(
    async (branch: string) => {
      const name = branch.trim()
      if (!cwd || !name) return
      setSwitchingBranch(true)
      setActionError(null)
      try {
        const res = await window.git.createBranch(cwd, name)
        if (!res.ok) {
          setActionError(res.error ?? "Create branch failed")
          return
        }
        await runRefresh()
      } finally {
        setSwitchingBranch(false)
      }
    },
    [cwd, runRefresh]
  )

  const openPullRequest = useCallback(async () => {
    if (!cwd || !pullRequest || pullRequestBusy) return
    setPullRequestBusy("open")
    setActionError(null)
    try {
      const res = await window.git.openPullRequest(cwd, pullRequest.number)
      if (!res.ok) setActionError(res.error ?? "Open pull request failed")
    } finally {
      setPullRequestBusy(null)
    }
  }, [cwd, pullRequest, pullRequestBusy])

  const createPullRequest = useCallback(async () => {
    if (!cwd || !currentBranch || !canCreatePullRequest || pullRequestBusy) {
      return
    }
    setPullRequestBusy("create")
    setActionError(null)
    try {
      const res = await window.git.createPullRequest(cwd, currentBranch)
      if (!res.ok) {
        setActionError(res.error ?? "Create pull request failed")
        return
      }
      void runRefresh()
    } finally {
      setPullRequestBusy(null)
    }
  }, [
    cwd,
    currentBranch,
    canCreatePullRequest,
    pullRequestBusy,
    runRefresh,
  ])

  const sync = useCallback(async () => {
    if (!cwd || busy) return
    setBusy(true)
    setCommitting("sync")
    setActionError(null)
    try {
      if (behind > 0) {
        const pullRes = await window.git.pull(cwd)
        if (!pullRes.ok) {
          setActionError(pullRes.error ?? "Pull failed")
          return
        }
      }
      if (ahead > 0) {
        const pushRes = await window.git.push(cwd)
        if (!pushRes.ok) {
          setActionError(pushRes.error ?? "Push failed")
          return
        }
      }
      await runRefresh()
    } finally {
      setBusy(false)
      setCommitting(null)
    }
  }, [cwd, busy, ahead, behind, runRefresh])

  // Show the Sync button only when nothing is staged and the branch is out of
  // sync with its upstream.
  const showSync =
    stagedFiles.length === 0 && hasUpstream && (ahead > 0 || behind > 0)

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
        value={tab}
        onValueChange={(v) => {
          const next = v as "changes" | "files"
          setInternalTab(next)
          onActiveTabChange?.(next)
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-border px-3 [-webkit-app-region:drag]">
          <TabsList variant="line" className="h-full gap-1 bg-transparent p-0 [-webkit-app-region:no-drag]">
            <TabsTrigger
              value="changes"
              className="gap-1.5 !h-6 !border-0 rounded-sm px-2 text-xs after:!opacity-0 hover:!bg-foreground/10 dark:hover:!bg-foreground/15 data-active:!bg-foreground/10 dark:data-active:!bg-foreground/15 data-active:!text-foreground"
            >
              Changes
              {hasData && files.length > 0 && (
                <span className="grid h-4 min-w-4 place-items-center rounded-full bg-emerald-500/20 px-1 text-[10px] leading-none font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  {files.length > 99 ? "99+" : files.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="files"
              className="!h-6 !border-0 rounded-sm px-2 text-xs after:!opacity-0 hover:!bg-foreground/10 dark:hover:!bg-foreground/15 data-active:!bg-foreground/10 dark:data-active:!bg-foreground/15 data-active:!text-foreground"
            >
              Files
            </TabsTrigger>
          </TabsList>
          {topRightActions && (
            <div className="ml-auto flex items-center [-webkit-app-region:no-drag]">
              {topRightActions}
            </div>
          )}
        </div>
        <TabsContent
          value="changes"
          keepMounted
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {cwd && (
            <div className="flex shrink-0 flex-col gap-2 border-b border-border/60 p-3">
              <div className="flex items-center gap-1.5">
                <div className="min-w-0 flex-1">
                  <BranchPicker
                    current={currentBranch}
                    branches={branches}
                    busy={switchingBranch || busy}
                    onSwitch={switchBranch}
                    onCreate={createBranch}
                  />
                </div>
                {ghAvailable && (pullRequest || canCreatePullRequest) && (
                  <PullRequestAction
                    pullRequest={pullRequest}
                    canCreate={canCreatePullRequest}
                    busy={pullRequestBusy}
                    onOpen={openPullRequest}
                    onCreate={createPullRequest}
                  />
                )}
              </div>
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
              {showSync ? (
                <Button
                  variant="default"
                  size="sm"
                  disabled={busy}
                  onClick={() => void sync()}
                  className="w-full"
                >
                  {committing === "sync" ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Syncing…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="size-3.5" />
                      <span>Sync Changes</span>
                      {ahead > 0 && (
                        <span className="inline-flex items-center gap-0.5">
                          {ahead}
                          <ArrowUp className="size-3" />
                        </span>
                      )}
                      {behind > 0 && (
                        <span className="inline-flex items-center gap-0.5">
                          {behind}
                          <ArrowDown className="size-3" />
                        </span>
                      )}
                    </>
                  )}
                </Button>
              ) : (
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
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
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
                    onOpenFile={() => onOpenFile(c.path)}
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
                    onOpenFile={() => onOpenFile(c.path)}
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
            <FilesTree
              cwd={cwd}
              activePath={activeFilePath}
              onOpenFile={onOpenFile}
            />
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

function PullRequestAction({
  pullRequest,
  canCreate,
  busy,
  onOpen,
  onCreate,
}: {
  pullRequest: PullRequestInfo | null
  canCreate: boolean
  busy: null | "create" | "open"
  onOpen: () => void
  onCreate: () => void
}) {
  const isOpening = busy === "open"
  const isCreating = busy === "create"
  const label = pullRequest
    ? `View Pull Request #${pullRequest.number}`
    : "Create pull request"

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!!busy || (!pullRequest && !canCreate)}
            aria-label={label}
            onClick={pullRequest ? onOpen : onCreate}
            className={cn(
              "h-8 shrink-0 gap-1.5 px-2 text-xs",
              pullRequest &&
                "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
            )}
          >
            {isOpening || isCreating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <GitPullRequest className="size-3.5" />
            )}
            <span>{pullRequest ? `#${pullRequest.number}` : "Create PR"}</span>
          </Button>
        }
      />
      <TooltipContent side="bottom">
        {pullRequest ? "View Pull Request" : "Open GitHub to create a pull request"}
      </TooltipContent>
    </Tooltip>
  )
}

function BranchPicker({
  current,
  branches,
  busy,
  onSwitch,
  onCreate,
}: {
  current: string | null
  branches: string[]
  busy: boolean
  onSwitch: (branch: string) => void
  onCreate: (branch: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? branches.filter((b) => b.toLowerCase().includes(q))
      : branches
    return list.slice(0, 200)
  }, [branches, query])

  const trimmedQuery = query.trim()
  // Git branch names can't contain whitespace or several special chars; this
  // is a coarse client-side check — the server validates strictly.
  const isValidNewBranchName =
    trimmedQuery.length > 0 && !/[\s~^:?*[\\]/.test(trimmedQuery)
  const canCreate = isValidNewBranchName && !branches.includes(trimmedQuery)

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setQuery("")
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={busy || branches.length === 0}
            aria-label="Switch branch"
            className="h-8 w-full justify-between gap-2 px-2 text-xs font-normal"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{current ?? "(detached HEAD)"}</span>
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-(--anchor-width) p-0">
        <div className="border-b border-border/60 p-1">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                if (filtered[0]) {
                  onSwitch(filtered[0])
                  setOpen(false)
                } else if (canCreate) {
                  onCreate(trimmedQuery)
                  setOpen(false)
                }
              }
              // Prevent base-ui's menu typeahead from stealing characters.
              e.stopPropagation()
            }}
            placeholder="Filter or create branch…"
            className="w-full rounded-sm bg-transparent px-1.5 py-1 text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 && !canCreate && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {trimmedQuery ? "Invalid branch name" : "No branches"}
            </div>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={() => {
                onCreate(trimmedQuery)
                setOpen(false)
              }}
              className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
            >
              <PlusCircle className="size-3.5 shrink-0" />
              <span className="truncate">
                Create branch{" "}
                <span className="font-medium">{trimmedQuery}</span>
              </span>
            </button>
          )}
          {filtered.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => {
                onSwitch(b)
                setOpen(false)
              }}
              className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
            >
              <Check
                className={cn(
                  "size-3.5 shrink-0",
                  b === current ? "opacity-100" : "opacity-0"
                )}
              />
              <span className="truncate">{b}</span>
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
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
      <div className="flex h-7 items-center gap-2 border-y border-border bg-muted/40 px-3 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
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
  onOpenFile,
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
  onOpenFile: () => void
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
            <FileIcon
              name={file.path.split("/").pop() ?? file.path}
              className="size-4 shrink-0"
            />
            <span className="min-w-0 flex-1 truncate font-mono">
              {file.path}
            </span>
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
                        className="grid size-5 place-items-center rounded-sm text-muted-foreground opacity-0 transition-colors group-hover/row:opacity-100 hover:bg-foreground/15 hover:text-foreground disabled:cursor-not-allowed"
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
                      className="grid size-5 place-items-center rounded-sm text-muted-foreground opacity-0 transition-colors group-hover/row:opacity-100 hover:bg-foreground/15 hover:text-foreground disabled:cursor-not-allowed"
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
                STATUS_STYLES[file.status] ?? "text-muted-foreground"
              )}
            >
              {file.status}
            </span>
          </li>
        }
      />
      <ContextMenuContent className="min-w-[180px] whitespace-nowrap">
        <ContextMenuItem onClick={onOpenFile}>Open File</ContextMenuItem>
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
