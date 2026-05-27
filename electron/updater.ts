import { app, BrowserWindow, dialog, ipcMain } from "electron"
import pkg from "electron-updater"
import logPkg from "electron-log"

const { autoUpdater } = pkg
const log = (logPkg as unknown as { default?: typeof logPkg }).default ?? logPkg

export type UpdaterState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string }
  | { status: "downloading"; percent: number }
  | { status: "ready"; version: string }
  | { status: "error"; message: string }

const CHANNEL = "updater:state"
const CHECK_INTERVAL_MS = 60 * 60 * 1000

type CheckForUpdatesOptions = {
  alertWhenNoUpdate?: boolean
  window?: BrowserWindow | null
}

let lastState: UpdaterState = { status: "idle" }
let initialized = false
let shouldAlertWhenNoUpdate = false
let noUpdateAlertWindow: BrowserWindow | null = null
const stateChangeListeners: Array<(state: UpdaterState) => void> = []

export function getUpdaterState(): UpdaterState {
  return lastState
}

export function onUpdaterStateChange(cb: (state: UpdaterState) => void) {
  stateChangeListeners.push(cb)
}

function getAlertWindow(window?: BrowserWindow | null) {
  return (
    window ??
    BrowserWindow.getFocusedWindow() ??
    BrowserWindow.getAllWindows().find((win) => !win.isDestroyed()) ??
    null
  )
}

function queueNoUpdateAlert(window?: BrowserWindow | null) {
  shouldAlertWhenNoUpdate = true
  noUpdateAlertWindow = getAlertWindow(window)
}

function clearNoUpdateAlert() {
  shouldAlertWhenNoUpdate = false
  noUpdateAlertWindow = null
}

async function showNoUpdateAlert(window?: BrowserWindow | null) {
  const options = {
    type: "info" as const,
    title: "No update available",
    message: "No update available",
    detail: `You are already using the latest version of ${app.getName()}.\n\nVersion ${app.getVersion()}`,
    buttons: ["OK"],
    defaultId: 0,
    noLink: true,
  }

  if (window && !window.isDestroyed()) {
    await dialog.showMessageBox(window, options)
    return
  }

  await dialog.showMessageBox(options)
}

function alertIfNoUpdateWasRequested() {
  if (!shouldAlertWhenNoUpdate) return
  const window = noUpdateAlertWindow
  clearNoUpdateAlert()
  void showNoUpdateAlert(window).catch((err) => {
    log.error("[updater] failed to show no-update alert", err)
  })
}

function broadcast(next: UpdaterState) {
  log.info("[updater] broadcast", { from: lastState, to: next })
  if (lastState.status === "ready") {
    if (next.status === "ready") {
      if (next.version === lastState.version) return
    } else if (next.status !== "error") {
      log.info("[updater] sticky ready - ignoring", next.status)
      return
    }
  }
  lastState = next
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(CHANNEL, next)
  }
  for (const cb of stateChangeListeners) cb(next)
}

export async function checkForUpdatesNow(options: CheckForUpdatesOptions = {}) {
  log.info("[updater] checkForUpdatesNow called, isPackaged=", app.isPackaged)
  if (options.alertWhenNoUpdate) queueNoUpdateAlert(options.window)
  if (!app.isPackaged) {
    alertIfNoUpdateWasRequested()
    return lastState
  }
  try {
    const result = await autoUpdater.checkForUpdates()
    log.info("[updater] checkForUpdates result", result?.updateInfo?.version)
  } catch (err) {
    clearNoUpdateAlert()
    log.error("[updater] checkForUpdates failed", err)
    broadcast({
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    })
  }
  return lastState
}

export function quitAndInstall() {
  log.info("[updater] quitAndInstall invoked")
  autoUpdater.quitAndInstall()
}

export function initUpdater() {
  if (initialized) return
  initialized = true

  log.transports.file.level = "info"
  log.info(
    "[updater] init - version",
    app.getVersion(),
    "isPackaged=",
    app.isPackaged,
    "logPath=",
    log.transports.file.getFile().path
  )

  ipcMain.handle("updater:getState", () => lastState)
  ipcMain.handle(
    "updater:check",
    (event, options?: { alertWhenNoUpdate?: boolean }) =>
      checkForUpdatesNow({
        alertWhenNoUpdate: options?.alertWhenNoUpdate,
        window: BrowserWindow.fromWebContents(event.sender),
      })
  )
  ipcMain.handle("updater:quitAndInstall", () => {
    if (!app.isPackaged) return { ok: false, dev: true }
    quitAndInstall()
    return { ok: true }
  })

  if (!app.isPackaged) {
    log.info("[updater] skipping autoUpdater wiring in dev")
    return
  }

  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on("checking-for-update", () => broadcast({ status: "checking" }))
  autoUpdater.on("update-available", (info) => {
    clearNoUpdateAlert()
    broadcast({ status: "available", version: info.version })
  })
  autoUpdater.on("update-not-available", () => {
    broadcast({ status: "idle" })
    alertIfNoUpdateWasRequested()
  })
  autoUpdater.on("download-progress", (p) => {
    clearNoUpdateAlert()
    broadcast({ status: "downloading", percent: p.percent ?? 0 })
  })
  autoUpdater.on("update-downloaded", (info) => {
    clearNoUpdateAlert()
    broadcast({ status: "ready", version: info.version })
  })
  autoUpdater.on("error", (err) => {
    clearNoUpdateAlert()
    broadcast({ status: "error", message: err?.message ?? String(err) })
  })

  void checkForUpdatesNow()
  setInterval(() => {
    void checkForUpdatesNow()
  }, CHECK_INTERVAL_MS)
}
