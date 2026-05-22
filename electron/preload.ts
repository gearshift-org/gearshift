import { contextBridge, ipcRenderer, webUtils } from "electron"

const dialogApi = {
  openProject: () =>
    ipcRenderer.invoke("dialog:openProject") as Promise<string | null>,
}

const termApi = {
  create: (opts: { cwd: string; cols?: number; rows?: number }) =>
    ipcRenderer.invoke("term:create", opts) as Promise<{ id: string }>,
  write: (id: string, data: string) =>
    ipcRenderer.send("term:write", id, data),
  resize: (id: string, cols: number, rows: number) =>
    ipcRenderer.send("term:resize", id, cols, rows),
  kill: (id: string) => ipcRenderer.send("term:kill", id),
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
}

const electronUtils = {
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
}

contextBridge.exposeInMainWorld("dialogApi", dialogApi)
contextBridge.exposeInMainWorld("term", termApi)
contextBridge.exposeInMainWorld("clipboardApi", clipboardApi)
contextBridge.exposeInMainWorld("electronUtils", electronUtils)
contextBridge.exposeInMainWorld("appApi", appApi)
contextBridge.exposeInMainWorld("git", gitApi)

export type DialogApi = typeof dialogApi
export type TermApi = typeof termApi
export type ClipboardApi = typeof clipboardApi
export type ElectronUtils = typeof electronUtils
export type AppApi = typeof appApi
export type GitApi = typeof gitApi
