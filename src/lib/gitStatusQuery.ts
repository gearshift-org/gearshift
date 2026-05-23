export type GitStatus = "M" | "A" | "D" | "R" | "C" | "U" | string
export type GitFile = { path: string; status: GitStatus; staged: boolean }
export type PullRequestInfo = {
  number: number
  id: string
  title: string
  url: string
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
}

export const EMPTY_GIT_FILES: GitFile[] = []

export const gitQueryKey = (cwd: string | null) => ["git", cwd] as const

export async function fetchGitQueryData(cwd: string): Promise<GitQueryData> {
  const [status, ab, br] = await Promise.all([
    window.git.status(cwd),
    window.git.aheadBehind(cwd),
    window.git.branches(cwd),
  ])
  if (!status.ok) throw new Error(status.error ?? "Failed to load Git status")
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
