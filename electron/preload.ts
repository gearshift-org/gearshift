import { contextBridge, ipcRenderer, webUtils } from "electron"

export type ChatHistoryMessage = {
  id: string
  sessionId: string
  projectId: string | null
  body: string
  agent: string | null
  createdAt: number
}

const dialogApi = {
  openProject: () =>
    ipcRenderer.invoke("dialog:openProject") as Promise<string | null>,
  openProjectAvatarImage: () =>
    ipcRenderer.invoke("dialog:openProjectAvatarImage") as Promise<
      string | null
    >,
  confirmTerminalClose: (opts: { count: number }) =>
    ipcRenderer.invoke("dialog:confirmTerminalClose", opts) as Promise<boolean>,
}

const shellApi = {
  openInVSCode: (path: string) =>
    ipcRenderer.invoke("shell:openInVSCode", path) as Promise<boolean>,
  revealInFinder: (path: string) =>
    ipcRenderer.invoke("shell:revealInFinder", path) as Promise<boolean>,
  openExternal: (url: string) =>
    ipcRenderer.invoke("shell:openExternal", url) as Promise<boolean>,
}

const termApi = {
  create: (opts: {
    cwd: string
    cols?: number
    rows?: number
    theme?: "light" | "dark"
    projectId?: string | null
    sessionId?: string
  }) => ipcRenderer.invoke("term:create", opts) as Promise<{ id: string }>,
  adopt: (sessionId: string, projectId?: string | null) =>
    ipcRenderer.invoke("term:adopt", sessionId, projectId ?? null) as Promise<{
      ok: boolean
      replay?: string
      cols?: number
      rows?: number
    }>,
  snapshot: (id: string) =>
    ipcRenderer.invoke("term:snapshot", id) as Promise<string>,
  write: (id: string, data: string) => ipcRenderer.send("term:write", id, data),
  resize: (id: string, cols: number, rows: number) =>
    ipcRenderer.send("term:resize", id, cols, rows),
  kill: (id: string) => ipcRenderer.send("term:kill", id),
  getCwd: (id: string) =>
    ipcRenderer.invoke("term:cwd", id) as Promise<string | null>,
  agentStatus: (id: string) =>
    ipcRenderer.invoke("term:agentStatus", id) as Promise<{
      running: boolean
      agentName?: "claude" | "codex" | "opencode" | "pi" | "gemini"
    }>,
  agentSessionTitle: (args: {
    agent: "claude" | "codex" | "opencode" | "pi" | "gemini"
    agentSessionId: string
  }) =>
    ipcRenderer.invoke("term:agentSessionTitle", args) as Promise<string | null>,
  onAgentEvent: (
    id: string,
    cb: (event: {
      agentName: "claude" | "codex" | "opencode" | "pi" | "gemini"
      event: "start" | "stop" | "needs_attention"
      body?: string
      agentSessionId?: string
    }) => void
  ) => {
    const channel = `term:agentEvent:${id}`
    const listener = (
      _e: unknown,
      event: {
        agentName: "claude" | "codex" | "opencode" | "pi" | "gemini"
        event: "start" | "stop" | "needs_attention"
        body?: string
      }
    ) => cb(event)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },
  onData: (id: string, cb: (chunk: string) => void) => {
    const channel = `term:data:${id}`
    const listener = (_e: unknown, chunk: string) => cb(chunk)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  onExit: (
    id: string,
    cb: (info: { exitCode: number; signal?: number }) => void
  ) => {
    const channel = `term:exit:${id}`
    const listener = (
      _e: unknown,
      info: { exitCode: number; signal?: number }
    ) => cb(info)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  history: {
    list: (sessionId: string) =>
      ipcRenderer.invoke("term:history:list", sessionId) as Promise<
        ChatHistoryMessage[]
      >,
    listProject: (projectId: string, limit?: number) =>
      ipcRenderer.invoke(
        "term:history:listProject",
        projectId,
        limit
      ) as Promise<ChatHistoryMessage[]>,
    clear: (sessionId: string) =>
      ipcRenderer.invoke("term:history:clear", sessionId) as Promise<{
        ok: boolean
      }>,
    clearProject: (projectId: string) =>
      ipcRenderer.invoke("term:history:clearProject", projectId) as Promise<{
        ok: boolean
      }>,
    migrateProjectIds: (migrations: Array<{ from: string; to: string }>) =>
      ipcRenderer.invoke("term:history:migrateProjectIds", migrations) as Promise<{
        ok: boolean
      }>,
    onProjectAppended: (
      projectId: string,
      cb: (msg: ChatHistoryMessage) => void
    ) => {
      const channel = `term:history:projectAppended:${projectId}`
      const listener = (_e: unknown, msg: ChatHistoryMessage) => cb(msg)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onProjectCleared: (projectId: string, cb: () => void) => {
      const channel = `term:history:projectCleared:${projectId}`
      const listener = () => cb()
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onProjectSessionCleared: (
      projectId: string,
      cb: (sessionId: string) => void
    ) => {
      const channel = `term:history:projectSessionCleared:${projectId}`
      const listener = (_e: unknown, sessionId: string) => cb(sessionId)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onAppended: (sessionId: string, cb: (msg: ChatHistoryMessage) => void) => {
      const channel = `term:history:appended:${sessionId}`
      const listener = (_e: unknown, msg: ChatHistoryMessage) => cb(msg)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
  },
}

const clipboardApi = {
  hasImage: () => ipcRenderer.invoke("clipboard:hasImage") as Promise<boolean>,
  getImagePath: () =>
    ipcRenderer.invoke("clipboard:getImagePath") as Promise<string | null>,
}

const appApi = {
  onNewTerminal: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on("app:new-terminal", listener)
    return () => {
      ipcRenderer.removeListener("app:new-terminal", listener)
    }
  },
  onCloseTerminal: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on("app:close-terminal", listener)
    return () => {
      ipcRenderer.removeListener("app:close-terminal", listener)
    }
  },
  takeOpenProjects: () =>
    ipcRenderer.invoke("app:takeOpenProjects") as Promise<string[]>,
  onOpenProjects: (cb: (paths: string[]) => void) => {
    const listener = (_e: unknown, paths: string[]) => cb(paths)
    ipcRenderer.on("app:open-projects", listener)
    return () => {
      ipcRenderer.removeListener("app:open-projects", listener)
    }
  },
}

const appWindowApi = {
  pointerState: (outsideLimit = 0) =>
    ipcRenderer.invoke("window:pointerState", outsideLimit) as Promise<{
      ok: boolean
      nearWindow: boolean
      cursor?: { x: number; y: number }
      bounds?: { x: number; y: number; width: number; height: number }
    }>,
  setWindowButtonVisibility: (visible: boolean) =>
    ipcRenderer.invoke("window:setWindowButtonVisibility", visible) as Promise<{
      ok: boolean
    }>,
  onBlur: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on("window:blur", listener)
    return () => ipcRenderer.removeListener("window:blur", listener)
  },
  onFocus: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on("window:focus", listener)
    return () => ipcRenderer.removeListener("window:focus", listener)
  },
}

const fsApi = {
  watchProject: (cwd: string) =>
    ipcRenderer.invoke("fs:watchProject", cwd) as Promise<{
      ok: boolean
      error?: string
      watchId?: string
    }>,
  unwatchProject: (watchId: string) =>
    ipcRenderer.send("fs:unwatchProject", watchId),
  onChanged: (
    cb: (event: { watchId: string; cwd: string; paths?: string[] }) => void
  ) => {
    const listener = (
      _e: unknown,
      event: { watchId: string; cwd: string; paths?: string[] }
    ) => cb(event)
    ipcRenderer.on("fs:changed", listener)
    return () => ipcRenderer.removeListener("fs:changed", listener)
  },
  readDir: (absPath: string) =>
    ipcRenderer.invoke("fs:readDir", absPath) as Promise<{
      ok: boolean
      error?: string
      entries: { name: string; isDir: boolean; ignored?: boolean }[]
    }>,
  stat: (absPath: string) =>
    ipcRenderer.invoke("fs:stat", absPath) as Promise<{
      ok: boolean
      error?: string
      isDir?: boolean
    }>,
  readFile: (absPath: string) =>
    ipcRenderer.invoke("fs:readFile", absPath) as Promise<{
      ok: boolean
      error?: string
      content?: string
      tooLarge?: boolean
      binary?: boolean
      size?: number
    }>,
  readImage: (absPath: string) =>
    ipcRenderer.invoke("fs:readImage", absPath) as Promise<{
      ok: boolean
      error?: string
      dataUrl?: string
      mime?: string
      size?: number
    }>,
  readAudio: (absPath: string) =>
    ipcRenderer.invoke("fs:readAudio", absPath) as Promise<{
      ok: boolean
      error?: string
      dataUrl?: string
      mime?: string
      size?: number
    }>,
  writeFile: (absPath: string, content: string) =>
    ipcRenderer.invoke("fs:writeFile", absPath, content) as Promise<{
      ok: boolean
      error?: string
    }>,
  createFile: (absPath: string) =>
    ipcRenderer.invoke("fs:createFile", absPath) as Promise<{
      ok: boolean
      error?: string
    }>,
  createDir: (absPath: string) =>
    ipcRenderer.invoke("fs:createDir", absPath) as Promise<{
      ok: boolean
      error?: string
    }>,
  move: (sourceAbsPath: string, targetDirAbsPath: string) =>
    ipcRenderer.invoke("fs:move", sourceAbsPath, targetDirAbsPath) as Promise<{
      ok: boolean
      error?: string
    }>,
  copy: (sourceAbsPath: string, targetDirAbsPath: string) =>
    ipcRenderer.invoke("fs:copy", sourceAbsPath, targetDirAbsPath) as Promise<{
      ok: boolean
      error?: string
    }>,
  rename: (sourceAbsPath: string, newName: string) =>
    ipcRenderer.invoke("fs:rename", sourceAbsPath, newName) as Promise<{
      ok: boolean
      error?: string
      newPath?: string
    }>,
  trash: (absPath: string) =>
    ipcRenderer.invoke("fs:trash", absPath) as Promise<{
      ok: boolean
      error?: string
    }>,
  listAllFiles: (cwd: string) =>
    ipcRenderer.invoke("fs:listAllFiles", cwd) as Promise<{
      ok: boolean
      error?: string
      files: string[]
    }>,
  searchContents: (cwd: string, query: string) =>
    ipcRenderer.invoke("fs:searchContents", cwd, query) as Promise<{
      ok: boolean
      error?: string
      results: { path: string; line: number; text: string }[]
      truncated?: boolean
    }>,
}

type GitFileRaw = {
  path: string
  status: string
}

type PullRequestInfo = {
  number: number
  id: string
  title: string
  url: string
}

const gitApi = {
  status: (cwd: string) =>
    ipcRenderer.invoke("git:status", cwd) as Promise<{
      ok: boolean
      error?: string
      staged: GitFileRaw[]
      unstaged: GitFileRaw[]
    }>,
  diffAll: (cwd: string) =>
    ipcRenderer.invoke("git:diffAll", cwd) as Promise<{
      ok: boolean
      error?: string
      unstagedPatch: string
      stagedPatch: string
    }>,
  diffFile: (cwd: string, path: string, staged: boolean) =>
    ipcRenderer.invoke("git:diffFile", cwd, path, staged) as Promise<{
      ok: boolean
      error?: string
      patch: string
    }>,
  readDiffMedia: (
    cwd: string,
    path: string,
    staged: boolean,
    kind: "image" | "audio"
  ) =>
    ipcRenderer.invoke("git:readDiffMedia", cwd, path, staged, kind) as Promise<{
      ok: boolean
      error?: string
      dataUrl?: string
      mime?: string
      size?: number
    }>,
  stage: (cwd: string, paths: string[]) =>
    ipcRenderer.invoke("git:stage", cwd, paths) as Promise<{
      ok: boolean
      error?: string
    }>,
  unstage: (cwd: string, paths: string[]) =>
    ipcRenderer.invoke("git:unstage", cwd, paths) as Promise<{
      ok: boolean
      error?: string
    }>,
  commit: (cwd: string, message: string) =>
    ipcRenderer.invoke("git:commit", cwd, message) as Promise<{
      ok: boolean
      error?: string
    }>,
  push: (cwd: string) =>
    ipcRenderer.invoke("git:push", cwd) as Promise<{
      ok: boolean
      error?: string
    }>,
  publishBranch: (cwd: string, branch: string) =>
    ipcRenderer.invoke("git:publishBranch", cwd, branch) as Promise<{
      ok: boolean
      error?: string
    }>,
  pull: (cwd: string) =>
    ipcRenderer.invoke("git:pull", cwd) as Promise<{
      ok: boolean
      error?: string
    }>,
  aheadBehind: (cwd: string) =>
    ipcRenderer.invoke("git:aheadBehind", cwd) as Promise<{
      ok: boolean
      ahead: number
      behind: number
      hasUpstream: boolean
    }>,
  discard: (cwd: string, paths: string[]) =>
    ipcRenderer.invoke("git:discard", cwd, paths) as Promise<{
      ok: boolean
      error?: string
    }>,
  branches: (cwd: string) =>
    ipcRenderer.invoke("git:branches", cwd) as Promise<{
      ok: boolean
      error?: string
      current: string | null
      branches: string[]
    }>,
  checkout: (cwd: string, branch: string) =>
    ipcRenderer.invoke("git:checkout", cwd, branch) as Promise<{
      ok: boolean
      error?: string
    }>,
  createBranch: (cwd: string, branch: string) =>
    ipcRenderer.invoke("git:createBranch", cwd, branch) as Promise<{
      ok: boolean
      error?: string
    }>,
  pullRequestStatus: (
    cwd: string,
    currentBranch: string | null,
    hasUpstream: boolean,
    ahead: number
  ) =>
    ipcRenderer.invoke(
      "git:pullRequestStatus",
      cwd,
      currentBranch,
      hasUpstream,
      ahead
    ) as Promise<{
      ok: boolean
      error?: string
      ghAvailable: boolean
      pullRequest: PullRequestInfo | null
      canCreatePullRequest: boolean
    }>,
  openPullRequest: (cwd: string, number: number) =>
    ipcRenderer.invoke("git:openPullRequest", cwd, number) as Promise<{
      ok: boolean
      error?: string
    }>,
  openBranchOnGitHub: (cwd: string, branch: string) =>
    ipcRenderer.invoke("git:openBranchOnGitHub", cwd, branch) as Promise<{
      ok: boolean
      error?: string
    }>,
  createPullRequest: (cwd: string, branch: string) =>
    ipcRenderer.invoke("git:createPullRequest", cwd, branch) as Promise<{
      ok: boolean
      error?: string
    }>,
}

const electronUtils = {
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
}

const stateApi = {
  read: () =>
    ipcRenderer.invoke("state:read") as Promise<Record<string, string>>,
  write: (data: Record<string, string>) =>
    ipcRenderer.invoke("state:write", data) as Promise<{ ok: true }>,
}

const menuApi = {
  updateAccelerators: (
    map: Partial<{ "terminal.new": string; "terminal.close": string }>
  ) =>
    ipcRenderer.invoke("menu:update-accelerators", map) as Promise<{
      ok: true
    }>,
  showEditContext: (flags: {
    canCut?: boolean
    canCopy?: boolean
    canPaste?: boolean
  }) =>
    ipcRenderer.invoke("menu:showEditContext", flags) as Promise<
      "cut" | "copy" | "paste" | null
    >,
}

contextBridge.exposeInMainWorld("dialogApi", dialogApi)
contextBridge.exposeInMainWorld("shellApi", shellApi)
contextBridge.exposeInMainWorld("term", termApi)
contextBridge.exposeInMainWorld("clipboardApi", clipboardApi)
contextBridge.exposeInMainWorld("electronUtils", electronUtils)
contextBridge.exposeInMainWorld("appApi", appApi)
contextBridge.exposeInMainWorld("appWindow", appWindowApi)
contextBridge.exposeInMainWorld("git", gitApi)
contextBridge.exposeInMainWorld("fsApi", fsApi)
contextBridge.exposeInMainWorld("stateApi", stateApi)
contextBridge.exposeInMainWorld("menuApi", menuApi)

type UpdaterState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string }
  | { status: "downloading"; percent: number }
  | { status: "ready"; version: string }
  | { status: "error"; message: string }

const updaterApi = {
  getState: () => ipcRenderer.invoke("updater:getState") as Promise<UpdaterState>,
  check: (options?: { alertWhenNoUpdate?: boolean }) =>
    ipcRenderer.invoke("updater:check", options) as Promise<UpdaterState>,
  quitAndInstall: () =>
    ipcRenderer.invoke("updater:quitAndInstall") as Promise<{ ok: boolean }>,
  onState: (cb: (state: UpdaterState) => void) => {
    const handler = (_: unknown, state: UpdaterState) => cb(state)
    ipcRenderer.on("updater:state", handler)
    return () => {
      ipcRenderer.removeListener("updater:state", handler)
    }
  },
}

contextBridge.exposeInMainWorld("updaterApi", updaterApi)

export type UpdaterApi = typeof updaterApi
export type { UpdaterState }

export type DialogApi = typeof dialogApi
export type ShellApi = typeof shellApi
export type TermApi = typeof termApi
export type ClipboardApi = typeof clipboardApi
export type ElectronUtils = typeof electronUtils
export type AppApi = typeof appApi
export type AppWindowApi = typeof appWindowApi
export type GitApi = typeof gitApi
export type FsApi = typeof fsApi
export type StateApi = typeof stateApi
export type MenuApi = typeof menuApi
