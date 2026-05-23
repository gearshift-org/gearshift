import { contextBridge, ipcRenderer, webUtils } from "electron";

const dialogApi = {
  openProject: () =>
    ipcRenderer.invoke("dialog:openProject") as Promise<string | null>,
}

const shellApi = {
  openInVSCode: (path: string) =>
    ipcRenderer.invoke("shell:openInVSCode", path) as Promise<boolean>,
}

const termApi = {
  create: (opts: { cwd: string; cols?: number; rows?: number }) =>
    ipcRenderer.invoke("term:create", opts) as Promise<{ id: string }>,
  write: (id: string, data: string) =>
    ipcRenderer.send("term:write", id, data),
  resize: (id: string, cols: number, rows: number) =>
    ipcRenderer.send("term:resize", id, cols, rows),
  kill: (id: string) => ipcRenderer.send("term:kill", id),
  getCwd: (id: string) =>
    ipcRenderer.invoke("term:cwd", id) as Promise<string | null>,
  onData: (id: string, cb: (chunk: string) => void) => {
    const channel = `term:data:${id}`
    const listener = (_e: unknown, chunk: string) => cb(chunk)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  onExit: (
    id: string,
    cb: (info: { exitCode: number; signal?: number }) => void,
  ) => {
    const channel = `term:exit:${id}`
    const listener = (
      _e: unknown,
      info: { exitCode: number; signal?: number },
    ) => cb(info)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
}

const clipboardApi = {
  hasImage: () => ipcRenderer.invoke("clipboard:hasImage") as Promise<boolean>,
}

const appApi = {
  onNewTerminal: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on("app:new-terminal", listener)
    return () => ipcRenderer.removeListener("app:new-terminal", listener)
  },
  onCloseTerminal: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on("app:close-terminal", listener)
    return () => ipcRenderer.removeListener("app:close-terminal", listener)
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
    cb: (event: { watchId: string; cwd: string; paths?: string[] }) => void,
  ) => {
    const listener = (
      _e: unknown,
      event: { watchId: string; cwd: string; paths?: string[] },
    ) => cb(event)
    ipcRenderer.on("fs:changed", listener)
    return () => ipcRenderer.removeListener("fs:changed", listener)
  },
  readDir: (absPath: string) =>
    ipcRenderer.invoke("fs:readDir", absPath) as Promise<{
      ok: boolean
      error?: string
      entries: { name: string; isDir: boolean }[]
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
  writeFile: (absPath: string, content: string) =>
    ipcRenderer.invoke("fs:writeFile", absPath, content) as Promise<{
      ok: boolean
      error?: string
    }>,
  listAllFiles: (cwd: string) =>
    ipcRenderer.invoke("fs:listAllFiles", cwd) as Promise<{
      ok: boolean
      error?: string
      files: string[]
    }>,
}

type GitFileRaw = {
  path: string
  status: string
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

contextBridge.exposeInMainWorld("dialogApi", dialogApi)
contextBridge.exposeInMainWorld("shellApi", shellApi)
contextBridge.exposeInMainWorld("term", termApi)
contextBridge.exposeInMainWorld("clipboardApi", clipboardApi)
contextBridge.exposeInMainWorld("electronUtils", electronUtils)
contextBridge.exposeInMainWorld("appApi", appApi)
contextBridge.exposeInMainWorld("git", gitApi)
contextBridge.exposeInMainWorld("fsApi", fsApi)
contextBridge.exposeInMainWorld("stateApi", stateApi)

export type DialogApi = typeof dialogApi
export type ShellApi = typeof shellApi
export type TermApi = typeof termApi
export type ClipboardApi = typeof clipboardApi
export type ElectronUtils = typeof electronUtils
export type AppApi = typeof appApi
export type GitApi = typeof gitApi
export type FsApi = typeof fsApi
export type StateApi = typeof stateApi
