import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { toast } from "sonner"
import { WorkerPoolContextProvider } from "@pierre/diffs/react"
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronsDownUp,
  CloudUpload,
  Columns2,
  Copy,
  Eye,
  ExternalLink,
  FileCode,
  GitBranch,
  GitCommitVertical,
  GitPullRequest,
  Loader2,
  Minus,
  Plus,
  PlusCircle,
  RefreshCw,
  Rows2,
  Undo2,
  X,
} from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { NotesEditor } from "./NotesEditor"
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SummarizeMenu } from "./SummarizeMenu"
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
import { formatRelative } from "@/lib/relativeTime"
import { FileIcon } from "@/components/icons/FileIcon"
import { VSCodeIcon } from "@/components/icons/VSCodeIcon"
import { ChangeCountBadge } from "./ChangeCountBadge"
import { FilesTree } from "./FilesTree"
import {
  FilePreview,
  isMarkdownPath,
  readMdMode,
  writeMdMode,
  type MdMode,
} from "./FilePreview"
import { SingleFileDiff } from "./SingleFileDiff"
import {
  diffsHighlighterOptions,
  diffsWorkerPoolOptions,
} from "./diffWorkerConfig"
import { ProjectChatHistoryPanel } from "./ProjectChatHistory"
import type { HistoryRange } from "@/lib/historySummary"
import { setPathDragData } from "@/lib/pathDrag"
import {
  loadDiffViewMode,
  saveDiffViewMode,
  type RightSidebarTab,
} from "@/lib/projects"
import {
  EMPTY_GIT_FILES,
  applyOptimisticGitFileMoves,
  applyOptimisticGitFileRemovals,
  fetchGitQueryData,
  gitLogQueryKey,
  gitPullRequestsQueryKey,
  gitQueryKey,
  moveCachedGitFiles,
  removeCachedGitFiles,
  type GitFile,
  type GitQueryData,
  type OptimisticGitFileMove,
  type OptimisticGitFileRemoval,
  type GitStatus,
  type PullRequestInfo,
  type CommitInfo,
} from "@/lib/gitStatusQuery"

// Commit-summarize menu is hidden for now (chat-history summary lives on the
// History tab). Flip to true to bring it back.
const SHOW_COMMIT_SUMMARIZE: boolean = false
const SHOW_GIT_SUBTABS: boolean = false
const REFRESH_DEBOUNCE_MS = 350
const POLL_INTERVAL_MS = 4000
const POLL_INTERVAL_LARGE_MS = 10000
const LARGE_CHANGESET_THRESHOLD = 300
const CHANGE_LIST_BATCH_SIZE = 150
const COMMIT_PAGE_SIZE = 50
// Notes panel is drag-resizable by its top edge; height persists across reloads.
const NOTES_MIN_HEIGHT = 120
const NOTES_MAX_HEIGHT = 480
const NOTES_DEFAULT_HEIGHT = 220
const NOTES_HEIGHT_STORAGE_KEY = "gearshift:notes-height"
// Collapsed by default; last open/closed state persists across reloads.
const NOTES_OPEN_STORAGE_KEY = "gearshift:notes-open"
// Optimistic overlays are confirm-cleared once a refetch reflects the action,
// so these TTLs are only a safety net for the rare case where reality never
// catches up (e.g. external git tampering). Keep them generous.
const OPTIMISTIC_GIT_MOVE_TTL_MS = 15000
const OPTIMISTIC_GIT_REMOVE_TTL_MS = 15000
const OPTIMISTIC_BRANCH_TTL_MS = 15000
const EMPTY_BRANCHES: string[] = []
const EMPTY_PULL_REQUESTS: PullRequestInfo[] = []
const EMPTY_COMMITS: CommitInfo[] = []

export const OPEN_SIDEBAR_FILE_EVENT = "gearshift:openSidebarFile"

type GitSubTab = "changes" | "prs" | "commits"

const STATUS_STYLES: Record<GitStatus, string> = {
  M: "text-amber-500",
  A: "text-emerald-500",
  D: "text-red-500",
  R: "text-sky-500",
  C: "text-sky-500",
  U: "text-red-500",
}

// Modified is the common case and stays unlabeled to keep rows quiet.
const STATUS_LABELS: Partial<Record<GitStatus, string>> = {
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  U: "Conflict",
}

function absolutePath(cwd: string, path: string) {
  if (path.startsWith("/")) return path
  return `${cwd.replace(/\/+$/, "")}/${path}`
}

type Props = {
  cwd: string | null
  projectId?: string | null
  isActive?: boolean
  activeTab?: RightSidebarTab
  onActiveTabChange?: (tab: RightSidebarTab) => void
  activeFilePath?: string
  onOpenDiff: (path: string, staged: boolean) => void
  onOpenFile: (path: string) => void
  onOpenCommit?: (commit: {
    hash: string
    shortHash: string
    subject: string
  }) => void
  onSummarizeHistory?: (agent: string) => void
  onSummarizeChat?: (range: HistoryRange) => void
  onFocusSession?: (sessionId: string) => void
  topRightActions?: React.ReactNode
  inspectionEnabled?: boolean
}

type SidebarInspection = {
  kind: "file"
  cwd: string
  path: string
  sourceTab: "git" | "files"
}

export const RightSidebar = memo(function RightSidebar({
  cwd,
  projectId,
  isActive = true,
  activeTab,
  onActiveTabChange,
  activeFilePath,
  onOpenDiff,
  onOpenFile,
  onOpenCommit,
  onSummarizeHistory,
  onSummarizeChat,
  onFocusSession,
  topRightActions,
  inspectionEnabled = false,
}: Props) {
  const [internalTab, setInternalTab] = useState<RightSidebarTab>("git")
  const [gitSubTab, setGitSubTab] = useState<GitSubTab>("changes")
  const [inspection, setInspection] = useState<SidebarInspection | null>(null)
  const [openFilePathsByCwd, setOpenFilePathsByCwd] = useState<
    Record<string, string[]>
  >({})
  const fileTabsScrollRef = useRef<HTMLDivElement>(null)
  const activeFileTabRef = useRef<HTMLButtonElement>(null)
  const [expandedDiffKeys, setExpandedDiffKeys] = useState<Set<string>>(
    () => new Set()
  )
  const [fileMdMode, setFileMdMode] = useState<MdMode>(() => readMdMode())
  const [inlineDiffViewMode, setInlineDiffViewMode] = useState<
    "unified" | "split"
  >(() => loadDiffViewMode())
  const tab = activeTab ?? internalTab

  const inspectDiff = useCallback(
    (path: string, staged: boolean) => {
      if (!inspectionEnabled || !cwd) {
        onOpenDiff(path, staged)
        return
      }
      const key = `${staged ? "staged" : "working"}:${path}`
      setExpandedDiffKeys((current) => {
        const next = new Set(current)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    },
    [cwd, inspectionEnabled, onOpenDiff]
  )

  const inspectFile = useCallback(
    (path: string, sourceTab: "git" | "files") => {
      if (!inspectionEnabled || !cwd) {
        onOpenFile(path)
        return
      }
      setOpenFilePathsByCwd((current) => {
        const paths = current[cwd] ?? []
        return paths.includes(path)
          ? current
          : { ...current, [cwd]: [...paths, path] }
      })
      setInternalTab("files")
      onActiveTabChange?.("files")
      setInspection({ kind: "file", cwd, path, sourceTab })
    },
    [cwd, inspectionEnabled, onActiveTabChange, onOpenFile]
  )

  useEffect(() => {
    if (!inspectionEnabled || !cwd) return
    const onOpenSidebarFile = (event: Event) => {
      const detail = (event as CustomEvent<{ cwd: string; path: string }>)
        .detail
      if (detail?.cwd !== cwd || !detail.path) return
      inspectFile(detail.path, "files")
    }
    window.addEventListener(OPEN_SIDEBAR_FILE_EVENT, onOpenSidebarFile)
    return () =>
      window.removeEventListener(OPEN_SIDEBAR_FILE_EVENT, onOpenSidebarFile)
  }, [cwd, inspectFile, inspectionEnabled])

  useEffect(() => {
    if (!inspection || inspection.cwd !== cwd) return
    const frame = window.requestAnimationFrame(() => {
      activeFileTabRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [cwd, inspection, openFilePathsByCwd])
  const [actionErrorsByCwd, setActionErrorsByCwd] = useState<
    Record<string, string>
  >({})
  const [notesOpen, setNotesOpen] = useState(
    () => window.localStorage.getItem(NOTES_OPEN_STORAGE_KEY) === "1"
  )
  const handleNotesOpenChange = useCallback((open: boolean) => {
    setNotesOpen(open)
    window.localStorage.setItem(NOTES_OPEN_STORAGE_KEY, open ? "1" : "0")
  }, [])
  const [busy, setBusy] = useState(false)
  const [committing, setCommitting] = useState<
    null | "commit" | "push" | "sync" | "pull" | "publish"
  >(null)
  // Distinguishes the "push" phase of a sync vs the "push" phase of Commit&Push
  // so the right button can show the loading label.
  const [syncing, setSyncing] = useState(false)
  const [switchingBranch, setSwitchingBranch] = useState(false)
  const [pullRequestBusy, setPullRequestBusy] = useState<null | "create">(null)
  const [checkingOutPrNumber, setCheckingOutPrNumber] = useState<number | null>(
    null
  )
  const [githubBranchBusy, setGithubBranchBusy] = useState(false)
  const [stagedListLimit, setStagedListLimit] = useState(CHANGE_LIST_BATCH_SIZE)
  const [unstagedListLimit, setUnstagedListLimit] = useState(
    CHANGE_LIST_BATCH_SIZE
  )
  const optimisticMovesRef = useRef<OptimisticGitFileMove[]>([])
  const optimisticRemovalsRef = useRef<OptimisticGitFileRemoval[]>([])
  const pendingBranchRef = useRef<{ branch: string; expiresAt: number } | null>(
    null
  )
  const lastOptimisticCacheWriteAtRef = useRef(0)
  // While > 0, an action is in flight or just completed — watcher refreshes
  // are deferred so half-applied git state can't flash into the UI.
  const inflightActionsRef = useRef(0)
  const settleUntilRef = useRef(0)
  // Snapshot of the working-tree/branch state (per cwd) used to auto-dismiss a
  // stale action error once the user actually resolves the underlying problem.
  const gitStateSigRef = useRef<{ cwd: string | null; sig: string }>({
    cwd: null,
    sig: "",
  })

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
  // confirms — single source of truth for "this action landed". Ignore local
  // optimistic cache writes; those are the desired UI, not git confirmation.
  useEffect(() => {
    const state = queryClient.getQueryState(currentGitQueryKey)
    if (state?.dataUpdatedAt === lastOptimisticCacheWriteAtRef.current) return
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
  const pullRequestsQuery = useQuery({
    queryKey: gitPullRequestsQueryKey(cwd),
    enabled: !!cwd && isActive && tab === "git",
    queryFn: () => window.git.pullRequests(cwd!),
  })
  const pullRequests =
    pullRequestsQuery.data?.pullRequests ?? EMPTY_PULL_REQUESTS
  const pullRequestsGhAvailable = pullRequestsQuery.data?.ghAvailable ?? false
  const pullRequestsError = pullRequestsQuery.error
    ? pullRequestsQuery.error instanceof Error
      ? pullRequestsQuery.error.message
      : String(pullRequestsQuery.error)
    : null
  const commitsQuery = useInfiniteQuery({
    queryKey: gitLogQueryKey(cwd),
    enabled: !!cwd && isActive && tab === "git" && !notRepo,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      window.git.log(cwd!, COMMIT_PAGE_SIZE, pageParam),
    // No more pages once git returns a short (final) page.
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage?.ok || (lastPage.commits?.length ?? 0) < COMMIT_PAGE_SIZE) {
        return undefined
      }
      return allPages.reduce(
        (total, page) => total + (page.commits?.length ?? 0),
        0
      )
    },
  })
  const commits = useMemo(
    () =>
      commitsQuery.data?.pages.flatMap((page) => page.commits) ?? EMPTY_COMMITS,
    [commitsQuery.data]
  )
  const notesQuery = useQuery({
    queryKey: ["projectNotes", projectId],
    enabled: !!projectId,
    queryFn: () => window.term.notes.get(projectId!),
    staleTime: 0,
    refetchOnMount: "always",
  })
  const handleNoteSaved = useCallback(
    (note: { projectId: string; body: string; updatedAt: number }) => {
      queryClient.setQueryData(["projectNotes", note.projectId], note)
    },
    [queryClient]
  )
  const firstCommitsPage = commitsQuery.data?.pages[0]
  const commitsError = commitsQuery.error
    ? commitsQuery.error instanceof Error
      ? commitsQuery.error.message
      : String(commitsQuery.error)
    : firstCommitsPage && !firstCommitsPage.ok
      ? (firstCommitsPage.error ?? "Failed to load commits")
      : null
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

  // A failed action (e.g. a branch switch blocked by untracked files) leaves a
  // sticky error that previously only cleared when the next sidebar action ran.
  // Clear it once the working tree or branch actually changes — i.e. after the
  // user fixes the problem, even from the terminal. Gated by the action settle
  // window so an action's own optimistic/rollback churn can't wipe the error it
  // just raised, and re-baselined (without clearing) when the project changes.
  useEffect(() => {
    const sig = `${currentBranch ?? ""}::${files
      .map((f) => `${f.path} ${f.status} ${f.staged ? 1 : 0}`)
      .join("")}`
    const prev = gitStateSigRef.current
    gitStateSigRef.current = { cwd, sig }
    if (prev.cwd !== cwd) return
    if (
      sig !== prev.sig &&
      currentActionError &&
      inflightActionsRef.current === 0 &&
      Date.now() >= settleUntilRef.current
    ) {
      setCurrentActionError(null)
    }
  }, [cwd, files, currentBranch, currentActionError, setCurrentActionError])

  const stagedFiles = useMemo(() => files.filter((f) => f.staged), [files])
  const unstagedFiles = useMemo(() => files.filter((f) => !f.staged), [files])
  const visibleStagedFiles = useMemo(
    () => stagedFiles.slice(0, stagedListLimit),
    [stagedFiles, stagedListLimit]
  )
  const visibleUnstagedFiles = useMemo(
    () => unstagedFiles.slice(0, unstagedListLimit),
    [unstagedFiles, unstagedListLimit]
  )
  const hiddenStagedCount = stagedFiles.length - visibleStagedFiles.length
  const hiddenUnstagedCount = unstagedFiles.length - visibleUnstagedFiles.length
  const stagedDiffKeys = useMemo(
    () => stagedFiles.map((file) => `staged:${file.path}`),
    [stagedFiles]
  )
  const unstagedDiffKeys = useMemo(
    () => unstagedFiles.map((file) => `working:${file.path}`),
    [unstagedFiles]
  )
  const collapseSectionDiffs = useCallback(
    (keys: string[]) => {
      setExpandedDiffKeys((prev) => {
        const next = new Set(prev)
        for (const key of keys) next.delete(key)
        return next
      })
    },
    [setExpandedDiffKeys]
  )
  const toggleDiffViewMode = useCallback(() => {
    setInlineDiffViewMode((prev) => {
      const next = prev === "split" ? "unified" : "split"
      saveDiffViewMode(next)
      return next
    })
  }, [setInlineDiffViewMode])

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
      lastOptimisticCacheWriteAtRef.current =
        queryClient.getQueryState(currentGitQueryKey)?.dataUpdatedAt ?? 0
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
      lastOptimisticCacheWriteAtRef.current =
        queryClient.getQueryState(currentGitQueryKey)?.dataUpdatedAt ?? 0
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
      // Only refresh the working-tree summary. Prefix matching also refetched
      // the nested PR list and commit log queries on every filesystem event,
      // spawning unnecessary `gh`/`git log` processes while files were being
      // edited or generated.
      await queryClient.refetchQueries({
        queryKey: currentGitQueryKey,
        exact: true,
      })
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
    async (rawMessage: string, opts?: { push?: boolean }) => {
      if (!cwd || busy) return false
      const message = rawMessage.trim()
      if (!message) {
        setCurrentActionError("Commit message required")
        return false
      }
      if (stagedFiles.length === 0) {
        setCurrentActionError("Nothing staged to commit")
        return false
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
          return false
        }
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
            return true
          }
          updateCachedGitMeta({ ahead: 0 })
        }
        clearOptimisticEntriesForPaths(committedPaths)
        queryClient.setQueryData(
          currentGitQueryKey,
          await fetchGitQueryData(cwd)
        )
        void queryClient.invalidateQueries({ queryKey: gitLogQueryKey(cwd) })
        return true
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

  const openPullRequest = useCallback(() => {
    if (!pullRequest) return
    void window.shellApi.openExternal(pullRequest.url)
  }, [pullRequest])

  // Switching to a PR branch is only allowed on a clean working tree, so
  // uncommitted changes can't be carried over (or block) the checkout.
  const checkoutPullRequestBranch = useCallback(
    (pr: PullRequestInfo) => {
      if (!cwd || files.length > 0 || checkingOutPrNumber !== null) return
      setCheckingOutPrNumber(pr.number)
      return runAction({
        label: "Checkout pull request",
        optimistic: () => {
          if (pr.headRefName) {
            pendingBranchRef.current = {
              branch: pr.headRefName,
              expiresAt: Date.now() + OPTIMISTIC_BRANCH_TTL_MS,
            }
          }
        },
        rollback: () => {
          pendingBranchRef.current = null
        },
        mutation: () => window.git.checkoutPullRequest(cwd, pr.number),
      })?.finally(() => setCheckingOutPrNumber(null))
    },
    [cwd, files.length, checkingOutPrNumber, runAction]
  )

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
      void queryClient.refetchQueries({
        queryKey: gitPullRequestsQueryKey(cwd),
      })
    } finally {
      setPullRequestBusy(null)
    }
  }, [
    cwd,
    currentBranch,
    canCreatePullRequest,
    pullRequestBusy,
    queryClient,
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
      void queryClient.invalidateQueries({ queryKey: gitLogQueryKey(cwd) })
      void runRefresh()
    }
  }, [
    cwd,
    busy,
    ahead,
    behind,
    queryClient,
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

  const activeInspection =
    inspectionEnabled && inspection?.cwd === cwd ? inspection : null

  const closeFilePreviews = useCallback(
    (paths: string[]) => {
      if (!cwd || !inspection || inspection.cwd !== cwd) return
      const openFilePaths = openFilePathsByCwd[cwd] ?? [inspection.path]
      const closing = new Set(paths)
      const index = openFilePaths.indexOf(inspection.path)
      const remaining = openFilePaths.filter((p) => !closing.has(p))
      setOpenFilePathsByCwd((current) => ({ ...current, [cwd]: remaining }))
      if (!closing.has(inspection.path)) return
      const nextPath = remaining[Math.min(index, remaining.length - 1)]
      if (nextPath) setInspection({ ...inspection, path: nextPath })
      else setInspection(null)
    },
    [cwd, inspection, openFilePathsByCwd]
  )

  const closeFilePreview = useCallback(
    (path: string) => closeFilePreviews([path]),
    [closeFilePreviews]
  )

  useEffect(() => {
    if (!activeInspection) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "w"
      ) {
        return
      }
      const target = event.target instanceof Element ? event.target : null
      if (!target?.closest("[data-sidebar-file-viewer='true']")) return
      event.preventDefault()
      event.stopPropagation()
      closeFilePreview(activeInspection.path)
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [activeInspection, closeFilePreview])

  if (activeInspection && cwd) {
    const openFilePaths = openFilePathsByCwd[cwd] ?? [activeInspection.path]
    const activeFileIsMarkdown = isMarkdownPath(activeInspection.path)
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            const next = value as RightSidebarTab
            setInspection(null)
            setInternalTab(next)
            onActiveTabChange?.(next)
          }}
          className="shrink-0 gap-0"
        >
          <div className="flex h-[34px] items-center gap-2 border-b border-border px-3 pt-px [-webkit-app-region:drag]">
            <TabsList
              variant="line"
              className="h-full gap-1 bg-transparent p-0 [-webkit-app-region:no-drag]"
            >
              <TabsTrigger
                value="git"
                className="!h-6 gap-1.5 rounded-sm !border-0 px-2 text-xs !text-foreground after:!opacity-0 hover:!bg-sidebar-accent/70 data-active:!bg-[color-mix(in_srgb,var(--sidebar-accent)_90%,var(--foreground)_4%)] data-active:!text-foreground"
              >
                Changes
                {hasData && files.length > 0 && (
                  <ChangeCountBadge count={files.length} />
                )}
              </TabsTrigger>
              <TabsTrigger
                value="files"
                className="!h-6 rounded-sm !border-0 px-2 text-xs !text-foreground after:!opacity-0 hover:!bg-sidebar-accent/70 data-active:!bg-[color-mix(in_srgb,var(--sidebar-accent)_90%,var(--foreground)_4%)] data-active:!text-foreground"
              >
                Files
              </TabsTrigger>
              <TabsTrigger
                value="history"
                className="!h-6 rounded-sm !border-0 px-2 text-xs !text-foreground after:!opacity-0 hover:!bg-sidebar-accent/70 data-active:!bg-[color-mix(in_srgb,var(--sidebar-accent)_90%,var(--foreground)_4%)] data-active:!text-foreground"
              >
                History
              </TabsTrigger>
            </TabsList>
            {topRightActions && (
              <div className="ml-auto flex items-center gap-0.5 [-webkit-app-region:no-drag]">
                {topRightActions}
              </div>
            )}
          </div>
        </Tabs>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="min-h-0 w-[38%] max-w-72 min-w-48 shrink-0 overflow-hidden border-r border-border bg-sidebar">
            <FilesTree
              cwd={cwd}
              activePath={activeInspection.path}
              onOpenFile={(path) => inspectFile(path, "files")}
            />
          </div>
          <div
            data-sidebar-file-viewer="true"
            className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background"
          >
            <div className="flex h-[34px] shrink-0 items-center border-b border-border">
              <div
                ref={fileTabsScrollRef}
                className="sidebar-file-tabs-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2"
              >
                {openFilePaths.map((path, i) => {
                  const active = path === activeInspection.path
                  const name = path.split(/[\\/]/).pop() ?? path
                  return (
                    <ContextMenu key={path}>
                      <ContextMenuTrigger
                        render={
                          <button
                            ref={active ? activeFileTabRef : undefined}
                            type="button"
                            title={path}
                            onClick={() =>
                              setInspection({
                                ...activeInspection,
                                path,
                                sourceTab: "files",
                              })
                            }
                            className={cn(
                              "group/file-tab flex h-[26px] max-w-40 min-w-24 flex-1 basis-0 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-foreground/8 hover:text-foreground",
                              active && "bg-foreground/12 text-foreground"
                            )}
                          >
                            <FileIcon name={name} className="size-4 shrink-0" />
                            <span className="min-w-0 flex-1 truncate text-left">
                              {name}
                            </span>
                            <span
                              role="button"
                              tabIndex={0}
                              aria-label={`Close ${name}`}
                              onClick={(event) => {
                                event.stopPropagation()
                                closeFilePreview(path)
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ")
                                  return
                                event.preventDefault()
                                event.stopPropagation()
                                closeFilePreview(path)
                              }}
                              className="grid size-4 shrink-0 place-items-center rounded-sm opacity-0 group-hover/file-tab:opacity-100 hover:bg-foreground/15 focus:opacity-100"
                            >
                              <X className="size-3" />
                            </span>
                          </button>
                        }
                      />
                      <ContextMenuContent className="min-w-[180px] whitespace-nowrap">
                        <ContextMenuItem onClick={() => closeFilePreview(path)}>
                          Close
                        </ContextMenuItem>
                        <ContextMenuItem
                          disabled={openFilePaths.length <= 1}
                          onClick={() =>
                            closeFilePreviews(
                              openFilePaths.filter((p) => p !== path)
                            )
                          }
                        >
                          Close Others
                        </ContextMenuItem>
                        <ContextMenuItem
                          disabled={i >= openFilePaths.length - 1}
                          onClick={() =>
                            closeFilePreviews(openFilePaths.slice(i + 1))
                          }
                        >
                          Close to the Right
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          onClick={() => closeFilePreviews(openFilePaths)}
                        >
                          Close All
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  )
                })}
              </div>
              {activeFileIsMarkdown && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => {
                          const next: MdMode =
                            fileMdMode === "preview" ? "raw" : "preview"
                          setFileMdMode(next)
                          writeMdMode(next)
                        }}
                        aria-label={
                          fileMdMode === "preview"
                            ? "Show raw Markdown"
                            : "Show Markdown preview"
                        }
                        aria-pressed={fileMdMode === "preview"}
                        className="mr-1 shrink-0"
                      >
                        {fileMdMode === "preview" ? <Eye /> : <FileCode />}
                      </Button>
                    }
                  />
                  <TooltipContent>
                    {fileMdMode === "preview" ? "Show raw" : "Show preview"}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden bg-background">
              <FilePreview
                cwd={cwd}
                path={activeInspection.path}
                isActive
                mdMode={fileMdMode}
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar">
      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next = v as RightSidebarTab
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
              value="git"
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
            <div className="ml-auto flex items-center gap-0.5 [-webkit-app-region:no-drag]">
              {/* Summarize-commits menu hidden for now; chat-history summary
                  lives on the History tab itself. */}
              {SHOW_COMMIT_SUMMARIZE && onSummarizeHistory && (
                <SummarizeMenu onSummarize={onSummarizeHistory} />
              )}
              {topRightActions}
            </div>
          )}
        </div>
        <TabsContent
          value="git"
          keepMounted
          className="min-h-0 flex-1 overflow-hidden"
        >
          <Tabs
            value={gitSubTab}
            onValueChange={(v) => setGitSubTab(v as GitSubTab)}
            className="flex h-full min-h-0 flex-col gap-0"
          >
            {/* Sub-tabs hidden for now — Changes is shown directly via the
                parent tab. Keep the triggers/content below for when Commits
                and PRs are re-enabled. */}
            {SHOW_GIT_SUBTABS && (
              <div className="flex h-[34px] shrink-0 items-center border-b border-border/60 px-3">
                <TabsList
                  variant="line"
                  className="h-full gap-1 bg-transparent p-0"
                >
                  <TabsTrigger
                    value="changes"
                    className="!h-full gap-1.5 rounded-none !border-0 px-2 text-xs text-foreground/60 after:!bottom-0 hover:text-foreground data-active:!text-foreground"
                  >
                    Changes
                  </TabsTrigger>
                  <TabsTrigger
                    value="commits"
                    className="!h-full gap-1.5 rounded-none !border-0 px-2 text-xs text-foreground/60 after:!bottom-0 hover:text-foreground data-active:!text-foreground"
                  >
                    Commits
                  </TabsTrigger>
                  <TabsTrigger
                    value="prs"
                    className="!h-full gap-1.5 rounded-none !border-0 px-2 text-xs text-foreground/60 after:!bottom-0 hover:text-foreground data-active:!text-foreground"
                  >
                    PRs
                    {pullRequests.length > 0 && (
                      <ChangeCountBadge count={pullRequests.length} />
                    )}
                  </TabsTrigger>
                </TabsList>
              </div>
            )}
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
                  <CommitControls
                    hasData={hasData}
                    stagedCount={stagedFiles.length}
                    busy={busy}
                    committing={committing}
                    syncing={syncing}
                    showSync={showSync}
                    showPublishBranch={showPublishBranch}
                    ahead={ahead}
                    behind={behind}
                    onCommit={commit}
                    onSync={sync}
                    onPublish={publishBranch}
                  />
                </div>
              )}
              <WorkerPoolContextProvider
                poolOptions={diffsWorkerPoolOptions}
                highlighterOptions={diffsHighlighterOptions}
              >
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
                    <div className="px-4 py-3 text-xs text-red-500">
                      {error}
                    </div>
                  )}
                  {cwd &&
                    !notRepo &&
                    !loading &&
                    !error &&
                    files.length === 0 && (
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
                      trailing={
                        inspectionEnabled ? (
                          <DiffViewHeaderActions
                            splitView={inlineDiffViewMode === "split"}
                            onToggleSplitView={toggleDiffViewMode}
                            onCollapseAll={() =>
                              collapseSectionDiffs(stagedDiffKeys)
                            }
                          />
                        ) : undefined
                      }
                      footer={
                        hiddenStagedCount > 0 ? (
                          <ShowMoreChangesButton
                            hiddenCount={hiddenStagedCount}
                            onClick={() =>
                              setStagedListLimit(
                                (limit) => limit + CHANGE_LIST_BATCH_SIZE
                              )
                            }
                          />
                        ) : null
                      }
                    >
                      {visibleStagedFiles.map((c) => {
                        const diffKey = `staged:${c.path}`
                        return (
                          <InlineDiffRow
                            key={diffKey}
                            cwd={cwd}
                            file={c}
                            expanded={
                              inspectionEnabled && expandedDiffKeys.has(diffKey)
                            }
                            actionIcon={<Minus className="size-3.5" />}
                            actionLabel="Unstage"
                            onAction={() => unstagePath(c.path)}
                            onOpen={() => inspectDiff(c.path, true)}
                            onOpenFile={() => inspectFile(c.path, "git")}
                            viewMode={inlineDiffViewMode}
                            busy={busy}
                          />
                        )
                      })}
                    </FileGroup>
                  )}
                  {cwd && unstagedFiles.length > 0 && (
                    <FileGroup
                      label="Changes"
                      count={unstagedFiles.length}
                      onActionAll={stageAll}
                      actionAllLabel="Stage all"
                      actionAllIcon={<Plus className="size-3.5" />}
                      trailing={
                        inspectionEnabled ? (
                          <DiffViewHeaderActions
                            splitView={inlineDiffViewMode === "split"}
                            onToggleSplitView={toggleDiffViewMode}
                            onCollapseAll={() =>
                              collapseSectionDiffs(unstagedDiffKeys)
                            }
                          />
                        ) : undefined
                      }
                      secondaryActionAll={discardAllUnstaged}
                      secondaryActionAllLabel="Discard all"
                      secondaryActionAllIcon={<Undo2 className="size-3.5" />}
                      footer={
                        hiddenUnstagedCount > 0 ? (
                          <ShowMoreChangesButton
                            hiddenCount={hiddenUnstagedCount}
                            onClick={() =>
                              setUnstagedListLimit(
                                (limit) => limit + CHANGE_LIST_BATCH_SIZE
                              )
                            }
                          />
                        ) : null
                      }
                    >
                      {visibleUnstagedFiles.map((c) => {
                        const diffKey = `working:${c.path}`
                        return (
                          <InlineDiffRow
                            key={diffKey}
                            cwd={cwd}
                            file={c}
                            expanded={
                              inspectionEnabled && expandedDiffKeys.has(diffKey)
                            }
                            actionIcon={<Plus className="size-3.5" />}
                            actionLabel="Stage"
                            onAction={() => stagePath(c.path)}
                            secondaryActionIcon={<Undo2 className="size-3.5" />}
                            secondaryActionLabel="Discard changes"
                            onSecondaryAction={() => discardPath(c.path)}
                            onOpen={() => inspectDiff(c.path, false)}
                            onOpenFile={() => inspectFile(c.path, "git")}
                            viewMode={inlineDiffViewMode}
                            busy={busy}
                          />
                        )
                      })}
                    </FileGroup>
                  )}
                </ScrollArea>
              </WorkerPoolContextProvider>
            </TabsContent>
            {SHOW_GIT_SUBTABS && (
              <>
                <TabsContent
                  value="prs"
                  keepMounted
                  className="min-h-0 flex-1 overflow-hidden"
                >
                  <PullRequestsPanel
                    cwd={cwd}
                    notRepo={notRepo}
                    loading={pullRequestsQuery.isLoading}
                    error={currentActionError ?? pullRequestsError}
                    ghAvailable={pullRequestsGhAvailable}
                    pullRequests={pullRequests}
                    hasChanges={files.length > 0}
                    checkingOutNumber={checkingOutPrNumber}
                    onCheckout={(pr) => void checkoutPullRequestBranch(pr)}
                  />
                </TabsContent>
                <TabsContent
                  value="commits"
                  keepMounted
                  className="min-h-0 flex-1 overflow-hidden"
                >
                  <CommitHistoryPanel
                    cwd={cwd}
                    notRepo={notRepo}
                    loading={commitsQuery.isLoading}
                    error={commitsError}
                    commits={commits}
                    hasNextPage={commitsQuery.hasNextPage}
                    isFetchingNextPage={commitsQuery.isFetchingNextPage}
                    onLoadMore={() => void commitsQuery.fetchNextPage()}
                    onOpen={onOpenCommit}
                  />
                </TabsContent>
              </>
            )}
          </Tabs>
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
              onOpenFile={(path) => inspectFile(path, "files")}
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
          <ProjectChatHistoryPanel
            projectId={projectId ?? null}
            onSummarize={onSummarizeChat}
            onFocusSession={onFocusSession}
          />
        </TabsContent>
      </Tabs>
      <SidebarNotesSection
        projectId={projectId ?? null}
        initialBody={notesQuery.data?.body ?? ""}
        loading={notesQuery.isLoading}
        onSaved={handleNoteSaved}
        open={notesOpen}
        onOpenChange={handleNotesOpenChange}
      />
    </div>
  )
})

const CommitControls = memo(function CommitControls({
  hasData,
  stagedCount,
  busy,
  committing,
  syncing,
  showSync,
  showPublishBranch,
  ahead,
  behind,
  onCommit,
  onSync,
  onPublish,
}: {
  hasData: boolean
  stagedCount: number
  busy: boolean
  committing: null | "commit" | "push" | "sync" | "pull" | "publish"
  syncing: boolean
  showSync: boolean
  showPublishBranch: boolean
  ahead: number
  behind: number
  onCommit: (message: string, opts?: { push?: boolean }) => Promise<boolean>
  onSync: () => void | Promise<void>
  onPublish: () => void | Promise<void>
}) {
  const [message, setMessage] = useState("")
  const canCommit = hasData && stagedCount > 0 && message.trim().length > 0

  const submitCommit = useCallback(
    (opts?: { push?: boolean }) => {
      if (!canCommit) return
      const submittedMessage = message
      void onCommit(submittedMessage, opts).then((ok) => {
        if (ok) {
          setMessage((current) => (current === submittedMessage ? "" : current))
        }
      })
    },
    [canCommit, message, onCommit]
  )

  return (
    <>
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Message (Ctrl+Enter to commit)"
        rows={2}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canCommit) {
            e.preventDefault()
            submitCommit()
          }
        }}
        className="min-h-0 resize-none rounded-md bg-background px-2 py-1.5 text-xs focus-visible:ring-2 focus-visible:ring-ring/40 md:text-xs"
      />
      {showSync ? (
        <Button
          variant="default"
          size="sm"
          disabled={busy}
          onClick={() => (showPublishBranch ? void onPublish() : void onSync())}
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
            disabled={!canCommit || busy}
            onClick={() => submitCommit()}
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
                onClick={() => submitCommit({ push: true })}
              >
                Commit &amp; Push
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </>
  )
})

const SidebarNotesSection = memo(function SidebarNotesSection({
  projectId,
  initialBody,
  loading,
  onSaved,
  open,
  onOpenChange,
}: {
  projectId: string | null
  initialBody: string
  loading: boolean
  onSaved: (note: {
    projectId: string
    body: string
    updatedAt: number
  }) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<number | null>(null)

  const [height, setHeight] = useState<number>(() => {
    const saved = Number(window.localStorage.getItem(NOTES_HEIGHT_STORAGE_KEY))
    return Number.isFinite(saved) && saved >= NOTES_MIN_HEIGHT
      ? Math.min(saved, NOTES_MAX_HEIGHT)
      : NOTES_DEFAULT_HEIGHT
  })
  const [dragging, setDragging] = useState(false)
  const heightRef = useRef(height)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragRef.current = { startY: e.clientY, startH: heightRef.current }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const next = Math.min(
      NOTES_MAX_HEIGHT,
      Math.max(NOTES_MIN_HEIGHT, drag.startH + (drag.startY - e.clientY))
    )
    heightRef.current = next
    setHeight(next)
  }
  const onResizeUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
    window.localStorage.setItem(
      NOTES_HEIGHT_STORAGE_KEY,
      String(heightRef.current)
    )
  }

  const copyNotesLink = async () => {
    if (!projectId) return
    const { port } = await window.term.history.serverInfo()
    if (!port) {
      toast.error("Notes server is not available")
      return
    }
    const url = `http://127.0.0.1:${port}/notes?projectId=${encodeURIComponent(
      projectId
    )}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    toast.success("Notes link copied")
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current)
    }
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      style={open ? { height } : undefined}
      className={cn(
        "relative flex shrink-0 flex-col bg-sidebar",
        !dragging && "transition-[height] duration-150",
        !open && "h-9"
      )}
    >
      {open && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize notes"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          className="group/notes-resize absolute inset-x-0 -top-[3px] z-20 h-[7px] cursor-row-resize touch-none"
        >
          <span
            className={cn(
              "pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 transition-colors",
              dragging
                ? "bg-foreground/40"
                : "bg-transparent group-hover/notes-resize:bg-foreground/30"
            )}
          />
        </div>
      )}
      <div className="flex h-9 shrink-0 items-center border-y border-border/70">
        <CollapsibleTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={open ? "Collapse notes" : "Expand notes"}
              className="h-full min-w-0 flex-1 justify-start rounded-none px-3 text-left text-xs font-medium hover:bg-sidebar-accent/70 aria-expanded:bg-transparent aria-expanded:text-foreground"
            >
              <ChevronDown
                data-icon="inline-start"
                className={cn(
                  "transition-transform duration-150",
                  !open && "-rotate-90"
                )}
              />
              <span className="truncate">Notes</span>
            </Button>
          }
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={!projectId}
                aria-label="Copy notes link"
                onClick={() => void copyNotesLink()}
                className="mr-2 shrink-0"
              >
                {copied ? <Check /> : <Copy />}
              </Button>
            }
          />
          <TooltipContent>
            {copied ? "Copied!" : "Copy notes link"}
          </TooltipContent>
        </Tooltip>
      </div>
      <CollapsibleContent className="flex min-h-0 flex-1 flex-col">
        <NotesEditor
          key={
            projectId
              ? `${projectId}:${loading ? "loading" : "ready"}`
              : "empty"
          }
          projectId={projectId}
          initialMarkdown={projectId ? initialBody : ""}
          editable={!!projectId && !loading}
          onSaved={onSaved}
          placeholder={
            !projectId
              ? "Open a project to add notes..."
              : loading
                ? "Loading notes..."
                : "Add notes for this workspace..."
          }
        />
      </CollapsibleContent>
    </Collapsible>
  )
})

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
            className="size-8 shrink-0 p-0"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ExternalLink className="size-3.5" />
            )}
          </Button>
        }
      />
      <TooltipContent side="bottom">
        Open branch <span className="font-medium">{branch}</span> on GitHub
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
  busy: null | "create"
  onOpen: () => void
  onCreate: () => void
}) {
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
              "size-8 shrink-0 p-0",
              pullRequest &&
                "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
            )}
          >
            {isCreating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <GitPullRequest className="size-3.5" />
            )}
          </Button>
        }
      />
      <TooltipContent side="bottom">
        {pullRequest
          ? `View pull request #${pullRequest.number}`
          : "Create a pull request on GitHub"}
      </TooltipContent>
    </Tooltip>
  )
}

function PullRequestsPanel({
  cwd,
  notRepo,
  loading,
  error,
  ghAvailable,
  pullRequests,
  hasChanges,
  checkingOutNumber,
  onCheckout,
}: {
  cwd: string | null
  notRepo: boolean
  loading: boolean
  error: string | null
  ghAvailable: boolean
  pullRequests: PullRequestInfo[]
  hasChanges: boolean
  checkingOutNumber: number | null
  onCheckout: (pr: PullRequestInfo) => void
}) {
  const [copiedNumber, setCopiedNumber] = useState<number | null>(null)
  const copiedTimerRef = useRef<number | null>(null)
  const copyLink = (pr: PullRequestInfo) => {
    void navigator.clipboard.writeText(pr.url)
    setCopiedNumber(pr.number)
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current)
    }
    copiedTimerRef.current = window.setTimeout(
      () => setCopiedNumber(null),
      1500
    )
  }

  if (!cwd) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        No project open
      </div>
    )
  }

  if (notRepo) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        Not a git repository
      </div>
    )
  }

  if (loading && pullRequests.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        Loading pull requests…
      </div>
    )
  }

  if (error) {
    return <div className="px-4 py-3 text-xs text-red-500">{error}</div>
  }

  if (!ghAvailable) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        GitHub CLI is not available for this repository.
      </div>
    )
  }

  if (pullRequests.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        No open pull requests
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <ul className="flex flex-col">
        {pullRequests.map((pr) => {
          const checkingOut = checkingOutNumber === pr.number
          const checkoutDisabled = hasChanges || checkingOutNumber !== null
          return (
            <li key={pr.id} className="border-b border-border/60">
              <ContextMenu>
                <ContextMenuTrigger
                  render={
                    <div
                      onClick={() => void window.shellApi.openExternal(pr.url)}
                      className="group/pr relative flex w-full min-w-0 cursor-pointer items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent/40"
                    />
                  }
                >
                  <GitPullRequest className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-xs font-medium text-foreground">
                      {pr.title}
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="shrink-0">#{pr.number}</span>
                      {pr.authorLogin && (
                        <>
                          <span className="shrink-0">·</span>
                          <span className="truncate">{pr.authorLogin}</span>
                        </>
                      )}
                    </span>
                    {(pr.headRefName || pr.baseRefName) && (
                      <span className="truncate text-[11px] text-muted-foreground">
                        {pr.headRefName ?? "unknown"} →{" "}
                        {pr.baseRefName ?? "base"}
                      </span>
                    )}
                    {(pr.createdAt || pr.updatedAt) && (
                      <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground/80">
                        {pr.createdAt && (
                          <span className="shrink-0">
                            opened {formatRelative(Date.parse(pr.createdAt))}
                          </span>
                        )}
                        {pr.createdAt && pr.updatedAt && (
                          <span className="shrink-0">·</span>
                        )}
                        {pr.updatedAt && (
                          <span className="shrink-0">
                            updated {formatRelative(Date.parse(pr.updatedAt))}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  <span className="pointer-events-none absolute top-1.5 right-2 flex items-center gap-0.5 rounded-md border border-border bg-popover p-0.5 opacity-0 shadow-sm transition-opacity group-hover/pr:pointer-events-auto group-hover/pr:opacity-100">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            disabled={checkoutDisabled}
                            onClick={(e) => {
                              e.stopPropagation()
                              onCheckout(pr)
                            }}
                            aria-label="Check out branch"
                            className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/15 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {checkingOut ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <GitBranch className="size-3.5" />
                            )}
                          </button>
                        }
                      />
                      <TooltipContent>
                        {hasChanges
                          ? "Commit or discard your changes first"
                          : "Check out branch"}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              copyLink(pr)
                            }}
                            aria-label="Copy link"
                            className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/15 hover:text-foreground"
                          >
                            {copiedNumber === pr.number ? (
                              <Check className="size-3.5" />
                            ) : (
                              <Copy className="size-3.5" />
                            )}
                          </button>
                        }
                      />
                      <TooltipContent>
                        {copiedNumber === pr.number ? "Copied!" : "Copy link"}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              void window.shellApi.openExternal(pr.url)
                            }}
                            aria-label="Open in browser"
                            className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/15 hover:text-foreground"
                          >
                            <ExternalLink className="size-3.5" />
                          </button>
                        }
                      />
                      <TooltipContent>Open in browser</TooltipContent>
                    </Tooltip>
                  </span>
                </ContextMenuTrigger>
                <ContextMenuContent className="min-w-[180px] whitespace-nowrap">
                  <ContextMenuItem
                    disabled={checkoutDisabled}
                    onClick={() => onCheckout(pr)}
                  >
                    Check Out Branch
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => copyLink(pr)}>
                    Copy Link
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => void window.shellApi.openExternal(pr.url)}
                  >
                    Open in Browser
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </li>
          )
        })}
      </ul>
    </ScrollArea>
  )
}

function CommitHistoryPanel({
  cwd,
  notRepo,
  loading,
  error,
  commits,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onOpen,
}: {
  cwd: string | null
  notRepo: boolean
  loading: boolean
  error: string | null
  commits: CommitInfo[]
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
  onOpen?: (commit: {
    hash: string
    shortHash: string
    subject: string
  }) => void
}) {
  // Auto-load the next page when the sentinel scrolls into view.
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasNextPage) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) onLoadMore()
      },
      { rootMargin: "200px" }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, onLoadMore, commits.length])

  if (!cwd) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        No project open
      </div>
    )
  }

  if (notRepo) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        Not a git repository
      </div>
    )
  }

  if (loading && commits.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        Loading commits…
      </div>
    )
  }

  if (error) {
    return <div className="px-4 py-3 text-xs text-red-500">{error}</div>
  }

  if (commits.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">No commits</div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <ul className="flex flex-col">
        {commits.map((commit) => (
          <li key={commit.hash} className="border-b border-border/60">
            <button
              type="button"
              onClick={() =>
                onOpen?.({
                  hash: commit.hash,
                  shortHash: commit.shortHash,
                  subject: commit.subject,
                })
              }
              className="flex w-full min-w-0 items-center gap-2.5 px-3 py-2.5 text-left transition-colors outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <GitCommitVertical className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-xs font-medium text-foreground">
                  {commit.subject}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="shrink-0 font-mono">{commit.shortHash}</span>
                  <span className="shrink-0">·</span>
                  <span className="truncate">{commit.authorName}</span>
                  <span className="shrink-0">·</span>
                  <span className="shrink-0">{commit.relativeDate}</span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hasNextPage && (
        <div
          ref={sentinelRef}
          className="px-4 py-3 text-center text-[11px] text-muted-foreground"
        >
          {isFetchingNextPage ? "Loading more…" : ""}
        </div>
      )}
    </ScrollArea>
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
            <ComboboxItem key={b} value={b} className="group text-xs">
              <span className="min-w-0 flex-1 truncate">{b}</span>
              <BranchCopyButton branch={b} />
            </ComboboxItem>
          ))}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

function BranchCopyButton({ branch }: { branch: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    []
  )
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={`Copy branch name ${branch}`}
      // Stop the click/pointer from reaching the combobox item so copying
      // doesn't switch branches or close the list.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        void navigator.clipboard.writeText(branch)
        setCopied(true)
        toast.success("Branch name copied")
        if (timerRef.current !== null) window.clearTimeout(timerRef.current)
        timerRef.current = window.setTimeout(() => setCopied(false), 1200)
      }}
      className="size-5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-data-[highlighted]:opacity-100 focus-visible:opacity-100"
    >
      {copied ? <Check /> : <Copy />}
    </Button>
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
  trailing,
  footer,
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
  trailing?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="group/section px-3 pb-1">
      <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-sidebar px-1 pt-2.5 pb-1.5 text-xs font-medium">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">{count}</span>
        <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/section:opacity-100 group-hover/section:opacity-100">
          {trailing}
          {secondaryActionAll && secondaryActionAllLabel && (
            <GroupHeaderButton
              label={secondaryActionAllLabel}
              icon={secondaryActionAllIcon}
              onClick={secondaryActionAll}
            />
          )}
          {onActionAll && (
            <GroupHeaderButton
              label={actionAllLabel}
              icon={actionAllIcon}
              onClick={onActionAll}
            />
          )}
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border/70 bg-card/40">
        <ul className="divide-y divide-border/60">{children}</ul>
        {footer}
      </div>
    </div>
  )
}

function DiffViewHeaderActions({
  splitView,
  onToggleSplitView,
  onCollapseAll,
}: {
  splitView: boolean
  onToggleSplitView: () => void
  onCollapseAll: () => void
}) {
  return (
    <>
      <GroupHeaderButton
        label={splitView ? "Unified view" : "Split view"}
        icon={
          splitView ? (
            <Rows2 className="size-3.5" />
          ) : (
            <Columns2 className="size-3.5" />
          )
        }
        onClick={onToggleSplitView}
      />
      <GroupHeaderButton
        label="Collapse all"
        icon={<ChevronsDownUp className="size-3.5" />}
        onClick={onCollapseAll}
      />
    </>
  )
}

function GroupHeaderButton({
  label,
  icon,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onClick}
            aria-label={label}
            className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/15 hover:text-foreground"
          >
            {icon}
          </button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function ShowMoreChangesButton({
  hiddenCount,
  onClick,
}: {
  hiddenCount: number
  onClick: () => void
}) {
  return (
    <div className="border-t border-border/60 p-1">
      <button
        type="button"
        onClick={onClick}
        className="w-full rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
      >
        Show {Math.min(hiddenCount, CHANGE_LIST_BATCH_SIZE)} more of{" "}
        {hiddenCount}
      </button>
    </div>
  )
}

function DiffStats({
  additions,
  deletions,
}: {
  additions?: number
  deletions?: number
}) {
  if (additions === undefined && deletions === undefined) return null

  return (
    <div className="flex shrink-0 items-center gap-1.5 font-mono text-xs font-medium tabular-nums">
      <span className="text-[#00c896]">+{additions ?? 0}</span>
      <span className="text-rose-400">-{deletions ?? 0}</span>
    </div>
  )
}

// Shows the full path in a tooltip (after a 3s hover) only when the
// label is actually truncated.
function TruncatedPathLabel({ path }: { path: string }) {
  const [truncated, setTruncated] = useState(false)
  const observe = useCallback((el: HTMLSpanElement | null) => {
    if (!el) return
    const check = () => setTruncated(el.scrollWidth > el.clientWidth)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <Tooltip disabled={!truncated}>
      <TooltipTrigger
        delay={3000}
        render={
          <span ref={observe} className="min-w-0 flex-1 truncate font-mono">
            {path.includes("/") && (
              <span className="text-muted-foreground">
                {path.slice(0, path.lastIndexOf("/") + 1)}
              </span>
            )}
            {path.slice(path.lastIndexOf("/") + 1)}
          </span>
        }
      />
      <TooltipContent className="font-mono break-all">{path}</TooltipContent>
    </Tooltip>
  )
}

type FileRowProps = {
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
}

function InlineDiffRow({
  expanded,
  viewMode,
  ...rowProps
}: FileRowProps & {
  expanded: boolean
  viewMode: "unified" | "split"
}) {
  return (
    <>
      <FileRow {...rowProps} />
      {expanded && (
        <li className="bg-background">
          <SingleFileDiff
            cwd={rowProps.cwd}
            path={rowProps.file.path}
            staged={rowProps.file.staged}
            viewMode={viewMode}
            onOpenFile={rowProps.onOpenFile}
            sharedWorkerPool
            hideFileHeader
            fitContent
          />
        </li>
      )}
    </>
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
}: FileRowProps) {
  const fileAbsPath = absolutePath(cwd, file.path)

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <li
            draggable
            onDragStart={(e) => setPathDragData(e.dataTransfer, [fileAbsPath])}
            onClick={onOpen}
            className="group/row flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent/40"
          >
            <FileIcon
              name={file.path.split("/").pop() ?? file.path}
              className="size-4 shrink-0"
            />
            <TruncatedPathLabel path={file.path} />
            <div className="relative flex h-5 shrink-0 items-center justify-end">
              <div className="flex items-center gap-2 transition-opacity group-hover/row:opacity-0">
                {STATUS_LABELS[file.status] && (
                  <span
                    className={cn(
                      "text-[11px]",
                      STATUS_STYLES[file.status] ?? "text-muted-foreground"
                    )}
                  >
                    {STATUS_LABELS[file.status]}
                  </span>
                )}
                <DiffStats
                  additions={file.additions}
                  deletions={file.deletions}
                />
              </div>
              <div className="absolute inset-y-0 right-0 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
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
                          className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/15 hover:text-foreground disabled:cursor-not-allowed"
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
                        className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/15 hover:text-foreground disabled:cursor-not-allowed"
                      >
                        {actionIcon}
                      </button>
                    }
                  />
                  <TooltipContent>{actionLabel}</TooltipContent>
                </Tooltip>
              </div>
            </div>
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
