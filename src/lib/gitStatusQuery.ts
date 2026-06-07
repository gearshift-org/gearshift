export type GitStatus = "M" | "A" | "D" | "R" | "C" | "U" | string
export type GitFile = {
  path: string
  status: GitStatus
  staged: boolean
  additions?: number
  deletions?: number
}
export type PullRequestInfo = {
  number: number
  id: string
  title: string
  url: string
  headRefName?: string
  baseRefName?: string
  authorLogin?: string
  updatedAt?: string
}

export type CommitInfo = {
  hash: string
  shortHash: string
  authorName: string
  isoDate: string
  relativeDate: string
  subject: string
}

export type GitQueryData = {
  files: GitFile[]
  ahead: number
  behind: number
  hasUpstream: boolean
  currentBranch: string | null
  branches: string[]
  ghAvailable: boolean
  pullRequest: PullRequestInfo | null
  canCreatePullRequest: boolean
  notRepo: boolean
}

const NOT_A_REPO_RE = /not a git repository/i

export function isNotRepoError(message: string | null | undefined): boolean {
  return !!message && NOT_A_REPO_RE.test(message)
}

const EMPTY_NOT_REPO_DATA: GitQueryData = {
  files: [],
  ahead: 0,
  behind: 0,
  hasUpstream: false,
  currentBranch: null,
  branches: [],
  ghAvailable: false,
  pullRequest: null,
  canCreatePullRequest: false,
  notRepo: true,
}

export const EMPTY_GIT_FILES: GitFile[] = []

export const gitQueryKey = (cwd: string | null) => ["git", cwd] as const
export const gitPullRequestsQueryKey = (cwd: string | null) =>
  ["git", cwd, "pullRequests"] as const
export const gitLogQueryKey = (cwd: string | null) =>
  ["git", cwd, "commits"] as const

export async function fetchGitQueryData(cwd: string): Promise<GitQueryData> {
  const [status, ab, br] = await Promise.all([
    window.git.status(cwd),
    window.git.aheadBehind(cwd),
    window.git.branches(cwd),
  ])
  if (!status.ok) {
    if (isNotRepoError(status.error)) return EMPTY_NOT_REPO_DATA
    throw new Error(status.error ?? "Failed to load Git status")
  }
  const currentBranch = br.ok ? br.current : null
  const ahead = ab.ok ? ab.ahead : 0
  const hasUpstream = ab.ok ? ab.hasUpstream : false
  const pr = await window.git.pullRequestStatus(
    cwd,
    currentBranch,
    hasUpstream,
    ahead
  )
  return {
    files: [
      ...status.unstaged.map((f) => ({ ...f, staged: false }) as GitFile),
      ...status.staged.map((f) => ({ ...f, staged: true }) as GitFile),
    ],
    ahead,
    behind: ab.ok ? ab.behind : 0,
    hasUpstream,
    currentBranch,
    branches: br.ok ? br.branches : [],
    ghAvailable: pr.ghAvailable,
    pullRequest: pr.pullRequest,
    canCreatePullRequest: pr.canCreatePullRequest,
    notRepo: false,
  }
}

export function moveCachedGitFiles(
  data: GitQueryData | undefined,
  paths: string[],
  staged: boolean
): GitQueryData | undefined {
  if (!data) return data
  const pathSet = new Set(paths)
  const moved = new Map<string, GitFile>()
  const kept = data.files.filter((file) => {
    if (!pathSet.has(file.path) || file.staged === staged) return true
    if (!moved.has(file.path)) moved.set(file.path, file)
    return false
  })
  const existingTargets = new Set(
    kept
      .filter((file) => pathSet.has(file.path) && file.staged === staged)
      .map((file) => file.path)
  )
  const additions = paths.flatMap((path) => {
    if (existingTargets.has(path)) return []
    const file = moved.get(path)
    return file ? [{ ...file, staged }] : []
  })
  return { ...data, files: [...kept, ...additions] }
}

export function removeCachedGitFiles(
  data: GitQueryData | undefined,
  paths: string[],
  staged?: boolean
): GitQueryData | undefined {
  if (!data) return data
  const pathSet = new Set(paths)
  return {
    ...data,
    files: data.files.filter((file) => {
      if (!pathSet.has(file.path)) return true
      return staged !== undefined && file.staged !== staged
    }),
  }
}

export type OptimisticGitFileMove = {
  paths: string[]
  staged: boolean
  expiresAt: number
}

export type OptimisticGitFileRemoval = {
  paths: string[]
  staged?: boolean
  expiresAt: number
}

export function applyOptimisticGitFileMoves(
  data: GitQueryData,
  moves: OptimisticGitFileMove[],
  now = Date.now()
): GitQueryData {
  return moves
    .filter((move) => move.expiresAt > now)
    .reduce(
      (next, move) => moveCachedGitFiles(next, move.paths, move.staged) ?? next,
      data
    )
}

export function applyOptimisticGitFileRemovals(
  data: GitQueryData,
  removals: OptimisticGitFileRemoval[],
  now = Date.now()
): GitQueryData {
  return removals
    .filter((removal) => removal.expiresAt > now)
    .reduce(
      (next, removal) =>
        removeCachedGitFiles(next, removal.paths, removal.staged) ?? next,
      data
    )
}
