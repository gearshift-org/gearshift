import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  CloudUpload,
  ExternalLink,
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
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { VSCodeIcon } from "@/components/icons/VSCodeIcon"
import { ChangeCountBadge } from "./ChangeCountBadge"
import { FilesTree } from "./FilesTree"
import { ProjectChatHistoryPanel } from "./ProjectChatHistory"
import { setPathDragData } from "@/lib/pathDrag"
import {
  EMPTY_GIT_FILES,
  applyOptimisticGitFileMoves,
  applyOptimisticGitFileRemovals,
  fetchGitQueryData,
  gitQueryKey,
  moveCachedGitFiles,
  removeCachedGitFiles,
  type GitFile,
  type GitQueryData,
  type OptimisticGitFileMove,
  type OptimisticGitFileRemoval,
  type GitStatus,
  type PullRequestInfo,
} from "@/lib/gitStatusQuery"

const REFRESH_DEBOUNCE_MS = 350
const POLL_INTERVAL_MS = 4000
const POLL_INTERVAL_LARGE_MS = 10000
const LARGE_CHANGESET_THRESHOLD = 300
// Optimistic overlays are confirm-cleared once a refetch reflects the action,
// so these TTLs are only a safety net for the rare case where reality never
// catches up (e.g. external git tampering). Keep them generous.
const OPTIMISTIC_GIT_MOVE_TTL_MS = 15000
const OPTIMISTIC_GIT_REMOVE_TTL_MS = 15000
const OPTIMISTIC_BRANCH_TTL_MS = 15000
const EMPTY_BRANCHES: string[] = []

const STATUS_STYLES: Record<GitStatus, string> = {
  M: "text-amber-500",
  A: "text-emerald-500",
  D: "text-red-500",
  R: "text-sky-500",
  C: "text-sky-500",
  U: "text-red-500",
}

function absolutePath(cwd: string, path: string) {
  if (path.startsWith("/")) return path
  return `${cwd.replace(/\/+$/, "")}/${path}`
}

type Props = {
  cwd: string | null
  projectId?: string | null
  isActive?: boolean
  activeTab?: "changes" | "files" | "history"
  onActiveTabChange?: (tab: "changes" | "files" | "history") => void
  activeFilePath?: string
  onOpenDiff: (path: string, staged: boolean) => void
  onOpenFile: (path: string) => void
  onCommitWithAi?: () => void
  canCommitWithAi?: boolean
  topRightActions?: React.ReactNode
}

export function RightSidebar({
  cwd,
  projectId,
  isActive = true,
  activeTab,
  onActiveTabChange,
  activeFilePath,
  onOpenDiff,
  onOpenFile,
  onCommitWithAi,
  canCommitWithAi = false,
  topRightActions,
}: Props) {
  const [internalTab, setInternalTab] = useState<
    "changes" | "files" | "history"
  >("changes")
  const tab = activeTab ?? internalTab
  const [actionErrorsByCwd, setActionErrorsByCwd] = useState<
    Record<string, string>
  >({})
  const [commitMessage, setCommitMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [committing, setCommitting] = useState<
    null | "commit" | "push" | "sync" | "pull" | "publish"
  >(null)
  // Distinguishes the "push" phase of a sync vs the "push" phase of Commit&Push
  // so the right button can show the loading label.
  const [syncing, setSyncing] = useState(false)
  const [switchingBranch, setSwitchingBranch] = useState(false)
  const [pullRequestBusy, setPullRequestBusy] = useState<
    null | "create" | "open"
  >(null)
  const [githubBranchBusy, setGithubBranchBusy] = useState(false)
  const optimisticMovesRef = useRef<OptimisticGitFileMove[]>([])
  const optimisticRemovalsRef = useRef<OptimisticGitFileRemoval[]>([])
  const pendingBranchRef = useRef<{ branch: string; expiresAt: number } | null>(
    null
  )
  // While > 0, an action is in flight or just completed — watcher refreshes
  // are deferred so half-applied git state can't flash into the UI.
  const inflightActionsRef = useRef(0)
  const settleUntilRef = useRef(0)

  const queryClient = useQueryClient()
  const currentGitQueryKey = useMemo(() => gitQueryKey(cwd), [cwd])
  // Single combined query so switching projects shows the previously cached
  // git state instantly (stale-while-revalidate). Key on cwd; gcTime keeps
  // entries warm for 5 minutes after the last subscriber detaches.
  const gitQuery = useQuery({
    queryKey: currentGitQueryKey,
    enabled: !!cwd,
    queryFn: () => fetchGitQueryData(cwd!),
    select: (data) => {
      const moved = applyOptimisticGitFileMoves(
        data,
        optimisticMovesRef.current
      )
      const cleaned = applyOptimisticGitFileRemovals(
        moved,
        optimisticRemovalsRef.current
      )
      const pending = pendingBranchRef.current
      if (pending && pending.expiresAt > Date.now()) {
        if (cleaned.currentBranch === pending.branch) return cleaned
        return { ...cleaned, currentBranch: pending.branch }
      }
      return cleaned
    },
  })

  // After every refetch, drop optimistic overlays that the fresh data already
  // confirms — single source of truth for "this action landed". Prevents the
  // overlay from flickering off on TTL expiry while reality is still stale.
  useEffect(() => {
    const raw = queryClient.getQueryData<GitQueryData>(currentGitQueryKey)
    if (!raw) return
    const now = Date.now()
    optimisticMovesRef.current = optimisticMovesRef.current.filter((move) => {
      if (move.expiresAt <= now) return false
      // Keep while any path is still on the wrong side in the fresh data.
      return move.paths.some((p) => {
        const file = raw.files.find((f) => f.path === p)
        return !file || file.staged !== move.staged
      })
    })
    optimisticRemovalsRef.current = optimisticRemovalsRef.current.filter(
      (removal) => {
        if (removal.expiresAt <= now) return false
        return removal.paths.some((p) =>
          raw.files.some((f) => {
            if (f.path !== p) return false
            return removal.staged === undefined || f.staged === removal.staged
          })
        )
      }
    )
    const pending = pendingBranchRef.current
    if (pending) {
      if (raw.currentBranch === pending.branch || pending.expiresAt <= now) {
        pendingBranchRef.current = null
      }
    }
  }, [gitQuery.dataUpdatedAt, currentGitQueryKey, queryClient])

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
  const branches = gitQuery.data?.branches ?? EMPTY_BRANCHES
  const ghAvailable = gitQuery.data?.ghAvailable ?? false
  const pullRequest = gitQuery.data?.pullRequest ?? null
  const canCreatePullRequest = gitQuery.data?.canCreatePullRequest ?? false
  const notRepo = gitQuery.data?.notRepo ?? false
  const currentActionError = cwd ? (actionErrorsByCwd[cwd] ?? null) : null
  const setCurrentActionError = useCallback(
    (message: string | null) => {
      if (!cwd) return
      setActionErrorsByCwd((errors) => {
        if (message === null) {
          if (!(cwd in errors)) return errors
          const nextErrors = { ...errors }
          delete nextErrors[cwd]
          return nextErrors
        }
        return { ...errors, [cwd]: message }
      })
    },
    [cwd]
  )
  const queryError = gitQuery.error
    ? gitQuery.error instanceof Error
      ? gitQuery.error.message
      : String(gitQuery.error)
    : null
  const error = currentActionError ?? queryError
  const loading = gitQuery.isLoading

  const stagedFiles = useMemo(() => files.filter((f) => f.staged), [files])
  const unstagedFiles = useMemo(() => files.filter((f) => !f.staged), [files])

  const updateCachedFiles = useCallback(
    (paths: string[], staged: boolean) => {
      const now = Date.now()
      optimisticMovesRef.current = [
        ...optimisticMovesRef.current.filter((move) => move.expiresAt > now),
        {
          paths,
          staged,
          expiresAt: now + OPTIMISTIC_GIT_MOVE_TTL_MS,
        },
      ]
      queryClient.setQueryData<GitQueryData>(currentGitQueryKey, (data) =>
        moveCachedGitFiles(data, paths, staged)
      )
    },
    [currentGitQueryKey, queryClient]
  )

  const removeCachedFiles = useCallback(
    (paths: string[], staged?: boolean) => {
      const now = Date.now()
      const previousData =
        queryClient.getQueryData<GitQueryData>(currentGitQueryKey)
      optimisticRemovalsRef.current = [
        ...optimisticRemovalsRef.current.filter(
          (removal) => removal.expiresAt > now
        ),
        {
          paths,
          staged,
          expiresAt: now + OPTIMISTIC_GIT_REMOVE_TTL_MS,
        },
      ]
      queryClient.setQueryData<GitQueryData>(currentGitQueryKey, (data) =>
        removeCachedGitFiles(data, paths, staged)
      )
      return () => {
        const pathSet = new Set(paths)
        optimisticRemovalsRef.current = optimisticRemovalsRef.current.filter(
          (removal) =>
            removal.staged !== staged ||
            removal.paths.some((path) => !pathSet.has(path))
        )
        queryClient.setQueryData(currentGitQueryKey, previousData)
      }
    },
    [currentGitQueryKey, queryClient]
  )

  const updateCachedGitMeta = useCallback(
    (patch: Partial<Omit<GitQueryData, "files">>) => {
      queryClient.setQueryData<GitQueryData>(currentGitQueryKey, (data) =>
        data ? { ...data, ...patch } : data
      )
    },
    [currentGitQueryKey, queryClient]
  )

  const clearOptimisticEntriesForPaths = useCallback((paths: string[]) => {
    const pathSet = new Set(paths)
    optimisticMovesRef.current = optimisticMovesRef.current.flatMap((move) => {
      const remainingPaths = move.paths.filter((path) => !pathSet.has(path))
      return remainingPaths.length > 0
        ? [{ ...move, paths: remainingPaths }]
        : []
    })
    optimisticRemovalsRef.current = optimisticRemovalsRef.current.flatMap(
      (removal) => {
        const remainingPaths = removal.paths.filter(
          (path) => !pathSet.has(path)
        )
        return remainingPaths.length > 0
          ? [{ ...removal, paths: remainingPaths }]
          : []
      }
    )
  }, [])

  // Coalesce overlapping refreshes — `git status` can take a beat on big
  // repos and we don't want a stampede when fs events fire in bursts.
  const inFlightRef = useRef(false)
  const pendingRef = useRef(false)
  const runRefreshRef = useRef<() => Promise<void>>(async () => {})
  const runRefresh = useCallback(async () => {
    if (!cwd) return
    // If an action just landed, give git a moment to settle so the next
    // refetch returns the post-action truth instead of a half-applied snapshot.
    const settleDelay = settleUntilRef.current - Date.now()
    if (inflightActionsRef.current > 0 || settleDelay > 0) {
      pendingRef.current = true
      if (!inFlightRef.current) {
        window.setTimeout(
          () => {
            if (pendingRef.current && inflightActionsRef.current === 0) {
              pendingRef.current = false
              void runRefreshRef.current()
            }
          },
          Math.max(settleDelay, 50)
        )
      }
      return
    }
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

  useEffect(() => {
    runRefreshRef.current = runRefresh
  }, [runRefresh])

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

  // One shape for every git action. The pattern is always: optimistically
  // patch the cache → run the mutation → roll back on failure → refresh in
  // background. `inflightActionsRef` defers watcher-triggered refreshes so a
  // half-applied snapshot can't flash into the UI mid-flight.
  type ActionOpts<T> = {
    label: string
    optimistic: () => void
    rollback?: () => void
    mutation: () => Promise<{ ok: boolean; error?: string } & T>
    onSuccess?: (res: { ok: true } & T) => void | Promise<void>
    setLoading?: (v: boolean) => void
  }
  const runAction = useCallback(
    async <T,>(opts: ActionOpts<T>) => {
      if (!cwd) return
      inflightActionsRef.current += 1
      opts.setLoading?.(true)
      setCurrentActionError(null)
      opts.optimistic()
      try {
        const res = await opts.mutation()
        if (!res.ok) {
          opts.rollback?.()
          setCurrentActionError(res.error ?? `${opts.label} failed`)
          return
        }
        await opts.onSuccess?.(res as { ok: true } & T)
      } finally {
        opts.setLoading?.(false)
        inflightActionsRef.current = Math.max(0, inflightActionsRef.current - 1)
        // Give git a small window to settle, then refresh once.
        settleUntilRef.current = Math.max(
          settleUntilRef.current,
          Date.now() + 700
        )
        void runRefresh()
      }
    },
    [cwd, runRefresh, setCurrentActionError]
  )

  const stagePath = useCallback(
    (path: string) =>
      runAction({
        label: "Stage",
        setLoading: setBusy,
        optimistic: () => updateCachedFiles([path], true),
        rollback: () => updateCachedFiles([path], false),
        mutation: () => window.git.stage(cwd!, [path]),
      }),
    [cwd, runAction, updateCachedFiles]
  )

  const unstagePath = useCallback(
    (path: string) =>
      runAction({
        label: "Unstage",
        setLoading: setBusy,
        optimistic: () => updateCachedFiles([path], false),
        rollback: () => updateCachedFiles([path], true),
        mutation: () => window.git.unstage(cwd!, [path]),
      }),
    [cwd, runAction, updateCachedFiles]
  )

  const stageAll = useCallback(() => {
    if (unstagedFiles.length === 0) return
    const paths = unstagedFiles.map((f) => f.path)
    return runAction({
      label: "Stage",
      setLoading: setBusy,
      optimistic: () => updateCachedFiles(paths, true),
      rollback: () => updateCachedFiles(paths, false),
      mutation: () => window.git.stage(cwd!, paths),
    })
  }, [cwd, runAction, unstagedFiles, updateCachedFiles])

  const discardPath = useCallback(
    (path: string) => {
      if (
        !window.confirm(`Discard changes to "${path}"?\nThis cannot be undone.`)
      ) {
        return
      }
      let rollback: (() => void) | null = null
      return runAction({
        label: "Discard",
        setLoading: setBusy,
        optimistic: () => {
          rollback = removeCachedFiles([path], false)
        },
        rollback: () => rollback?.(),
        mutation: () => window.git.discard(cwd!, [path]),
      })
    },
    [cwd, runAction, removeCachedFiles]
  )

  const discardAllUnstaged = useCallback(() => {
    if (unstagedFiles.length === 0) return
    const paths = unstagedFiles.map((f) => f.path)
    if (
      !window.confirm(
        `Discard changes to ${unstagedFiles.length} file${unstagedFiles.length === 1 ? "" : "s"}?\nThis cannot be undone.`
      )
    ) {
      return
    }
    let rollback: (() => void) | null = null
    return runAction({
      label: "Discard",
      setLoading: setBusy,
      optimistic: () => {
        rollback = removeCachedFiles(paths, false)
      },
      rollback: () => rollback?.(),
      mutation: () => window.git.discard(cwd!, paths),
    })
  }, [cwd, runAction, unstagedFiles, removeCachedFiles])

  const unstageAll = useCallback(() => {
    if (stagedFiles.length === 0) return
    const paths = stagedFiles.map((f) => f.path)
    return runAction({
      label: "Unstage",
      setLoading: setBusy,
      optimistic: () => updateCachedFiles(paths, false),
      rollback: () => updateCachedFiles(paths, true),
      mutation: () => window.git.unstage(cwd!, paths),
    })
  }, [cwd, runAction, stagedFiles, updateCachedFiles])

  const commit = useCallback(
    async (opts?: { push?: boolean }) => {
      if (!cwd || busy) return
      const message = commitMessage.trim()
      if (!message) {
        setCurrentActionError("Commit message required")
        return
      }
      if (stagedFiles.length === 0) {
        setCurrentActionError("Nothing staged to commit")
        return
      }
      inflightActionsRef.current += 1
      setBusy(true)
      setCommitting("commit")
      setCurrentActionError(null)
      const committedPaths = stagedFiles.map((f) => f.path)
      await queryClient.cancelQueries({ queryKey: currentGitQueryKey })
      const rollback = removeCachedFiles(committedPaths, true)
      try {
        const res = await window.git.commit(cwd, message)
        if (!res.ok) {
          rollback()
          setCurrentActionError(res.error ?? "Commit failed")
          return
        }
        setCommitMessage("")
        updateCachedGitMeta({
          ahead: hasUpstream ? ahead + 1 : ahead,
        })
        if (opts?.push) {
          setCommitting("push")
          const pushRes = await window.git.push(cwd)
          if (!pushRes.ok) {
            setCurrentActionError(pushRes.error ?? "Push failed")
            clearOptimisticEntriesForPaths(committedPaths)
            queryClient.setQueryData(
              currentGitQueryKey,
              await fetchGitQueryData(cwd)
            )
            return
          }
          updateCachedGitMeta({ ahead: 0 })
        }
        clearOptimisticEntriesForPaths(committedPaths)
        queryClient.setQueryData(
          currentGitQueryKey,
          await fetchGitQueryData(cwd)
        )
      } finally {
        setBusy(false)
        setCommitting(null)
        inflightActionsRef.current = Math.max(0, inflightActionsRef.current - 1)
        settleUntilRef.current = Math.max(
          settleUntilRef.current,
          Date.now() + 700
        )
        void runRefresh()
      }
    },
    [
      cwd,
      busy,
      commitMessage,
      stagedFiles,
      queryClient,
      currentGitQueryKey,
      removeCachedFiles,
      updateCachedGitMeta,
      hasUpstream,
      ahead,
      clearOptimisticEntriesForPaths,
      runRefresh,
      setCurrentActionError,
    ]
  )

  // Gate on `hasData` so the button doesn't briefly enable on first project
  // open before the initial fetch resolves.
  const hasCommitMessage = commitMessage.trim().length > 0
  const canCommit = hasData && stagedFiles.length > 0 && hasCommitMessage
  const useManualCommit = hasCommitMessage

  const switchBranch = useCallback(
    (branch: string) => {
      if (!branch || branch === currentBranch) return
      return runAction({
        label: "Checkout",
        setLoading: setSwitchingBranch,
        // Don't write currentBranch into the cache here — let pendingBranchRef
        // be the sole overlay until a real refetch confirms the switch.
        // Writing the cache would trigger confirm-clear immediately and drop
        // the overlay before git is done, opening a window for a watcher
        // refetch to flash the old branch back into the UI.
        optimistic: () => {
          pendingBranchRef.current = {
            branch,
            expiresAt: Date.now() + OPTIMISTIC_BRANCH_TTL_MS,
          }
        },
        rollback: () => {
          pendingBranchRef.current = null
        },
        mutation: () => window.git.checkout(cwd!, branch),
      })
    },
    [cwd, currentBranch, runAction]
  )

  const createBranch = useCallback(
    (branch: string) => {
      const name = branch.trim()
      if (!name) return
      const previousBranches = branches
      return runAction({
        label: "Create branch",
        setLoading: setSwitchingBranch,
        optimistic: () => {
          pendingBranchRef.current = {
            branch: name,
            expiresAt: Date.now() + OPTIMISTIC_BRANCH_TTL_MS,
          }
          if (!branches.includes(name)) {
            updateCachedGitMeta({ branches: [...branches, name] })
          }
        },
        rollback: () => {
          pendingBranchRef.current = null
          updateCachedGitMeta({ branches: previousBranches })
        },
        mutation: () => window.git.createBranch(cwd!, name),
      })
    },
    [cwd, branches, runAction, updateCachedGitMeta]
  )

  const openPullRequest = useCallback(async () => {
    if (!cwd || !pullRequest || pullRequestBusy) return
    setPullRequestBusy("open")
    setCurrentActionError(null)
    try {
      const res = await window.git.openPullRequest(cwd, pullRequest.number)
      if (!res.ok)
        setCurrentActionError(res.error ?? "Open pull request failed")
    } finally {
      setPullRequestBusy(null)
    }
  }, [cwd, pullRequest, pullRequestBusy, setCurrentActionError])

  const createPullRequest = useCallback(async () => {
    if (!cwd || !currentBranch || !canCreatePullRequest || pullRequestBusy) {
      return
    }
    setPullRequestBusy("create")
    setCurrentActionError(null)
    try {
      const res = await window.git.createPullRequest(cwd, currentBranch)
      if (!res.ok) {
        setCurrentActionError(res.error ?? "Create pull request failed")
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
    setCurrentActionError,
  ])

  const openBranchOnGitHub = useCallback(async () => {
    if (!cwd || !currentBranch || githubBranchBusy) return
    setGithubBranchBusy(true)
    setCurrentActionError(null)
    try {
      const res = await window.git.openBranchOnGitHub(cwd, currentBranch)
      if (!res.ok) setCurrentActionError(res.error ?? "Open GitHub failed")
    } finally {
      setGithubBranchBusy(false)
    }
  }, [cwd, currentBranch, githubBranchBusy, setCurrentActionError])

  const sync = useCallback(async () => {
    if (!cwd || busy) return
    inflightActionsRef.current += 1
    setBusy(true)
    setSyncing(true)
    setCommitting("sync")
    setCurrentActionError(null)
    try {
      if (behind > 0) {
        setCommitting("pull")
        const pullRes = await window.git.pull(cwd)
        if (!pullRes.ok) {
          setCurrentActionError(pullRes.error ?? "Pull failed")
          return
        }
        updateCachedGitMeta({ behind: 0 })
      }
      if (ahead > 0) {
        setCommitting("push")
        const pushRes = await window.git.push(cwd)
        if (!pushRes.ok) {
          setCurrentActionError(pushRes.error ?? "Push failed")
          return
        }
        updateCachedGitMeta({ ahead: 0 })
      }
    } finally {
      setBusy(false)
      setSyncing(false)
      setCommitting(null)
      inflightActionsRef.current = Math.max(0, inflightActionsRef.current - 1)
      settleUntilRef.current = Math.max(
        settleUntilRef.current,
        Date.now() + 700
      )
      void runRefresh()
    }
  }, [
    cwd,
    busy,
    ahead,
    behind,
    updateCachedGitMeta,
    runRefresh,
    setCurrentActionError,
  ])

  const publishBranch = useCallback(async () => {
    if (!cwd || !currentBranch || busy) return
    inflightActionsRef.current += 1
    setBusy(true)
    setSyncing(true)
    setCommitting("publish")
    setCurrentActionError(null)
    try {
      const res = await window.git.publishBranch(cwd, currentBranch)
      if (!res.ok) {
        setCurrentActionError(res.error ?? "Publish branch failed")
        return
      }
      updateCachedGitMeta({ ahead: 0, hasUpstream: true })
    } finally {
      setBusy(false)
      setSyncing(false)
      setCommitting(null)
      inflightActionsRef.current = Math.max(0, inflightActionsRef.current - 1)
      settleUntilRef.current = Math.max(
        settleUntilRef.current,
        Date.now() + 700
      )
      void runRefresh()
    }
  }, [
    cwd,
    currentBranch,
    busy,
    updateCachedGitMeta,
    runRefresh,
    setCurrentActionError,
  ])

  // Show the Sync button only when nothing is staged and the branch is out of
  // sync with its upstream. Keep it visible while syncing so the loading
  // state actually appears on the same button the user clicked.
  const showSync =
    syncing ||
    (!busy &&
      stagedFiles.length === 0 &&
      ((hasUpstream && (ahead > 0 || behind > 0)) ||
        (!hasUpstream && !!currentBranch)))
  const showPublishBranch = !hasUpstream && !!currentBranch

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
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar">
      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next = v as "changes" | "files" | "history"
          setInternalTab(next)
          onActiveTabChange?.(next)
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-border px-3 pt-px [-webkit-app-region:drag]">
          <TabsList
            variant="line"
            className="h-full gap-1 bg-transparent p-0 [-webkit-app-region:no-drag]"
          >
            <TabsTrigger
              value="changes"
              className="!h-6 gap-1.5 rounded-sm !border-0 px-2 text-xs !text-foreground after:!opacity-0 hover:!bg-sidebar-accent/70 dark:!text-foreground dark:hover:!bg-foreground/15 data-active:!bg-[color-mix(in_srgb,var(--sidebar-accent)_90%,var(--foreground)_4%)] data-active:!text-foreground dark:data-active:!bg-foreground/15"
            >
              Changes
              {hasData && files.length > 0 && (
                <ChangeCountBadge count={files.length} />
              )}
            </TabsTrigger>
            <TabsTrigger
              value="files"
              className="!h-6 rounded-sm !border-0 px-2 text-xs !text-foreground after:!opacity-0 hover:!bg-sidebar-accent/70 dark:!text-foreground dark:hover:!bg-foreground/15 data-active:!bg-[color-mix(in_srgb,var(--sidebar-accent)_90%,var(--foreground)_4%)] data-active:!text-foreground dark:data-active:!bg-foreground/15"
            >
              Files
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="!h-6 rounded-sm !border-0 px-2 text-xs !text-foreground after:!opacity-0 hover:!bg-sidebar-accent/70 dark:!text-foreground dark:hover:!bg-foreground/15 data-active:!bg-[color-mix(in_srgb,var(--sidebar-accent)_90%,var(--foreground)_4%)] data-active:!text-foreground dark:data-active:!bg-foreground/15"
            >
              History
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
          {cwd && notRepo && (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              Not a git repository
            </div>
          )}
          {cwd && !notRepo && (
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
                {ghAvailable && currentBranch && (
                  <GitHubBranchAction
                    branch={currentBranch}
                    busy={githubBranchBusy}
                    onOpen={openBranchOnGitHub}
                  />
                )}
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
              <div className="flex flex-wrap gap-1">
                {["wip", "updates", "fix", "docs", "refactor", "feature"].map(
                  (prefix) => (
                    <button
                      key={prefix}
                      type="button"
                      onClick={() => setCommitMessage(prefix)}
                      className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-foreground transition-colors hover:bg-accent"
                    >
                      {prefix}
                    </button>
                  )
                )}
              </div>
              {showSync ? (
                <Button
                  variant="default"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    showPublishBranch ? void publishBranch() : void sync()
                  }
                  className="w-full"
                >
                  {syncing ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      {committing === "publish"
                        ? "Publishing…"
                        : committing === "pull"
                          ? "Pulling…"
                          : committing === "push"
                            ? "Pushing…"
                            : "Syncing…"}
                    </>
                  ) : showPublishBranch ? (
                    <>
                      <CloudUpload className="size-3.5" />
                      <span>Publish Branch</span>
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
                    disabled={
                      useManualCommit
                        ? !canCommit || busy
                        : !canCommitWithAi || stagedFiles.length === 0 || busy
                    }
                    onClick={() =>
                      useManualCommit ? void commit() : onCommitWithAi?.()
                    }
                    className="flex-1 rounded-r-none"
                  >
                    {useManualCommit ? (
                      committing === "commit" ? (
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
                        "Commit manually"
                      )
                    ) : (
                      "Commit with AI"
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
                        disabled={
                          !canCommitWithAi || stagedFiles.length === 0 || busy
                        }
                        onClick={onCommitWithAi}
                      >
                        Commit with AI
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={!canCommit || busy}
                        onClick={() => void commit()}
                      >
                        Commit manually
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
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
            {cwd && !notRepo && loading && files.length === 0 && (
              <div className="px-4 py-3 text-xs text-muted-foreground">
                Loading changes…
              </div>
            )}
            {cwd && !notRepo && error && (
              <div className="px-4 py-3 text-xs text-red-500">{error}</div>
            )}
            {cwd && !notRepo && !loading && !error && files.length === 0 && (
              <div className="px-4 py-3 text-xs text-muted-foreground">
                No changes
              </div>
            )}
            {cwd && stagedFiles.length > 0 && (
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
                    cwd={cwd}
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
            {cwd && unstagedFiles.length > 0 && (
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
                    cwd={cwd}
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
        <TabsContent
          value="history"
          keepMounted
          className="min-h-0 flex-1 overflow-hidden"
        >
          <ProjectChatHistoryPanel projectId={projectId ?? null} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function GitHubBranchAction({
  branch,
  busy,
  onOpen,
}: {
  branch: string
  busy: boolean
  onOpen: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            aria-label={`Open ${branch} on GitHub`}
            onClick={onOpen}
            className="h-8 shrink-0 gap-1.5 px-2 text-xs"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ExternalLink className="size-3.5" />
            )}
            <span>GitHub</span>
          </Button>
        }
      />
      <TooltipContent side="bottom">
        Open current branch on GitHub
      </TooltipContent>
    </Tooltip>
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
        {pullRequest
          ? "View Pull Request"
          : "Open GitHub to create a pull request"}
      </TooltipContent>
    </Tooltip>
  )
}

const CREATE_BRANCH_SENTINEL = "__create__"

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
  const [query, setQuery] = useState("")
  const trimmedQuery = query.trim()
  const isValidNewBranchName =
    trimmedQuery.length > 0 && !/[\s~^:?*[\\]/.test(trimmedQuery)
  const canCreate = isValidNewBranchName && !branches.includes(trimmedQuery)

  const orderedBranches = useMemo(() => {
    if (!current) return branches
    return [current, ...branches.filter((b) => b !== current)]
  }, [branches, current])

  const filteredBranches = useMemo(() => {
    const q = trimmedQuery.toLowerCase()
    if (!q) return orderedBranches
    return orderedBranches.filter((b) => b.toLowerCase().includes(q))
  }, [orderedBranches, trimmedQuery])

  return (
    <Combobox
      items={orderedBranches}
      autoHighlight
      value={current ?? ""}
      onValueChange={(value: string | null) => {
        if (!value) return
        if (value === CREATE_BRANCH_SENTINEL) {
          if (canCreate) onCreate(trimmedQuery)
          return
        }
        if (value !== current) onSwitch(value)
      }}
      onInputValueChange={setQuery}
      onOpenChange={(open) => {
        if (!open) setQuery("")
      }}
    >
      <ComboboxTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={busy || branches.length === 0}
            aria-label="Switch branch"
            className="h-8 w-full justify-between gap-2 px-2 text-xs font-normal"
          />
        }
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{current ?? "(detached HEAD)"}</span>
        </span>
      </ComboboxTrigger>
      <ComboboxContent align="start" className="p-0">
        <div className="border-b border-border/60 p-2">
          <ComboboxInput
            showTrigger={false}
            placeholder="Filter or create branch…"
            className="h-7 w-full text-xs"
          />
        </div>
        <ComboboxEmpty>
          {trimmedQuery ? "No matching branches" : "No branches"}
        </ComboboxEmpty>
        <ComboboxList>
          {canCreate && filteredBranches.length === 0 && (
            <ComboboxItem value={CREATE_BRANCH_SENTINEL} className="text-xs">
              <PlusCircle className="size-3.5 shrink-0" />
              <span className="truncate">
                Create branch{" "}
                <span className="font-medium">{trimmedQuery}</span>
              </span>
            </ComboboxItem>
          )}
          {filteredBranches.map((b) => (
            <ComboboxItem key={b} value={b} className="text-xs">
              <span className="min-w-0 flex-1 truncate">{b}</span>
            </ComboboxItem>
          ))}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
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
  cwd,
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
  cwd: string
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
  const fileAbsPath = absolutePath(cwd, file.path)

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <li
            draggable
            onDragStart={(e) => setPathDragData(e.dataTransfer, [fileAbsPath])}
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
            void window.shellApi.openInVSCode(fileAbsPath)
          }}
        >
          <VSCodeIcon className="size-3.5" />
          Open in VS Code
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            void window.shellApi.revealInFinder(fileAbsPath)
          }}
        >
          Reveal in Finder
        </ContextMenuItem>
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
