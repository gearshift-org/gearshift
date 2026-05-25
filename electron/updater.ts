import { app, BrowserWindow, ipcMain } from "electron"
import pkg from "electron-updater"

const { autoUpdater } = pkg

export type UpdaterState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string }
  | { status: "downloading"; percent: number }
  | { status: "ready"; version: string }
  | { status: "error"; message: string }

const CHANNEL = "updater:state"
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

let lastState: UpdaterState = { status: "idle" }
let initialized = false
const stateChangeListeners: Array<(state: UpdaterState) => void> = []

export function getUpdaterState(): UpdaterState {
  return lastState
}

export function onUpdaterStateChange(cb: (state: UpdaterState) => void) {
  stateChangeListeners.push(cb)
}

function broadcast(next: UpdaterState) {
  // Stickiness: once an update is downloaded and ready to install, don't
  // downgrade the visible state to "checking" / "available" / "idle" just
  // because a background re-check ran. Only accept a strictly newer "ready"
  // version (or an error, so the user sees failures).
  if (lastState.status === "ready") {
    if (next.status === "ready") {
      if (next.version === lastState.version) return
    } else if (next.status !== "error") {
      return
    }
  }
  lastState = next
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(CHANNEL, next)
  }
  for (const cb of stateChangeListeners) cb(next)
}

export async function checkForUpdatesNow() {
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    broadcast({
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    })
  }
  return lastState
}

export function quitAndInstall() {
  autoUpdater.quitAndInstall()
}

export function initUpdater() {
  if (initialized) return
  initialized = true

  if (!app.isPackaged) {
    ipcMain.handle("updater:check", () => lastState)
    ipcMain.handle("updater:quitAndInstall", () => ({ ok: false, dev: true }))
    ipcMain.handle("updater:getState", () => lastState)
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on("checking-for-update", () =>
    broadcast({ status: "checking" })
  )
  autoUpdater.on("update-available", (info) =>
    broadcast({ status: "available", version: info.version })
  )
  autoUpdater.on("update-not-available", () =>
    broadcast({ status: "idle" })
  )
  autoUpdater.on("download-progress", (p) =>
    broadcast({ status: "downloading", percent: p.percent ?? 0 })
  )
  autoUpdater.on("update-downloaded", (info) =>
    broadcast({ status: "ready", version: info.version })
  )
  autoUpdater.on("error", (err) =>
    broadcast({ status: "error", message: err?.message ?? String(err) })
  )

  ipcMain.handle("updater:check", () => checkForUpdatesNow())
  ipcMain.handle("updater:quitAndInstall", () => {
    quitAndInstall()
    return { ok: true }
  })
  ipcMain.handle("updater:getState", () => lastState)

  void checkForUpdatesNow()
  setInterval(() => {
    void checkForUpdatesNow()
  }, CHECK_INTERVAL_MS)
}
