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

function broadcast(state: UpdaterState) {
  lastState = state
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(CHANNEL, state)
  }
}

export function initUpdater() {
  if (initialized) return
  initialized = true

  if (!app.isPackaged) {
    // electron-updater is a no-op in dev; skip wiring to avoid noisy errors.
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

  ipcMain.handle("updater:check", async () => {
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      broadcast({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      })
    }
    return lastState
  })

  ipcMain.handle("updater:quitAndInstall", () => {
    autoUpdater.quitAndInstall()
    return { ok: true }
  })

  ipcMain.handle("updater:getState", () => lastState)

  void autoUpdater.checkForUpdates().catch((err) => {
    broadcast({
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    })
  })
  setInterval(() => {
    void autoUpdater.checkForUpdates().catch(() => {})
  }, CHECK_INTERVAL_MS)
}
