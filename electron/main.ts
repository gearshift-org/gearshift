import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
} from "electron"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFile, spawn } from "node:child_process"
import net from "node:net"
import os from "node:os"
import { promisify } from "node:util"
import fs from "node:fs/promises"
import { readFileSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import parcelWatcher from "@parcel/watcher"
import {
  initUpdater,
  getUpdaterState,
  onUpdaterStateChange,
  checkForUpdatesNow,
  quitAndInstall,
} from "./updater"
import { ensureDaemonRunning } from "./daemonSupervisor"
import { ensureCliInstalled } from "./cliInstaller"
import { DaemonClient } from "./pty-daemon/client"
import { buildOpenOptions } from "./pty-daemon/spawnOpts"
import * as appDb from "./db/appDb"
import * as inputCapture from "./inputCapture"
import {
  closeAgentHookServer,
  hookEnv,
  installAgentHooks,
  startAgentHookServer,
  type AgentHookEvent,
  type TerminalAgentName,
} from "./agentHooks"
import { getAgentSessionTitle } from "./agentSessionTitle"
import {
  startHistoryServer,
  closeHistoryServer,
  getHistoryServerPort,
  type HistoryServerProject,
} from "./historyServer"

type ParcelSubscription = Awaited<ReturnType<typeof parcelWatcher.subscribe>>

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const execFileP = promisify(execFile)

function searchTokens(query: string): string[] {
  return query.toLowerCase().match(/[a-z0-9_]+/g) ?? []
}

function hasTokensInOrder(text: string, tokens: string[]): boolean {
  const haystack = text.toLowerCase()
  let index = 0
  for (const token of tokens) {
    const found = haystack.indexOf(token, index)
    if (found === -1) return false
    index = found + token.length
  }
  return true
}

type PullRequestInfo = {
  number: number
  id: string
  title: string
  url: string
  headRefName?: string
  baseRefName?: string
  authorLogin?: string
  createdAt?: string
  updatedAt?: string
}

type AgentStatusInfo = {
  running: boolean
  agentName?: TerminalAgentName
}

app.setName("GearShift")
if (process.platform === "win32") {
  app.setAppUserModelId("com.gearshift")
}

if (VITE_DEV_SERVER_URL) {
  app.setPath("userData", path.join(app.getPath("appData"), "gearshift-dev"))
  // If vite is killed hard (SIGKILL) it can't clean up this child process,
  // leaving an orphan that holds the single-instance lock. Quit when our
  // parent disappears (ppid becomes 1).
  setInterval(() => {
    if (process.ppid === 1) app.exit(0)
  }, 2000).unref()
} else {
  // Use the bundle id as the userData folder name so cleanup tools can
  // correlate leftover state to the app.
  app.setPath("userData", path.join(app.getPath("appData"), "com.gearshift"))
}

let daemonClient: DaemonClient | null = null
let daemonConnectPromise: Promise<DaemonClient> | null = null
let pendingCliProjectPaths: string[] = []
const readyWebContents = new Set<number>()
let cliOpenServer: net.Server | null = null

function cliProjectPaths(argv: string[], cwd = process.cwd()): string[] {
  const paths: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--open-project") {
      const value = argv[i + 1]
      if (value) {
        paths.push(path.resolve(cwd, value))
        i += 1
      }
      continue
    }
    if (arg.startsWith("--open-project=")) {
      paths.push(path.resolve(cwd, arg.slice("--open-project=".length)))
    }
  }
  return paths
}

async function validProjectPaths(paths: string[]): Promise<string[]> {
  const out: string[] = []
  const seen = new Set<string>()
  for (const projectPath of paths) {
    try {
      const resolved = path.resolve(projectPath)
      if (seen.has(resolved)) continue
      const stat = await fs.stat(resolved)
      if (!stat.isDirectory()) continue
      seen.add(resolved)
      out.push(resolved)
    } catch {
      // Ignore missing/non-directory paths; the CLI should only open folders.
    }
  }
  return out
}

function cliOpenSocketPath() {
  return path.join(app.getPath("userData"), "cli-open.sock")
}

async function startCliOpenServer() {
  if (process.platform === "win32" || cliOpenServer) return
  const socketPath = cliOpenSocketPath()
  await fs.mkdir(path.dirname(socketPath), { recursive: true })
  try {
    await fs.unlink(socketPath)
  } catch {
    // Missing/stale socket is fine.
  }

  cliOpenServer = net.createServer((socket) => {
    let raw = ""
    socket.setEncoding("utf8")
    socket.on("data", (chunk) => {
      raw += chunk
    })
    socket.on("end", () => {
      try {
        const parsed = JSON.parse(raw) as { paths?: unknown }
        const paths = Array.isArray(parsed.paths)
          ? parsed.paths.filter((p): p is string => typeof p === "string")
          : []
        void sendCliProjectPaths(paths)
      } catch {
        // Ignore malformed CLI requests.
      }
    })
  })
  cliOpenServer.on("error", (err) => {
    console.warn("[cli] open server failed", err)
  })
  cliOpenServer.listen(socketPath)
}

async function sendCliProjectPaths(paths: string[]) {
  const valid = await validProjectPaths(paths)
  if (valid.length === 0) return
  const win =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (
    !win ||
    win.webContents.isDestroyed() ||
    !readyWebContents.has(win.webContents.id)
  ) {
    pendingCliProjectPaths.push(...valid)
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send("app:open-projects", valid)
}

// Single source of truth for the daemon connection. Reconnects transparently
// after a daemon crash or its idle-exit so the renderer doesn't have to
// restart the whole app to use terminals again.
async function getDaemonClient(): Promise<DaemonClient> {
  if (daemonClient) return daemonClient
  if (daemonConnectPromise) return daemonConnectPromise
  daemonConnectPromise = (async () => {
    const handle = await ensureDaemonRunning()
    const client = new DaemonClient(handle.socket)
    client.onDisconnect(() => {
      if (daemonClient === client) {
        daemonClient = null
        sessionOwners.clear()
      }
    })
    await client.connect()
    daemonClient = client
    return client
  })()
  try {
    return await daemonConnectPromise
  } finally {
    daemonConnectPromise = null
  }
}
// Owner mapping: sessionId → webContents.id. Lets us route per-session data
// and exit events back to the window that opened/adopted the session, even
// when multiple windows are open.
const sessionOwners = new Map<string, number>()
// sessionId → projectId for tagging captured input lines. Populated on
// term:create and cleared on session exit/kill.
const sessionProjects = new Map<string, string | null>()

function getOwnerWebContents(sessionId: string) {
  const id = sessionOwners.get(sessionId)
  if (id == null) return null
  return (
    BrowserWindow.getAllWindows().find((w) => w.webContents.id === id)
      ?.webContents ?? null
  )
}

function sendAgentHookEvent(sessionId: string, event: AgentHookEvent) {
  const sender = getOwnerWebContents(sessionId)
  if (!sender || sender.isDestroyed()) return
  sender.send(`term:agentEvent:${sessionId}`, event)
}

async function captureInput(sessionId: string, data: string) {
  const projectId = sessionProjects.get(sessionId) ?? null
  // Skip the process-tree walk for chunks without a submit — Enter is the
  // only event that triggers a DB write.
  let agent: string | null = null
  if (data.includes("\r") || data.includes("\n")) {
    const pid = daemonClient?.getPid(sessionId)
    if (pid) {
      const status = await detectPtyAgent(pid)
      agent = status.running ? (status.agentName ?? null) : null
    }
  }
  inputCapture.feed(sessionId, projectId, data, agent, (msg) => {
    const sender = getOwnerWebContents(sessionId)
    if (sender && !sender.isDestroyed()) {
      sender.send(`term:history:appended:${sessionId}`, msg)
      if (msg.projectId) {
        sender.send(`term:history:projectAppended:${msg.projectId}`, msg)
      }
    }
  })
}

function wireSessionEvents(client: DaemonClient, sessionId: string) {
  client.onData(sessionId, (chunk) => {
    const sender = getOwnerWebContents(sessionId)
    if (!sender || sender.isDestroyed()) return
    sender.send(`term:data:${sessionId}`, chunk)
  })
  client.onExit(sessionId, (info) => {
    const sender = getOwnerWebContents(sessionId)
    if (sender && !sender.isDestroyed()) {
      sender.send(`term:exit:${sessionId}`, info)
    }
    sessionOwners.delete(sessionId)
    sessionProjects.delete(sessionId)
    sessionLastEnter.delete(sessionId)
    runningShellCommands.delete(sessionId)
    inputCapture.dispose(sessionId)
  })
}

interface StoredPaneShape {
  id: string
  sessionId?: string
}
interface StoredTabShape {
  id: string
  panes?: StoredPaneShape[]
}
interface StoredProjectShape {
  tabs?: StoredTabShape[]
}

// Sync read of the persisted project list (id/name/path) for the local history
// server's id → name enrichment. Reads the state file directly to stay sync and
// side-effect free; called only on the rare HTTP request.
function historyServerProjects(): HistoryServerProject[] {
  try {
    const raw = readFileSync(stateFilePath(), "utf8")
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const projectsRaw = parsed["gearshift.projects"]
    if (typeof projectsRaw !== "string") return []
    const projects = JSON.parse(projectsRaw) as unknown
    if (!Array.isArray(projects)) return []
    return projects
      .filter(
        (p): p is { id: string; name?: string; path?: string } =>
          !!p &&
          typeof p === "object" &&
          typeof (p as { id?: unknown }).id === "string"
      )
      .map((p) => ({
        id: p.id,
        ...(typeof p.name === "string" ? { name: p.name } : {}),
        ...(typeof p.path === "string" ? { path: p.path } : {}),
      }))
  } catch {
    return []
  }
}

async function collectPersistedSessionIds(): Promise<Set<string>> {
  const state = await readState()
  const raw = state["gearshift.projects"]
  const out = new Set<string>()
  if (!raw) return out
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return out
    for (const project of parsed as StoredProjectShape[]) {
      if (!project?.tabs) continue
      for (const tab of project.tabs) {
        if (!tab?.panes) continue
        for (const pane of tab.panes) {
          if (typeof pane?.sessionId === "string") out.add(pane.sessionId)
        }
      }
    }
  } catch {
    // ignore malformed state — keep an empty set so we don't accidentally
    // kill live daemon sessions just because the JSON is busted.
  }
  return out
}

async function reconcileDaemonSessions(): Promise<void> {
  if (!daemonClient) return
  try {
    const live = await daemonClient.list()
    const persisted = await collectPersistedSessionIds()
    let killed = 0
    for (const session of live) {
      if (!persisted.has(session.sessionId)) {
        daemonClient.kill(session.sessionId)
        killed += 1
      }
    }
    if (killed > 0) {
      console.log(`[pty-daemon] reconcile: killed ${killed} orphan session(s)`)
    }
  } catch (err) {
    console.warn("[pty-daemon] reconcile failed", err)
  }
}

const projectWatchers = new Map<
  string,
  {
    cwd: string
    subscription: ParcelSubscription
    paths: Set<string>
    timer?: NodeJS.Timeout
  }
>()

const WATCHER_IGNORE_BASE = ["**/.git/**", "**/.DS_Store"]

// VSCode's default `files.exclude` set: the only entries hidden from the
// Explorer tree out of the box. Everything else (including node_modules and
// gitignored files) is shown — matching VSCode, where ignored files are
// reachable by expanding the tree, while search still excludes them.
// Source: vscode src/vs/workbench/contrib/files/browser/files.contribution.ts
const VSCODE_DEFAULT_EXCLUDED_NAMES = new Set([
  ".git",
  ".svn",
  ".hg",
  ".DS_Store",
  "Thumbs.db",
])

function isAllowlistedDotenv(name: string) {
  return name === ".env" || name.startsWith(".env.")
}

function supportedAgentName(command: string): AgentStatusInfo["agentName"] {
  const lower = command.toLowerCase()
  const tokens = lower.trim().split(/\s+/)
  const basenames = tokens.map((token) =>
    path.basename(token).replace(/\.(js|ts|mjs|cjs)$/, "")
  )

  // Path-component matches let us recognize agents launched via their node/bun
  // wrappers, where the executable basename is just "node"/"bun" and only the
  // script path identifies the agent (e.g. node /…/@anthropic-ai/claude-code/cli.js).
  const hasPathSegment = (segment: string) =>
    tokens.some(
      (token) => token.includes(`/${segment}/`) || token.endsWith(`/${segment}`)
    )

  if (
    basenames.some((base) => base === "claude" || base === "claude-code") ||
    hasPathSegment("claude-code") ||
    hasPathSegment("@anthropic-ai/claude-code")
  ) {
    return "claude"
  }
  if (
    basenames.some((base) => base === "codex" || base === "codex-cli") ||
    hasPathSegment("codex") ||
    hasPathSegment("codex-cli") ||
    hasPathSegment("@openai/codex")
  ) {
    return "codex"
  }
  if (
    basenames.some((base) => base === "opencode") ||
    hasPathSegment("opencode") ||
    hasPathSegment("@opencode/cli") ||
    hasPathSegment("sst/opencode")
  ) {
    return "opencode"
  }
  if (
    basenames.some((base) => base === "pi") ||
    hasPathSegment("pi-coding-agent") ||
    hasPathSegment("@earendil-works/pi-coding-agent") ||
    hasPathSegment("@mariozechner/pi-coding-agent")
  ) {
    return "pi"
  }
  return undefined
}

async function listProcessChildren(): Promise<
  Map<number, Array<{ pid: number; command: string }>>
> {
  const { stdout } = await execFileP("/bin/ps", ["-axo", "pid=,ppid=,command="])
  const childrenByParent = new Map<
    number,
    Array<{ pid: number; command: string }>
  >()

  for (const line of stdout.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)
    if (!match) continue
    const pid = Number(match[1])
    const ppid = Number(match[2])
    const command = match[3]?.trim() ?? ""
    if (!pid || !ppid || !command) continue
    const children = childrenByParent.get(ppid) ?? []
    children.push({ pid, command })
    childrenByParent.set(ppid, children)
  }
  return childrenByParent
}

async function detectPtyAgent(rootPid: number): Promise<AgentStatusInfo> {
  if (process.platform === "win32") return { running: false }

  try {
    const childrenByParent = await listProcessChildren()
    const queue = [...(childrenByParent.get(rootPid) ?? [])]
    const seen = new Set<number>()
    while (queue.length > 0) {
      const proc = queue.shift()!
      if (seen.has(proc.pid)) continue
      seen.add(proc.pid)
      const agentName = supportedAgentName(proc.command)
      if (agentName) return { running: true, agentName }
      queue.push(...(childrenByParent.get(proc.pid) ?? []))
    }
  } catch {
    // Process inspection is best-effort; the UI falls back to no agent.
  }

  return { running: false }
}

// Shell command completion tracking: poll the process tree and, when a
// non-agent foreground command that ran for at least MIN_NOTIFY_COMMAND_MS
// finishes, tell the owning renderer so it can show a desktop notification.
const MIN_NOTIFY_COMMAND_MS = 5000
const COMMAND_POLL_INTERVAL_MS = 1500
const runningShellCommands = new Map<
  string,
  { startedAt: number; command: string; notify: boolean }
>()
// sessionId → time of the user's last Enter keypress. A command only arms a
// completion notification when the user submitted it manually just before it
// started — programmatic/agent-spawned processes stay silent.
const sessionLastEnter = new Map<string, number>()
const MANUAL_SUBMIT_WINDOW_MS = 3000
let pollingShellCommands = false

async function pollShellCommands() {
  if (process.platform === "win32") return
  if (!daemonClient || sessionOwners.size === 0) {
    runningShellCommands.clear()
    return
  }
  if (pollingShellCommands) return
  pollingShellCommands = true
  try {
    const childrenByParent = await listProcessChildren()
    for (const sessionId of sessionOwners.keys()) {
      const pid = daemonClient?.getPid(sessionId)
      if (!pid) {
        runningShellCommands.delete(sessionId)
        continue
      }
      const queue = [...(childrenByParent.get(pid) ?? [])]
      const seen = new Set<number>()
      let firstCommand: string | null = null
      let agent = false
      while (queue.length > 0) {
        const proc = queue.shift()!
        if (seen.has(proc.pid)) continue
        seen.add(proc.pid)
        if (!firstCommand) firstCommand = proc.command
        if (supportedAgentName(proc.command)) agent = true
        queue.push(...(childrenByParent.get(proc.pid) ?? []))
      }

      const current = runningShellCommands.get(sessionId)
      if (firstCommand) {
        if (!current) {
          const lastEnter = sessionLastEnter.get(sessionId) ?? 0
          const manuallySubmitted =
            Date.now() - lastEnter <= MANUAL_SUBMIT_WINDOW_MS
          runningShellCommands.set(sessionId, {
            startedAt: Date.now(),
            command: firstCommand,
            notify: manuallySubmitted && !agent,
          })
        } else if (agent) {
          // An agent launched mid-command (or was detected late) — agent
          // lifecycle hooks own notifications for this session.
          current.notify = false
        }
      } else if (current) {
        runningShellCommands.delete(sessionId)
        const durationMs = Date.now() - current.startedAt
        if (current.notify && durationMs >= MIN_NOTIFY_COMMAND_MS) {
          getOwnerWebContents(sessionId)?.send("term:commandDone", {
            sessionId,
            command: current.command,
            durationMs,
          })
        }
      }
    }
  } catch {
    // Process inspection is best-effort.
  } finally {
    pollingShellCommands = false
  }
}

setInterval(() => void pollShellCommands(), COMMAND_POLL_INTERVAL_MS)

type WindowState = {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized?: boolean
}

function windowStatePath(): string {
  return path.join(app.getPath("userData"), "window-state.json")
}

function readWindowStateSync(): WindowState | null {
  try {
    const raw = readFileSync(windowStatePath(), "utf8")
    const parsed = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed.width === "number" &&
      typeof parsed.height === "number" &&
      parsed.width >= 400 &&
      parsed.height >= 300
    ) {
      return parsed as WindowState
    }
  } catch {
    // missing or corrupt → fall back to defaults
  }
  return null
}

function clampWindowStateToDisplay(state: WindowState): WindowState {
  if (state.x === undefined || state.y === undefined) return state
  const displays = screen.getAllDisplays()
  const onScreen = displays.some((d) => {
    const a = d.workArea
    return (
      state.x! < a.x + a.width &&
      state.x! + state.width > a.x &&
      state.y! < a.y + a.height &&
      state.y! + state.height > a.y
    )
  })
  if (onScreen) return state
  return {
    width: state.width,
    height: state.height,
    isMaximized: state.isMaximized,
  }
}

let windowStateWriteTimer: NodeJS.Timeout | undefined
let lastNormalBounds: {
  width: number
  height: number
  x: number
  y: number
} | null = null
function persistWindowState(win: BrowserWindow) {
  if (win.isDestroyed()) return
  if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) {
    const b = win.getBounds()
    lastNormalBounds = { width: b.width, height: b.height, x: b.x, y: b.y }
  }
  if (windowStateWriteTimer) clearTimeout(windowStateWriteTimer)
  windowStateWriteTimer = setTimeout(() => {
    windowStateWriteTimer = undefined
    if (win.isDestroyed()) return
    const data: WindowState = {
      width: lastNormalBounds?.width ?? win.getBounds().width,
      height: lastNormalBounds?.height ?? win.getBounds().height,
      x: lastNormalBounds?.x,
      y: lastNormalBounds?.y,
      isMaximized: win.isMaximized(),
    }
    try {
      writeFileSync(windowStatePath(), JSON.stringify(data, null, 2), "utf8")
    } catch (err) {
      console.error("window state write failed", err)
    }
  }, 400)
}

function createWindow() {
  const saved = readWindowStateSync()
  const state = saved ? clampWindowStateToDisplay(saved) : null
  const win = new BrowserWindow({
    width: state?.width ?? 1280,
    height: state?.height ?? 800,
    x: state?.x,
    y: state?.y,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 11 },
    // Dark default so the brief pre-paint frame isn't a jarring white flash
    // while Vite/React boot. Window itself shows immediately.
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true,
    },
  })
  if (VITE_DEV_SERVER_URL && process.platform === "darwin") {
    app.dock.setIcon(
      nativeImage.createFromPath(
        path.join(app.getAppPath(), "build", "dev-icon.png")
      )
    )
  }
  if (state?.isMaximized) win.maximize()
  if (state) {
    const b = win.getBounds()
    lastNormalBounds = { width: b.width, height: b.height, x: b.x, y: b.y }
  }
  const webContentsId = win.webContents.id
  const onChange = () => persistWindowState(win)
  win.on("resize", onChange)
  win.on("move", onChange)
  win.on("maximize", onChange)
  win.on("unmaximize", onChange)
  // Forward native focus changes to the renderer. The DOM `window` blur event
  // only fires when the document held DOM focus, so a title bar revealed by
  // mouse hover (without clicking into the page) wouldn't hide on app switch.
  // The native event fires regardless of where DOM focus sits.
  win.on("blur", () => {
    if (!win.isDestroyed()) win.webContents.send("window:blur")
  })
  win.on("focus", () => {
    if (!win.isDestroyed()) win.webContents.send("window:focus")
  })
  win.on("closed", () => {
    readyWebContents.delete(webContentsId)
  })
  win.on("close", () => {
    if (windowStateWriteTimer) {
      clearTimeout(windowStateWriteTimer)
      windowStateWriteTimer = undefined
    }
    if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) {
      const b = win.getBounds()
      lastNormalBounds = { width: b.width, height: b.height, x: b.x, y: b.y }
    }
    const data: WindowState = {
      width: lastNormalBounds?.width ?? win.getBounds().width,
      height: lastNormalBounds?.height ?? win.getBounds().height,
      x: lastNormalBounds?.x,
      y: lastNormalBounds?.y,
      isMaximized: win.isMaximized(),
    }
    try {
      writeFileSync(windowStatePath(), JSON.stringify(data, null, 2), "utf8")
    } catch (err) {
      console.error("window state write failed", err)
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) {
      void openExternalHttpUrl(url)
    }

    // Prevent Electron from creating in-app popup/sub windows.
    return { action: "deny" }
  })

  win.webContents.on("will-navigate", (event, url) => {
    if (!isExternalHttpUrl(url)) return
    event.preventDefault()
    void openExternalHttpUrl(url)
  })

  if (VITE_DEV_SERVER_URL) {
    // The window can boot before the Vite dev server is listening, landing on
    // chrome-error://chromewebdata/ — from which it can't reload itself. Retry
    // the load until the dev server answers.
    win.webContents.on("did-fail-load", (_event, errorCode) => {
      // -3 is ERR_ABORTED (a superseded navigation), not a real failure.
      if (errorCode === -3 || win.isDestroyed()) return
      setTimeout(() => {
        if (!win.isDestroyed()) win.loadURL(VITE_DEV_SERVER_URL)
      }, 300)
    })
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"))
  }

  return win
}

function sendToFocused(channel: string) {
  const win =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win) return
  win.webContents.send(channel)
}

const menuAccelerators: { "terminal.new": string; "terminal.close": string } = {
  "terminal.new": "CmdOrCtrl+T",
  "terminal.close": "CmdOrCtrl+W",
}

function buildMenu() {
  const isMac = process.platform === "darwin"
  const updater = getUpdaterState()
  const updateReady = updater.status === "ready"
  const checkingForUpdate = updater.status === "checking"
  const installLabel = updateReady
    ? `Install Update (v${updater.version}) and Restart`
    : "Install Update"
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              {
                label: checkingForUpdate
                  ? "Checking for Updates…"
                  : "Check for Updates…",
                enabled: !checkingForUpdate,
                click: () => {
                  void checkForUpdatesNow({ alertWhenNoUpdate: true })
                },
              },
              {
                label: installLabel,
                enabled: updateReady,
                visible: updateReady,
                click: () => quitAndInstall(),
              },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Terminal",
          accelerator: menuAccelerators["terminal.new"],
          click: () => sendToFocused("app:new-terminal"),
        },
        {
          label: "Close Terminal",
          accelerator: menuAccelerators["terminal.close"],
          click: () => sendToFocused("app:close-terminal"),
        },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP("git", args, {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
  })
  return stdout
}

async function runGitBuffer(cwd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout))
        return
      }
      reject(
        new Error(
          Buffer.concat(stderr).toString("utf8") || `git exited ${code}`
        )
      )
    })
  })
}

async function runGitWithProjectEnv(
  cwd: string,
  args: string[]
): Promise<string> {
  const env = await projectCommandEnv(cwd)
  const { stdout } = await execFileP("git", args, {
    cwd,
    env,
    maxBuffer: 20 * 1024 * 1024,
  })
  return stdout
}

/**
 * Returns the subset of `names` (entries directly inside `dir`) that git
 * considers ignored. Used to dim gitignored files/folders in the file tree.
 * Resolves to an empty set when `dir` isn't in a git repo or git is missing.
 */
async function readIgnoredNames(
  dir: string,
  names: string[]
): Promise<Set<string>> {
  if (names.length === 0) return new Set()
  try {
    // With multiple pathspecs, `git check-ignore -z` only works with --stdin.
    // It echoes each ignored path back as a null-separated string.
    const out = await new Promise<string>((resolve, reject) => {
      const child = spawn("git", ["check-ignore", "-z", "--stdin"], {
        cwd: dir,
        stdio: ["pipe", "pipe", "pipe"],
      })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
      child.on("error", reject)
      child.on("close", (code) => {
        if (code === 0 || code === 1) {
          resolve(Buffer.concat(stdout).toString("utf8"))
          return
        }
        reject(new Error(Buffer.concat(stderr).toString("utf8")))
      })
      child.stdin.end(`${names.join("\0")}\0`)
    })
    return new Set(out.split("\0").filter(Boolean))
  } catch {
    return new Set()
  }
}

async function runGitAllowExit1(cwd: string, args: string[]): Promise<string> {
  try {
    return await runGit(cwd, args)
  } catch (err) {
    const e = err as { code?: number; stdout?: string }
    if (e.code === 1 && typeof e.stdout === "string") return e.stdout
    throw err
  }
}

function isExternalHttpUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false

    // In dev, the Vite dev server is the app itself, so don't redirect it.
    if (VITE_DEV_SERVER_URL) {
      const appUrl = new URL(VITE_DEV_SERVER_URL)
      if (url.origin === appUrl.origin) return false
    }

    return true
  } catch {
    return false
  }
}

async function openExternalHttpUrl(rawUrl: string): Promise<boolean> {
  if (!isExternalHttpUrl(rawUrl)) return false
  try {
    await shell.openExternal(new URL(rawUrl).toString())
    return true
  } catch {
    return false
  }
}

async function findBinary(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  extraCandidates: string[] = []
): Promise<string | null> {
  const candidates = [command, ...extraCandidates]
  for (const bin of candidates) {
    try {
      await execFileP(bin, args, { env, maxBuffer: 1024 * 1024 })
      return bin
    } catch {
      // try the next likely install path
    }
  }
  return null
}

async function findGhBinary(env: NodeJS.ProcessEnv): Promise<string | null> {
  return findBinary("gh", ["--version"], env, [
    "/opt/homebrew/bin/gh",
    "/usr/local/bin/gh",
    "/usr/bin/gh",
  ])
}

async function findDirenvBinary(
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  return findBinary("direnv", ["version"], env, [
    "/opt/homebrew/bin/direnv",
    "/usr/local/bin/direnv",
    "/usr/bin/direnv",
  ])
}

async function projectCommandEnv(cwd: string): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env }
  const direnv = await findDirenvBinary(env)
  if (!direnv) return env

  try {
    const { stdout } = await execFileP(direnv, ["export", "json"], {
      cwd,
      env,
      maxBuffer: 20 * 1024 * 1024,
    })
    const parsed = JSON.parse(stdout) as Record<string, string | null>
    for (const [key, value] of Object.entries(parsed)) {
      if (value === null) {
        delete env[key]
      } else {
        env[key] = value
      }
    }
  } catch {
    // If direnv is unavailable, blocked, or not allowed, fall back to the
    // app's environment and let gh report any real auth/repo problem.
  }

  return env
}

// Convert a git remote URL (SSH or HTTPS) to its GitHub web URL, e.g.
// `git@github.com:owner/repo.git` → `https://github.com/owner/repo`.
function githubRemoteToWebUrl(remote: string): string | null {
  // Allow an optional "user@" prefix in HTTPS remotes (e.g.
  // https://octocat@github.com/owner/repo.git), which git writes when the URL
  // carries an embedded username.
  const match = remote.match(
    /^(?:https:\/\/(?:[^@/]+@)?|git@|ssh:\/\/git@)github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/
  )
  return match ? `https://github.com/${match[1]}` : null
}

async function runGh(cwd: string, args: string[]): Promise<string> {
  const env = await projectCommandEnv(cwd)
  const gh = await findGhBinary(env)
  if (!gh) {
    const err = new Error("github-cli-unavailable") as Error & {
      code?: string
    }
    err.code = "github-cli-unavailable"
    throw err
  }
  const { stdout } = await execFileP(gh, args, {
    cwd,
    env,
    maxBuffer: 20 * 1024 * 1024,
  })
  return stdout
}

async function hasGitRemote(cwd: string): Promise<boolean> {
  try {
    const raw = await runGit(cwd, ["remote"])
    return raw
      .split("\n")
      .map((s) => s.trim())
      .some(Boolean)
  } catch {
    return false
  }
}

async function getDefaultBranch(cwd: string): Promise<string | null> {
  try {
    const raw = await runGit(cwd, [
      "symbolic-ref",
      "--quiet",
      "--short",
      "refs/remotes/origin/HEAD",
    ])
    return raw.trim().replace(/^origin\//, "") || null
  } catch {
    return null
  }
}

function normalizePullRequest(value: unknown): PullRequestInfo | null {
  const pr = value as {
    number?: unknown
    id?: unknown
    title?: unknown
    url?: unknown
    headRefName?: unknown
    baseRefName?: unknown
    author?: { login?: unknown }
    createdAt?: unknown
    updatedAt?: unknown
  }
  if (
    !pr ||
    typeof pr.number !== "number" ||
    typeof pr.id !== "string" ||
    typeof pr.title !== "string" ||
    typeof pr.url !== "string"
  ) {
    return null
  }
  return {
    number: pr.number,
    id: pr.id,
    title: pr.title,
    url: pr.url,
    ...(typeof pr.headRefName === "string"
      ? { headRefName: pr.headRefName }
      : {}),
    ...(typeof pr.baseRefName === "string"
      ? { baseRefName: pr.baseRefName }
      : {}),
    ...(typeof pr.author?.login === "string"
      ? { authorLogin: pr.author.login }
      : {}),
    ...(typeof pr.createdAt === "string" ? { createdAt: pr.createdAt } : {}),
    ...(typeof pr.updatedAt === "string" ? { updatedAt: pr.updatedAt } : {}),
  }
}

function parsePullRequests(raw: string): PullRequestInfo[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((pr) => {
      const normalized = normalizePullRequest(pr)
      return normalized ? [normalized] : []
    })
  } catch {
    return []
  }
}

function parsePullRequest(raw: string): PullRequestInfo | null {
  return parsePullRequests(raw)[0] ?? null
}

function isExpectedPullRequestStatusError(message: string): boolean {
  return [
    /no git remotes found/i,
    /not a git repository/i,
    /could not resolve to a repository/i,
    /repository not found/i,
    /none of the git remotes configured/i,
  ].some((pattern) => pattern.test(message))
}

function isDefaultBranch(currentBranch: string, defaultBranch: string | null) {
  return (
    currentBranch === defaultBranch ||
    (!defaultBranch && (currentBranch === "main" || currentBranch === "master"))
  )
}

function isPathInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel))
}

function flushProjectWatch(watchId: string) {
  const entry = projectWatchers.get(watchId)
  const win = BrowserWindow.getAllWindows()[0]
  if (!entry || !win || win.webContents.isDestroyed()) return
  const paths = Array.from(entry.paths)
  entry.paths.clear()
  win.webContents.send("fs:changed", {
    watchId,
    cwd: entry.cwd,
    paths: paths.length > 0 ? paths : undefined,
  })
}

function queueProjectWatchEvent(
  watchId: string,
  filePath?: string | Buffer | null
) {
  const entry = projectWatchers.get(watchId)
  if (!entry) return
  if (filePath) entry.paths.add(String(filePath))
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => flushProjectWatch(watchId), 150)
}

function parseNumstat(raw: string) {
  const stats = new Map<string, { additions: number; deletions: number }>()
  const tokens = raw.split("\0").filter(Boolean)

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const parts = token.split("\t")
    if (parts.length >= 3) {
      const [addRaw, delRaw, filePath] = parts
      stats.set(filePath, {
        additions: addRaw === "-" ? 0 : Number(addRaw) || 0,
        deletions: delRaw === "-" ? 0 : Number(delRaw) || 0,
      })
      continue
    }

    if (parts.length === 2 && tokens[i + 1]) {
      const [addRaw, delRaw] = parts
      const filePath = tokens[i + 2] ?? tokens[i + 1]
      stats.set(filePath, {
        additions: addRaw === "-" ? 0 : Number(addRaw) || 0,
        deletions: delRaw === "-" ? 0 : Number(delRaw) || 0,
      })
      i += tokens[i + 2] ? 2 : 1
    }
  }

  return stats
}

function parseGitStatus(
  raw: string,
  statMaps: {
    staged?: Map<string, { additions: number; deletions: number }>
    unstaged?: Map<string, { additions: number; deletions: number }>
  } = {}
) {
  const staged: Array<{
    path: string
    status: string
    additions?: number
    deletions?: number
  }> = []
  const unstaged: Array<{
    path: string
    status: string
    additions?: number
    deletions?: number
  }> = []
  // -z output is NUL-separated. Rename/copy entries take TWO tokens
  // (newpath\0oldpath) and we need to advance the cursor past the second one.
  const tokens = raw.split("\0")

  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i]
    if (!entry || entry.length < 3) continue
    const x = entry[0]
    const y = entry[1]
    const filePath = entry.slice(3)

    const stagedStats = statMaps.staged?.get(filePath)
    const unstagedStats = statMaps.unstaged?.get(filePath)

    if (x === "?" && y === "?") {
      unstaged.push({ path: filePath, status: "A" })
      continue
    }
    if (x !== " " && x !== "?") {
      staged.push({ path: filePath, status: x, ...stagedStats })
    }
    if (y !== " " && y !== "?") {
      unstaged.push({ path: filePath, status: y, ...unstagedStats })
    }
    // Rename/copy: consume the oldpath token that follows.
    if (x === "R" || x === "C" || y === "R" || y === "C") i++
  }

  return { staged, unstaged }
}

function isProbablyBinaryBuffer(buf: Buffer): boolean {
  const head = buf.subarray(0, Math.min(buf.length, 8192))
  for (let i = 0; i < head.length; i++) {
    if (head[i] === 0) return true
  }
  return false
}

async function buildUntrackedPatch(cwd: string, files: string[]) {
  const patches = await Promise.all(
    files.map(async (filePath) => {
      try {
        const full = path.resolve(cwd, filePath)
        if (!isPathInside(cwd, full)) return ""
        const buf = await fs.readFile(full)
        if (isProbablyBinaryBuffer(buf)) {
          return [
            `diff --git a/${filePath} b/${filePath}`,
            "new file mode 100644",
            "index 0000000..0000000",
            `Binary files /dev/null and b/${filePath} differ`,
            "",
          ].join("\n")
        }
        const raw = await runGitAllowExit1(cwd, [
          "diff",
          "--no-color",
          "--text",
          "--no-index",
          "--",
          "/dev/null",
          filePath,
        ])
        return raw
          .replace(
            /^diff --git a\/dev\/null b\/.*$/m,
            `diff --git a/${filePath} b/${filePath}`
          )
          .replace(/^--- a\/dev\/null$/m, "--- /dev/null")
      } catch {
        return ""
      }
    })
  )
  return patches.filter(Boolean).join("\n")
}

const PROJECTS_STATE_KEY = "gearshift.projects"
const LAST_AGENT_TERMINAL_STATE_KEY = "gearshift.lastAgentTerminal"
const SYSTEM_BOOT_ID_STATE_KEY = "gearshift.systemBootId"

function stateFilePath(): string {
  return path.join(app.getPath("userData"), "state.json")
}

let currentSystemBootIdPromise: Promise<string> | null = null
async function currentSystemBootId(): Promise<string> {
  if (currentSystemBootIdPromise) return currentSystemBootIdPromise
  currentSystemBootIdPromise = (async () => {
    if (process.platform === "darwin") {
      try {
        const { stdout } = await execFileP("/usr/sbin/sysctl", [
          "-n",
          "kern.boottime",
        ])
        const sec = stdout.match(/sec = (\d+)/)?.[1]
        if (sec) return `darwin:${sec}`
      } catch {
        // fall through to the portable uptime estimate
      }
    }
    return `${process.platform}:${Math.round(Date.now() / 1000 - os.uptime())}`
  })()
  return currentSystemBootIdPromise
}

function dropRestoredTerminalState(
  state: Record<string, string>
): Record<string, string> {
  const raw = state[PROJECTS_STATE_KEY]
  if (!raw) return state
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return state
    return {
      ...state,
      [PROJECTS_STATE_KEY]: JSON.stringify(
        parsed.map((project) =>
          project && typeof project === "object"
            ? { ...project, tabs: [], activeTabId: "" }
            : project
        )
      ),
      [LAST_AGENT_TERMINAL_STATE_KEY]: JSON.stringify({}),
    }
  } catch {
    return state
  }
}

async function writeStateSnapshot(data: Record<string, string>) {
  const file = stateFilePath()
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8")
  await fs.rename(tmp, file)
}

async function readState(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(stateFilePath(), "utf8")
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      let out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") out[k] = v
      }
      const bootId = await currentSystemBootId()
      const previousBootId = out[SYSTEM_BOOT_ID_STATE_KEY]
      if (previousBootId && previousBootId !== bootId) {
        out = dropRestoredTerminalState(out)
      }
      if (out[SYSTEM_BOOT_ID_STATE_KEY] !== bootId) {
        out[SYSTEM_BOOT_ID_STATE_KEY] = bootId
        await writeStateSnapshot(out)
      }
      return out
    }
  } catch {
    // missing or corrupt → start empty
  }
  return { [SYSTEM_BOOT_ID_STATE_KEY]: await currentSystemBootId() }
}

let stateWriteTimer: NodeJS.Timeout | undefined
let pendingState: Record<string, string> | null = null
let stateWriteInFlight = false
async function flushState() {
  stateWriteTimer = undefined
  if (stateWriteInFlight) return
  const data = pendingState
  if (!data) return
  pendingState = null
  stateWriteInFlight = true
  try {
    await writeStateSnapshot(data)
  } catch (err) {
    console.error("state write failed", err)
  } finally {
    stateWriteInFlight = false
    if (pendingState) void flushState()
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.exit(0)
} else {
  app.on("second-instance", (_event, argv, cwd) => {
    const paths = cliProjectPaths(argv, cwd)
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    void sendCliProjectPaths(paths)
  })
}

pendingCliProjectPaths = cliProjectPaths(process.argv)

app.whenReady().then(async () => {
  buildMenu()
  initUpdater()
  onUpdaterStateChange(() => buildMenu())
  // The socket server must be listening before any agent tries to connect, so
  // we still await it — but it's just a Unix-socket bind, milliseconds.
  try {
    await startAgentHookServer(sendAgentHookEvent)
  } catch (err) {
    console.warn("[agent-hooks] socket server failed", err)
  }
  // Local, loopback-only HTTP API that serves chat history to agents/tools.
  void startHistoryServer({ getProjects: historyServerProjects })
  // Writing hook configs / plugins / extensions is pure file I/O across
  // several agent dirs and was previously blocking window creation. Run it in
  // the background — agents launched before it finishes will simply miss the
  // current run's hook updates and pick them up on the next start.
  void installAgentHooks().catch((err) => {
    console.warn("[agent-hooks] install failed", err)
  })
  void startCliOpenServer()
  void ensureCliInstalled({
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    mainDir: __dirname,
  }).then((result) => {
    if (result.ok && result.updated) {
      console.log(`[cli] installed ${result.path}`)
    } else if (!result.ok) {
      console.warn(`[cli] install skipped: ${result.error}`)
    }
  })

  ipcMain.handle("app:takeOpenProjects", async (event) => {
    readyWebContents.add(event.sender.id)
    const paths = [...pendingCliProjectPaths]
    pendingCliProjectPaths = []
    return validProjectPaths(paths)
  })

  ipcMain.handle(
    "menu:update-accelerators",
    (_e, map: Partial<typeof menuAccelerators>) => {
      if (map && typeof map === "object") {
        if (typeof map["terminal.new"] === "string") {
          menuAccelerators["terminal.new"] = map["terminal.new"]
        }
        if (typeof map["terminal.close"] === "string") {
          menuAccelerators["terminal.close"] = map["terminal.close"]
        }
        buildMenu()
      }
      return { ok: true }
    }
  )

  ipcMain.handle("window:pointerState", (event, outsideLimit = 0) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return { ok: false, nearWindow: false }
    const bounds = win.getBounds()
    const cursor = screen.getCursorScreenPoint()
    const limit = Number.isFinite(outsideLimit)
      ? Math.max(0, Number(outsideLimit))
      : 0
    const nearWindow =
      cursor.x >= bounds.x - limit &&
      cursor.x <= bounds.x + bounds.width + limit &&
      cursor.y >= bounds.y - limit &&
      cursor.y <= bounds.y + bounds.height + limit
    return { ok: true, nearWindow, cursor, bounds }
  })

  ipcMain.handle("window:focus", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return { ok: false }
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return { ok: true }
  })

  ipcMain.handle("window:setWindowButtonVisibility", (event, visible) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return { ok: false }
    if (process.platform === "darwin") {
      win.setWindowButtonVisibility(Boolean(visible))
    }
    return { ok: true }
  })

  let dockBounceId: number | null = null
  ipcMain.handle(
    "dock:bounce",
    (_event, type: "informational" | "critical" = "informational") => {
      if (process.platform !== "darwin" || !app.dock) return { ok: false }
      // Cancel any in-flight critical bounce so repeated notifications don't
      // stack requests. A critical bounce auto-stops once the app is focused.
      if (dockBounceId !== null) {
        app.dock.cancelBounce(dockBounceId)
        dockBounceId = null
      }
      const id = app.dock.bounce(type)
      if (type === "critical") dockBounceId = id
      return { ok: true }
    }
  )

  ipcMain.handle(
    "menu:showEditContext",
    (
      event,
      flags: { canCut?: boolean; canCopy?: boolean; canPaste?: boolean } = {}
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return
      return new Promise<"cut" | "copy" | "paste" | null>((resolve) => {
        let resolved: "cut" | "copy" | "paste" | null = null
        const template: Electron.MenuItemConstructorOptions[] = [
          {
            label: "Cut",
            accelerator: "CmdOrCtrl+X",
            enabled: flags.canCut !== false,
            click: () => {
              resolved = "cut"
            },
          },
          {
            label: "Copy",
            accelerator: "CmdOrCtrl+C",
            enabled: flags.canCopy !== false,
            click: () => {
              resolved = "copy"
            },
          },
          {
            label: "Paste",
            accelerator: "CmdOrCtrl+V",
            enabled: flags.canPaste !== false,
            click: () => {
              resolved = "paste"
            },
          },
        ]
        Menu.buildFromTemplate(template).popup({
          window: win,
          callback: () => resolve(resolved),
        })
      })
    }
  )

  ipcMain.handle("state:read", () => readState())

  ipcMain.handle("state:write", async (_e, data: Record<string, string>) => {
    pendingState = data
    if (stateWriteTimer) clearTimeout(stateWriteTimer)
    stateWriteTimer = setTimeout(() => void flushState(), 100)
    return { ok: true }
  })

  ipcMain.handle("clipboard:hasImage", () => {
    try {
      return !clipboard.readImage().isEmpty()
    } catch {
      return false
    }
  })

  ipcMain.handle("clipboard:getImagePath", async () => {
    try {
      // 1) Prefer an existing file path on the clipboard (e.g. a Finder
      //    selection). macOS exposes this via the NSFilenamesPboardType /
      //    public.file-url formats.
      const candidates =
        process.platform === "darwin"
          ? [
              "public.file-url",
              "NSFilenamesPboardType",
              "public.utf8-plain-text",
              "text/uri-list",
            ]
          : ["text/uri-list"]

      for (const fmt of candidates) {
        let raw = ""
        try {
          raw = clipboard.read(fmt)
        } catch {
          continue
        }
        if (!raw) continue
        const first = raw.split("\n")[0].trim()
        if (first.startsWith("file://")) {
          return decodeURIComponent(first.replace(/^file:\/\//, ""))
        }
        if (first.startsWith("/")) return first
        const m = raw.match(/<string>([^<]+)<\/string>/)
        if (m) return m[1]
      }
      return null
    } catch {
      return null
    }
  })

  ipcMain.handle("shell:revealInFinder", (_event, targetPath: string) => {
    if (!targetPath) return false
    try {
      shell.showItemInFolder(targetPath)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle("shell:openInVSCode", async (_event, targetPath: string) => {
    if (!targetPath) return false
    // On macOS prefer `/usr/bin/open -a` (launchd hand-off, instant) over the
    // `code` CLI (boots Node).
    if (process.platform === "darwin") {
      try {
        await execFileP("/usr/bin/open", [
          "-a",
          "Visual Studio Code",
          targetPath,
        ])
        return true
      } catch {
        // fall through
      }
    }
    // Other platforms / fallback: try the `code` CLI from PATH.
    try {
      const child = spawn("code", [targetPath], {
        detached: true,
        stdio: "ignore",
      })
      child.unref()
      return true
    } catch {
      // last-ditch URL handler
    }
    try {
      await shell.openExternal(`vscode://file/${encodeURI(targetPath)}`)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle("shell:openExternal", async (_event, url: string) => {
    return openExternalHttpUrl(url)
  })

  ipcMain.handle("dialog:openProject", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: "Open Project",
      properties: ["openDirectory", "createDirectory"],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle("dialog:openProjectAvatarImage", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: "Choose Project Avatar",
      properties: ["openFile"],
      filters: [
        {
          name: "Images",
          extensions: [
            "png",
            "jpg",
            "jpeg",
            "gif",
            "webp",
            "svg",
            "bmp",
            "ico",
            "avif",
          ],
        },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(
    "dialog:confirmTerminalClose",
    async (event, opts: { count?: number }) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const count = Math.max(1, opts.count ?? 1)
      const plural = count === 1 ? "terminal has" : "terminals have"
      const result = await dialog.showMessageBox(win!, {
        type: "warning",
        title: "Close terminal with agent?",
        message: `${count} ${plural} a coding agent open.`,
        detail: "Closing will stop the agent and end the terminal session.",
        buttons: ["Close", "Cancel"],
        defaultId: 0,
        noLink: true,
      })
      return result.response === 0
    }
  )

  ipcMain.handle("fs:watchProject", async (_event, cwd: string) => {
    if (!cwd) return { ok: false, error: "no-cwd" }
    try {
      const watchId = randomUUID()
      // Do not ignore .gitignore patterns here. The file tree intentionally
      // shows gitignored files, so external changes under ignored paths (for
      // example .env files) must still trigger a refresh.
      const subscription = await parcelWatcher.subscribe(
        cwd,
        (err, events) => {
          if (err) return
          for (const ev of events) queueProjectWatchEvent(watchId, ev.path)
        },
        { ignore: WATCHER_IGNORE_BASE }
      )
      projectWatchers.set(watchId, {
        cwd,
        subscription,
        paths: new Set(),
      })
      return { ok: true, watchId }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.on("fs:unwatchProject", async (_event, watchId: string) => {
    const entry = projectWatchers.get(watchId)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    projectWatchers.delete(watchId)
    try {
      await entry.subscription.unsubscribe()
    } catch {
      // ignore
    }
  })

  ipcMain.handle("git:status", async (_event, cwd: string) => {
    if (!cwd) return { ok: false, error: "no-cwd", staged: [], unstaged: [] }
    try {
      const [raw, stagedStatsRaw, unstagedStatsRaw] = await Promise.all([
        runGit(cwd, [
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
        ]),
        runGit(cwd, ["diff", "--cached", "--numstat", "-z"]),
        runGit(cwd, ["diff", "--numstat", "-z"]),
      ])
      return {
        ok: true,
        ...parseGitStatus(raw, {
          staged: parseNumstat(stagedStatsRaw),
          unstaged: parseNumstat(unstagedStatsRaw),
        }),
      }
    } catch (err) {
      return {
        ok: false,
        error: (err as Error).message,
        staged: [],
        unstaged: [],
      }
    }
  })

  ipcMain.handle("fs:readDir", async (_event, absPath: string) => {
    if (!absPath) return { ok: false, error: "no-path", entries: [] }
    try {
      const dirents = await fs.readdir(absPath, { withFileTypes: true })
      // Match VSCode's default Explorer behavior: show everything except the
      // default `files.exclude` glob set. Gitignored files (node_modules, build
      // output, etc.) stay visible and are reached by expanding the tree;
      // search (fs:listAllFiles) is where ignored files get filtered out.
      const visible = dirents.filter(
        (d) => !VSCODE_DEFAULT_EXCLUDED_NAMES.has(d.name)
      )
      const ignored = await readIgnoredNames(
        absPath,
        visible.map((d) => d.name)
      )
      const entries = visible.map((d) => ({
        name: d.name,
        isDir: d.isDirectory(),
        ignored: ignored.has(d.name),
      }))
      return { ok: true, entries }
    } catch (err) {
      return { ok: false, error: (err as Error).message, entries: [] }
    }
  })

  ipcMain.handle("fs:stat", async (_event, absPath: string) => {
    if (!absPath) return { ok: false, error: "no-path" }
    try {
      const stat = await fs.stat(absPath)
      return { ok: true, isDir: stat.isDirectory() }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle("fs:listAllFiles", async (_event, cwd: string) => {
    if (!cwd) return { ok: false, files: [] }
    try {
      // Tracked + untracked, minus gitignored. Null-separated for safety.
      const out = await runGit(cwd, [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ])
      const files = out.split("\0").filter(Boolean)

      // Global command palette should also show gitignored .env files.
      // `ls-files --exclude-standard` hides them, so query ignored dotenv
      // pathspecs separately and merge them back in.
      const dotenvOut = await runGit(cwd, [
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "-z",
        "--",
        ".env",
        ".env.*",
        ":(glob)**/.env",
        ":(glob)**/.env.*",
      ])
      for (const file of dotenvOut.split("\0").filter(Boolean)) {
        if (isAllowlistedDotenv(path.basename(file))) files.push(file)
      }

      return { ok: true, files: [...new Set(files)] }
    } catch (err) {
      return { ok: false, error: (err as Error).message, files: [] }
    }
  })

  // Content search across the project, VS Code style. Uses `git grep` so it is
  // fast, respects .gitignore, and needs no extra binary. Untracked files are
  // included; binary files are skipped.
  ipcMain.handle(
    "fs:searchContents",
    async (_event, cwd: string, query: string) => {
      const MAX_CONTENT_RESULTS = 20
      const MAX_TEXT_LEN = 200
      const q = (query ?? "").trim()
      if (!cwd || q.length < 2) return { ok: true, results: [] }
      const tokens = searchTokens(q)
      const grepNeedle = tokens[0] ?? q
      // Lock files are huge, generated, and never useful in a content search.
      const lockFileGlobs = [
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "npm-shrinkwrap.json",
        "bun.lock",
        "bun.lockb",
        "composer.lock",
        "Gemfile.lock",
        "Cargo.lock",
        "poetry.lock",
        "Pipfile.lock",
        "go.sum",
      ]
      try {
        const out = await runGitAllowExit1(cwd, [
          "grep",
          "--no-color",
          "-n", // line numbers
          "-I", // skip binary files
          "-F", // literal string, not a regex
          "-i", // case-insensitive
          "--untracked", // also search untracked (still honors .gitignore)
          "--max-count=20", // cap matches per file
          "-e",
          grepNeedle,
          "--",
          ".", // search everything …
          // … except generated lock files.
          ...lockFileGlobs.map((name) => `:(exclude,glob)**/${name}`),
        ])
        const results: { path: string; line: number; text: string }[] = []
        for (const raw of out.split("\n")) {
          if (!raw) continue
          // Format: <path>:<line>:<text>
          const firstColon = raw.indexOf(":")
          if (firstColon === -1) continue
          const secondColon = raw.indexOf(":", firstColon + 1)
          if (secondColon === -1) continue
          const path = raw.slice(0, firstColon)
          const line = Number.parseInt(
            raw.slice(firstColon + 1, secondColon),
            10
          )
          if (!Number.isFinite(line)) continue
          let text = raw.slice(secondColon + 1).trim()
          if (tokens.length > 1 && !hasTokensInOrder(text, tokens)) continue
          if (text.length > MAX_TEXT_LEN)
            text = text.slice(0, MAX_TEXT_LEN) + "…"
          results.push({ path, line, text })
          if (results.length >= MAX_CONTENT_RESULTS) break
        }
        return {
          ok: true,
          results,
          truncated: results.length >= MAX_CONTENT_RESULTS,
        }
      } catch (err) {
        return { ok: false, error: (err as Error).message, results: [] }
      }
    }
  )

  ipcMain.handle(
    "fs:writeFile",
    async (_event, absPath: string, content: string) => {
      if (!absPath) return { ok: false, error: "no-path" }
      try {
        await fs.writeFile(absPath, content, "utf8")
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle("fs:createFile", async (_event, absPath: string) => {
    if (!absPath) return { ok: false, error: "no-path" }
    try {
      await fs.mkdir(path.dirname(absPath), { recursive: true })
      const handle = await fs.open(absPath, "wx")
      await handle.close()
      return { ok: true }
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === "EEXIST") {
        return { ok: false, error: "A file with that name already exists" }
      }
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle("fs:createDir", async (_event, absPath: string) => {
    if (!absPath) return { ok: false, error: "no-path" }
    try {
      await fs.mkdir(absPath, { recursive: false })
      return { ok: true }
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === "EEXIST") {
        return { ok: false, error: "A folder with that name already exists" }
      }
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle(
    "fs:move",
    async (_event, sourceAbsPath: string, targetDirAbsPath: string) => {
      if (!sourceAbsPath || !targetDirAbsPath) {
        return { ok: false, error: "no-path" }
      }
      try {
        const source = path.resolve(sourceAbsPath)
        const targetDir = path.resolve(targetDirAbsPath)
        const sourceStat = await fs.stat(source)
        const targetDirStat = await fs.stat(targetDir)
        if (!targetDirStat.isDirectory()) {
          return { ok: false, error: "Drop target is not a folder" }
        }
        if (source === targetDir) {
          return { ok: false, error: "Cannot move a folder into itself" }
        }
        if (sourceStat.isDirectory() && isPathInside(source, targetDir)) {
          return { ok: false, error: "Cannot move a folder into itself" }
        }
        if (path.dirname(source) === targetDir) {
          return { ok: false, error: "Already in that folder" }
        }
        const target = path.join(targetDir, path.basename(source))
        try {
          await fs.lstat(target)
          return {
            ok: false,
            error: "A file or folder with that name already exists",
          }
        } catch (err) {
          const e = err as NodeJS.ErrnoException
          if (e.code !== "ENOENT") throw err
        }
        await fs.rename(source, target)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle(
    "fs:copy",
    async (_event, sourceAbsPath: string, targetDirAbsPath: string) => {
      if (!sourceAbsPath || !targetDirAbsPath) {
        return { ok: false, error: "no-path" }
      }
      try {
        const source = path.resolve(sourceAbsPath)
        const targetDir = path.resolve(targetDirAbsPath)
        const sourceStat = await fs.stat(source)
        const targetDirStat = await fs.stat(targetDir)
        if (!targetDirStat.isDirectory()) {
          return { ok: false, error: "Paste target is not a folder" }
        }
        if (source === targetDir) {
          return { ok: false, error: "Cannot copy a folder into itself" }
        }
        if (sourceStat.isDirectory() && isPathInside(source, targetDir)) {
          return { ok: false, error: "Cannot copy a folder into itself" }
        }
        const target = path.join(targetDir, path.basename(source))
        try {
          await fs.lstat(target)
          return {
            ok: false,
            error: "A file or folder with that name already exists",
          }
        } catch (err) {
          const e = err as NodeJS.ErrnoException
          if (e.code !== "ENOENT") throw err
        }
        await fs.cp(source, target, {
          recursive: sourceStat.isDirectory(),
          errorOnExist: true,
          force: false,
        })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle(
    "fs:rename",
    async (_event, sourceAbsPath: string, newName: string) => {
      if (!sourceAbsPath || !newName) return { ok: false, error: "no-path" }
      try {
        const source = path.resolve(sourceAbsPath)
        const trimmedName = newName.trim()
        if (!trimmedName) return { ok: false, error: "Name is required" }
        if (trimmedName.includes("/") || trimmedName.includes("\\")) {
          return { ok: false, error: "Name cannot contain path separators" }
        }
        const target = path.join(path.dirname(source), trimmedName)
        if (source === target) return { ok: true, newPath: target }
        try {
          await fs.lstat(target)
          return {
            ok: false,
            error: "A file or folder with that name already exists",
          }
        } catch (err) {
          const e = err as NodeJS.ErrnoException
          if (e.code !== "ENOENT") throw err
        }
        await fs.rename(source, target)
        return { ok: true, newPath: target }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle("fs:trash", async (_event, absPath: string) => {
    if (!absPath) return { ok: false, error: "no-path" }
    try {
      await shell.trashItem(absPath)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  function sniffMediaMime(buf: Buffer, mimeByExt: Record<string, string>) {
    const has = (mime: string) => Object.values(mimeByExt).includes(mime)

    if (
      has("image/png") &&
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a
    ) {
      return "image/png"
    }
    if (has("image/jpeg") && buf[0] === 0xff && buf[1] === 0xd8) {
      return "image/jpeg"
    }
    if (has("image/gif") && buf.subarray(0, 3).toString("ascii") === "GIF") {
      return "image/gif"
    }
    if (
      has("image/webp") &&
      buf.subarray(0, 4).toString("ascii") === "RIFF" &&
      buf.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      return "image/webp"
    }
    if (has("audio/mpeg") && buf.subarray(0, 3).toString("ascii") === "ID3") {
      return "audio/mpeg"
    }
    if (has("audio/wav") && buf.subarray(0, 4).toString("ascii") === "RIFF") {
      return "audio/wav"
    }
    if (
      has("application/pdf") &&
      buf.subarray(0, 4).toString("ascii") === "%PDF"
    ) {
      return "application/pdf"
    }
    return null
  }

  const imageMimeByExt = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".avif": "image/avif",
  }

  const audioMimeByExt = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
  }

  const pdfMimeByExt = {
    ".pdf": "application/pdf",
  }

  function mediaDataUrlFromBuffer(
    filePath: string,
    buf: Buffer,
    mimeByExt: Record<string, string>,
    maxSize: number
  ) {
    if (buf.length > maxSize) {
      return { ok: false, error: "too-large", size: buf.length }
    }
    const ext = path.extname(filePath).toLowerCase()
    const mime = mimeByExt[ext] ?? sniffMediaMime(buf, mimeByExt)
    if (!mime) return { ok: false, error: "unsupported-type" }
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`
    return { ok: true, dataUrl, mime, size: buf.length }
  }

  async function readMediaDataUrl(
    absPath: string,
    mimeByExt: Record<string, string>,
    maxSize: number
  ) {
    if (!absPath) return { ok: false, error: "no-path" }
    try {
      const buf = await fs.readFile(absPath)
      return mediaDataUrlFromBuffer(absPath, buf, mimeByExt, maxSize)
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  ipcMain.handle("fs:readImage", async (_event, absPath: string) => {
    return readMediaDataUrl(absPath, imageMimeByExt, 25 * 1024 * 1024)
  })

  ipcMain.handle("fs:readAudio", async (_event, absPath: string) => {
    return readMediaDataUrl(absPath, audioMimeByExt, 100 * 1024 * 1024)
  })

  ipcMain.handle("fs:readPdf", async (_event, absPath: string) => {
    return readMediaDataUrl(absPath, pdfMimeByExt, 100 * 1024 * 1024)
  })

  ipcMain.handle("fs:readFile", async (_event, absPath: string) => {
    if (!absPath) return { ok: false, error: "no-path" }
    try {
      const stat = await fs.stat(absPath)
      const MAX = 2 * 1024 * 1024
      if (stat.size > MAX) {
        return { ok: true, tooLarge: true, size: stat.size }
      }
      const buf = await fs.readFile(absPath)
      if (isProbablyBinaryBuffer(buf)) {
        return { ok: true, binary: true, size: stat.size }
      }
      return { ok: true, content: buf.toString("utf8"), size: stat.size }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle("git:stage", async (_event, cwd: string, paths: string[]) => {
    if (!cwd || !paths?.length) return { ok: false, error: "no-paths" }
    try {
      await runGit(cwd, ["add", "--", ...paths])
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(
    "git:unstage",
    async (_event, cwd: string, paths: string[]) => {
      if (!cwd || !paths?.length) return { ok: false, error: "no-paths" }
      try {
        // `git reset HEAD --` works on any commit state, including initial commit.
        await runGitAllowExit1(cwd, ["reset", "HEAD", "--", ...paths])
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle("git:commit", async (_event, cwd: string, message: string) => {
    if (!cwd) return { ok: false, error: "no-cwd" }
    const trimmed = (message ?? "").trim()
    if (!trimmed) return { ok: false, error: "empty-message" }
    try {
      await runGit(cwd, ["commit", "-m", trimmed])
      return { ok: true }
    } catch (err) {
      const e = err as { stderr?: string; message?: string }
      return { ok: false, error: e.stderr || e.message || "commit failed" }
    }
  })

  ipcMain.handle(
    "git:discard",
    async (_event, cwd: string, paths: string[]) => {
      if (!cwd || !paths?.length) return { ok: false, error: "no-paths" }
      try {
        for (const rel of paths) {
          if (!rel) continue
          // Tracked? `ls-files --error-unmatch` exits 0 when present in index.
          let tracked = false
          try {
            await runGit(cwd, ["ls-files", "--error-unmatch", "--", rel])
            tracked = true
          } catch {
            tracked = false
          }
          if (tracked) {
            // Drop unstaged changes by restoring from index.
            await runGit(cwd, ["checkout", "--", rel])
          } else {
            // Untracked file — delete it (best-effort).
            const full = path.resolve(cwd, rel)
            if (isPathInside(cwd, full)) {
              try {
                await fs.unlink(full)
              } catch {
                // ignore; may already be gone
              }
            }
          }
        }
        return { ok: true }
      } catch (err) {
        const e = err as { stderr?: string; message?: string }
        return {
          ok: false,
          error: e.stderr || e.message || "discard failed",
        }
      }
    }
  )

  ipcMain.handle("git:branches", async (_event, cwd: string) => {
    if (!cwd) {
      return { ok: false, error: "no-cwd", current: null, branches: [] }
    }
    try {
      const [currentRaw, listRaw, reflogRaw] = await Promise.all([
        runGitAllowExit1(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
        runGit(cwd, [
          "for-each-ref",
          "--sort=-committerdate",
          "--format=%(refname:short)",
          "refs/heads/",
        ]),
        // HEAD reflog captures every checkout — pure switches that don't
        // advance the branch tip still show up here. We take the newest 200
        // entries which is plenty for "recent" ordering.
        runGitAllowExit1(cwd, [
          "reflog",
          "show",
          "--format=%gs",
          "-n",
          "200",
          "HEAD",
        ]),
      ])
      const current = currentRaw.trim()
      const byCommitterDate = listRaw
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
      const branchSet = new Set(byCommitterDate)
      // "checkout: moving from <from> to <to>" — pull both sides, freshest first.
      const recentlyUsed: string[] = []
      const seen = new Set<string>()
      for (const line of reflogRaw.split("\n")) {
        const match = line.match(/^checkout: moving from (\S+) to (\S+)/)
        if (!match) continue
        for (const candidate of [match[2], match[1]]) {
          if (!branchSet.has(candidate) || seen.has(candidate)) continue
          seen.add(candidate)
          recentlyUsed.push(candidate)
        }
      }
      const tail = byCommitterDate.filter((b) => !seen.has(b))
      const branches = [...recentlyUsed, ...tail]
      return {
        ok: true,
        current: current === "HEAD" ? null : current,
        branches,
      }
    } catch (err) {
      return {
        ok: false,
        error: (err as Error).message,
        current: null,
        branches: [],
      }
    }
  })

  ipcMain.handle(
    "git:pullRequestStatus",
    async (
      _event,
      cwd: string,
      currentBranch: string | null,
      hasUpstream: boolean,
      ahead: number
    ) => {
      if (!cwd || !currentBranch) {
        return {
          ok: true,
          ghAvailable: false,
          pullRequest: null,
          canCreatePullRequest: false,
        }
      }

      const env = await projectCommandEnv(cwd)
      const gh = await findGhBinary(env)
      if (!gh) {
        return {
          ok: true,
          ghAvailable: false,
          pullRequest: null,
          canCreatePullRequest: false,
        }
      }

      if (!(await hasGitRemote(cwd))) {
        return {
          ok: true,
          ghAvailable: true,
          pullRequest: null,
          canCreatePullRequest: false,
        }
      }

      try {
        const [raw, defaultBranch] = await Promise.all([
          execFileP(
            gh,
            [
              "pr",
              "list",
              "--head",
              currentBranch,
              "--state",
              "open",
              "--json",
              "number,id,title,url",
              "--limit",
              "1",
            ],
            { cwd, env, maxBuffer: 20 * 1024 * 1024 }
          ).then((res) => res.stdout),
          getDefaultBranch(cwd),
        ])
        const pullRequest = parsePullRequest(raw)
        return {
          ok: true,
          ghAvailable: true,
          pullRequest,
          canCreatePullRequest:
            !pullRequest &&
            hasUpstream &&
            ahead === 0 &&
            !isDefaultBranch(currentBranch, defaultBranch),
        }
      } catch (err) {
        const e = err as {
          signal?: string
          stderr?: string
          message?: string
        } | null
        const signal = e?.signal
        const message = `${e?.stderr ?? ""}\n${e?.message ?? ""}`
        if (
          signal !== "SIGINT" &&
          signal !== "SIGTERM" &&
          !isExpectedPullRequestStatusError(message)
        ) {
          console.warn("pull request check failed", err)
        }
        return {
          ok: true,
          ghAvailable: false,
          pullRequest: null,
          canCreatePullRequest: false,
        }
      }
    }
  )

  ipcMain.handle("git:pullRequests", async (_event, cwd: string) => {
    if (!cwd) {
      return { ok: true, ghAvailable: false, pullRequests: [] }
    }

    const env = await projectCommandEnv(cwd)
    const gh = await findGhBinary(env)
    if (!gh) {
      return { ok: true, ghAvailable: false, pullRequests: [] }
    }

    if (!(await hasGitRemote(cwd))) {
      return { ok: true, ghAvailable: true, pullRequests: [] }
    }

    try {
      const { stdout } = await execFileP(
        gh,
        [
          "pr",
          "list",
          "--state",
          "open",
          "--json",
          "number,id,title,url,headRefName,baseRefName,author,createdAt,updatedAt",
          "--limit",
          "100",
        ],
        { cwd, env, maxBuffer: 20 * 1024 * 1024 }
      )
      return {
        ok: true,
        ghAvailable: true,
        pullRequests: parsePullRequests(stdout),
      }
    } catch (err) {
      const e = err as { signal?: string; stderr?: string; message?: string }
      const message = `${e?.stderr ?? ""}\n${e?.message ?? ""}`
      if (
        e?.signal !== "SIGINT" &&
        e?.signal !== "SIGTERM" &&
        !isExpectedPullRequestStatusError(message)
      ) {
        console.warn("pull request list failed", err)
      }
      return { ok: true, ghAvailable: false, pullRequests: [] }
    }
  })

  ipcMain.handle(
    "git:log",
    async (_event, cwd: string, limit = 50, skip = 0) => {
      if (!cwd) return { ok: true, commits: [] }
      try {
        // \x1f separates fields, \x1e separates records — both are safe
        // because they can't appear in commit metadata.
        const out = await runGitAllowExit1(cwd, [
          "log",
          "-n",
          String(limit),
          ...(skip > 0 ? ["--skip", String(skip)] : []),
          "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%ar%x1f%s%x1e",
        ])
        const commits = out
          .split("\x1e")
          .map((record) => record.trim())
          .filter(Boolean)
          .map((record) => {
            const [
              hash,
              shortHash,
              authorName,
              isoDate,
              relativeDate,
              subject,
            ] = record.split("\x1f")
            return {
              hash,
              shortHash,
              authorName,
              isoDate,
              relativeDate,
              subject,
            }
          })
        return { ok: true, commits }
      } catch (err) {
        const e = err as { stderr?: string; message?: string }
        return {
          ok: false,
          error: e.stderr || e.message || "git log failed",
          commits: [],
        }
      }
    }
  )

  ipcMain.handle("git:show", async (_event, cwd: string, hash: string) => {
    // hash always comes from our own git log output, but validate defensively
    // so it can never be coerced into an option or another command.
    if (!cwd || !/^[0-9a-f]{7,40}$/i.test(hash)) {
      return { ok: false, error: "invalid-commit", patch: "", commit: null }
    }
    try {
      const [metaRaw, patch] = await Promise.all([
        runGitAllowExit1(cwd, [
          "show",
          "--no-patch",
          "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%ar%x1f%s",
          hash,
        ]),
        runGitAllowExit1(cwd, ["show", "--format=", "--patch", hash]),
      ])
      const [hashF, shortHash, authorName, isoDate, relativeDate, subject] =
        metaRaw.trim().split("\x1f")
      return {
        ok: true,
        // The empty --format= still emits a leading newline before the diff.
        patch: patch.replace(/^\n+/, ""),
        commit: {
          hash: hashF,
          shortHash,
          authorName,
          isoDate,
          relativeDate,
          subject,
        },
      }
    } catch (err) {
      const e = err as { stderr?: string; message?: string }
      return {
        ok: false,
        error: e.stderr || e.message || "git show failed",
        patch: "",
        commit: null,
      }
    }
  })

  ipcMain.handle(
    "git:checkout",
    async (_event, cwd: string, branch: string) => {
      if (!cwd || !branch) return { ok: false, error: "no-branch" }
      try {
        await runGit(cwd, ["checkout", branch])
        return { ok: true }
      } catch (err) {
        const e = err as { stderr?: string; message?: string }
        return { ok: false, error: e.stderr || e.message || "checkout failed" }
      }
    }
  )

  ipcMain.handle(
    "git:createBranch",
    async (_event, cwd: string, branch: string) => {
      if (!cwd || !branch) return { ok: false, error: "no-branch" }
      const name = branch.trim()
      if (!name || /\s/.test(name)) {
        return { ok: false, error: "invalid-branch-name" }
      }
      try {
        await runGit(cwd, ["checkout", "-b", name])
        return { ok: true }
      } catch (err) {
        const e = err as { stderr?: string; message?: string }
        return {
          ok: false,
          error: e.stderr || e.message || "create branch failed",
        }
      }
    }
  )

  ipcMain.handle("git:aheadBehind", async (_event, cwd: string) => {
    if (!cwd) return { ok: false, ahead: 0, behind: 0, hasUpstream: false }
    try {
      // Throws when no upstream configured — treat as "no upstream".
      const out = await runGit(cwd, [
        "rev-list",
        "--left-right",
        "--count",
        "@{upstream}...HEAD",
      ])
      const m = out.trim().match(/^(\d+)\s+(\d+)/)
      if (!m) return { ok: true, ahead: 0, behind: 0, hasUpstream: true }
      return {
        ok: true,
        behind: parseInt(m[1], 10),
        ahead: parseInt(m[2], 10),
        hasUpstream: true,
      }
    } catch {
      return { ok: true, ahead: 0, behind: 0, hasUpstream: false }
    }
  })

  ipcMain.handle("git:pull", async (_event, cwd: string) => {
    if (!cwd) return { ok: false, error: "no-cwd" }
    try {
      // Rebase (not --ff-only) so diverging branches reconcile: local commits
      // replay on top of the remote instead of aborting with "not possible to
      // fast-forward". --autostash tolerates a dirty working tree.
      await runGitWithProjectEnv(cwd, ["pull", "--rebase", "--autostash"])
      return { ok: true }
    } catch (err) {
      const e = err as { stderr?: string; message?: string }
      return { ok: false, error: e.stderr || e.message || "pull failed" }
    }
  })

  ipcMain.handle("git:push", async (_event, cwd: string) => {
    if (!cwd) return { ok: false, error: "no-cwd" }
    try {
      await runGitWithProjectEnv(cwd, ["push"])
      return { ok: true }
    } catch (err) {
      const e = err as { stderr?: string; message?: string }
      return { ok: false, error: e.stderr || e.message || "push failed" }
    }
  })

  ipcMain.handle(
    "git:publishBranch",
    async (_event, cwd: string, branch: string) => {
      const currentBranch = branch?.trim()
      if (!cwd || !currentBranch) return { ok: false, error: "no-branch" }
      try {
        await runGitWithProjectEnv(cwd, ["push", "-u", "origin", currentBranch])
        return { ok: true }
      } catch (err) {
        const e = err as { stderr?: string; message?: string }
        return {
          ok: false,
          error: e.stderr || e.message || "publish branch failed",
        }
      }
    }
  )

  ipcMain.handle(
    "git:openPullRequest",
    async (_event, cwd: string, number: number) => {
      if (!cwd || !Number.isInteger(number) || number <= 0) {
        return { ok: false, error: "invalid-pull-request" }
      }
      try {
        await runGh(cwd, ["pr", "view", String(number), "--web"])
        return { ok: true }
      } catch (err) {
        const e = err as { stderr?: string; message?: string }
        return {
          ok: false,
          error: e.stderr || e.message || "open pull request failed",
        }
      }
    }
  )

  ipcMain.handle(
    "git:checkoutPullRequest",
    async (_event, cwd: string, number: number) => {
      if (!cwd || !Number.isInteger(number) || number <= 0) {
        return { ok: false, error: "invalid-pull-request" }
      }
      try {
        await runGh(cwd, ["pr", "checkout", String(number)])
        return { ok: true }
      } catch (err) {
        const e = err as { stderr?: string; message?: string }
        return {
          ok: false,
          error: e.stderr || e.message || "checkout pull request failed",
        }
      }
    }
  )

  ipcMain.handle(
    "git:openBranchOnGitHub",
    async (_event, cwd: string, branch: string) => {
      const currentBranch = branch?.trim()
      if (!cwd || !currentBranch) {
        return { ok: false, error: "no-branch" }
      }
      try {
        // Build the URL from the local remote instead of `gh browse`, which
        // makes a GitHub API round-trip and is noticeably slower.
        const remote = (
          await runGit(cwd, ["remote", "get-url", "origin"])
        ).trim()
        const repoUrl = githubRemoteToWebUrl(remote)
        if (!repoUrl) return { ok: false, error: "no-github-remote" }
        await shell.openExternal(
          `${repoUrl}/tree/${currentBranch
            .split("/")
            .map(encodeURIComponent)
            .join("/")}`
        )
        return { ok: true }
      } catch (err) {
        const e = err as { stderr?: string; message?: string }
        return {
          ok: false,
          error: e.stderr || e.message || "open branch failed",
        }
      }
    }
  )

  ipcMain.handle(
    "git:createPullRequest",
    async (_event, cwd: string, branch: string) => {
      const currentBranch = branch?.trim()
      if (!cwd || !currentBranch) {
        return { ok: false, error: "no-branch" }
      }
      try {
        await runGh(cwd, [
          "pr",
          "create",
          "--web",
          "--fill",
          "--head",
          currentBranch,
        ])
        return { ok: true }
      } catch (err) {
        const e = err as { stderr?: string; message?: string }
        return {
          ok: false,
          error: e.stderr || e.message || "create pull request failed",
        }
      }
    }
  )

  ipcMain.handle(
    "git:diffFile",
    async (_event, cwd: string, filePath: string, staged: boolean) => {
      if (!cwd || !filePath) return { ok: false, error: "no-path", patch: "" }
      try {
        const args = ["diff", "--no-color"]
        if (staged) args.push("--cached")
        args.push("--", filePath)
        let patch = await runGitAllowExit1(cwd, args)
        // Empty result for an unstaged path may mean an untracked new file —
        // synthesize a diff vs /dev/null the way diffAll does.
        if (!patch.trim() && !staged) {
          patch = await buildUntrackedPatch(cwd, [filePath])
        }
        return { ok: true, patch }
      } catch (err) {
        return { ok: false, error: (err as Error).message, patch: "" }
      }
    }
  )

  ipcMain.handle(
    "git:readDiffMedia",
    async (
      _event,
      cwd: string,
      filePath: string,
      staged: boolean,
      kind: "image" | "audio" | "pdf"
    ) => {
      if (!cwd || !filePath) return { ok: false, error: "no-path" }
      try {
        const fullPath = path.resolve(cwd, filePath)
        if (!staged && !isPathInside(cwd, fullPath)) {
          return { ok: false, error: "outside-project" }
        }
        const buf = staged
          ? await runGitBuffer(cwd, ["show", `:${filePath}`])
          : await fs.readFile(fullPath)
        const mimeByExt =
          kind === "image"
            ? imageMimeByExt
            : kind === "audio"
              ? audioMimeByExt
              : pdfMimeByExt
        return mediaDataUrlFromBuffer(
          filePath,
          buf,
          mimeByExt,
          kind === "image" ? 25 * 1024 * 1024 : 100 * 1024 * 1024
        )
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle("git:diffAll", async (_event, cwd: string) => {
    if (!cwd) {
      return { ok: false, error: "no-cwd", unstagedPatch: "", stagedPatch: "" }
    }
    try {
      const [unstagedRaw, stagedPatch, statusRaw] = await Promise.all([
        runGit(cwd, ["diff", "--no-color"]),
        runGit(cwd, ["diff", "--no-color", "--cached"]),
        runGit(cwd, [
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
        ]),
      ])
      const untracked = parseGitStatus(statusRaw)
        .unstaged.filter((file) => file.status === "A")
        .map((file) => file.path)
      const untrackedPatch = await buildUntrackedPatch(cwd, untracked)
      const unstagedPatch = [unstagedRaw, untrackedPatch]
        .filter(Boolean)
        .join("\n")
      return { ok: true, unstagedPatch, stagedPatch }
    } catch (err) {
      return {
        ok: false,
        error: (err as Error).message,
        unstagedPatch: "",
        stagedPatch: "",
      }
    }
  })

  ipcMain.handle(
    "term:create",
    async (
      event,
      opts: {
        cwd: string
        cols?: number
        rows?: number
        theme?: "light" | "dark"
        projectId?: string | null
        sessionId?: string
      }
    ) => {
      const client = await getDaemonClient()
      const resolved = buildOpenOptions({
        cwd: opts.cwd,
        cols: opts.cols,
        rows: opts.rows,
        theme: opts.theme,
      })
      const id = opts.sessionId ?? randomUUID()
      resolved.env = {
        ...resolved.env,
        ...hookEnv(id),
      }
      await client.open(resolved, id)
      sessionOwners.set(id, event.sender.id)
      sessionProjects.set(id, opts.projectId ?? null)
      wireSessionEvents(client, id)
      return { id }
    }
  )

  ipcMain.handle(
    "term:adopt",
    async (event, sessionId: string, projectId?: string | null) => {
      const client = await getDaemonClient()
      const res = await client.attach(sessionId)
      if (!res.ok) return { ok: false }
      sessionOwners.set(sessionId, event.sender.id)
      sessionProjects.set(sessionId, projectId ?? null)
      wireSessionEvents(client, sessionId)
      return {
        ok: true,
        replay: res.replay,
        cols: res.cols,
        rows: res.rows,
      }
    }
  )

  ipcMain.handle("term:snapshot", async (_e, id: string) => {
    return daemonClient?.snapshot(id) ?? ""
  })

  ipcMain.on(
    "term:write",
    (_e, id: string, data: string, skipCapture?: boolean) => {
      daemonClient?.write(id, data)
      if (data.includes("\r") || data.includes("\n")) {
        sessionLastEnter.set(id, Date.now())
      }
      // App-injected writes (e.g. summarize prompts) pass skipCapture to keep
      // them out of the user's chat history.
      if (!skipCapture) void captureInput(id, data)
    }
  )

  ipcMain.on("term:resize", (_e, id: string, cols: number, rows: number) => {
    try {
      daemonClient?.resize(id, cols, rows)
    } catch {
      // ignore resize errors on dead PTYs
    }
  })

  ipcMain.handle("term:cwd", async (_e, id: string) => {
    const pid = daemonClient?.getPid(id)
    if (!pid) return null
    try {
      if (process.platform === "linux") {
        return await fs.readlink(`/proc/${pid}/cwd`)
      }
      // macOS / BSD: lsof reports the shell's cwd. Use -F so output is stable.
      const { stdout } = await execFileP("/usr/sbin/lsof", [
        "-a",
        "-p",
        String(pid),
        "-d",
        "cwd",
        "-Fn",
      ])
      for (const line of stdout.split("\n")) {
        if (line.startsWith("n")) return line.slice(1)
      }
      return null
    } catch {
      return null
    }
  })

  ipcMain.handle("term:agentStatus", async (_e, id: string) => {
    const pid = daemonClient?.getPid(id)
    if (!pid) return { running: false } satisfies AgentStatusInfo
    return detectPtyAgent(pid)
  })

  ipcMain.handle(
    "term:agentSessionTitle",
    async (
      _e,
      args: { agent: TerminalAgentName; agentSessionId: string }
    ): Promise<string | null> => {
      return getAgentSessionTitle(args.agent, args.agentSessionId)
    }
  )

  ipcMain.on("term:kill", (_e, id: string) => {
    daemonClient?.kill(id)
    sessionOwners.delete(id)
    sessionProjects.delete(id)
    sessionLastEnter.delete(id)
    runningShellCommands.delete(id)
    inputCapture.dispose(id)
  })

  ipcMain.handle("history:serverInfo", () => ({
    port: getHistoryServerPort(),
  }))

  ipcMain.handle("term:history:list", async (_e, sessionId: string) => {
    return appDb.listForSession(sessionId)
  })

  ipcMain.handle(
    "term:history:listProject",
    async (_e, projectId: string, limit?: number) => {
      return appDb.listForProject(projectId, limit ?? 500)
    }
  )

  ipcMain.handle("term:history:latestByProject", async () => {
    return appDb.latestByProject()
  })

  ipcMain.handle("term:notes:get", async (_e, projectId: string) => {
    if (!projectId) return null
    return appDb.getProjectNote(projectId)
  })

  ipcMain.handle(
    "term:notes:save",
    async (_e, projectId: string, body: string) => {
      if (!projectId) return { ok: false }
      const note = await appDb.saveProjectNote(projectId, body ?? "")
      return { ok: true, note }
    }
  )

  ipcMain.handle("term:history:delete", async (event, id: string) => {
    const msg = await appDb.deleteMessage(id)
    if (!msg) return { ok: false }
    const sender = event.sender
    if (sender && !sender.isDestroyed()) {
      sender.send(`term:history:deleted:${msg.sessionId}`, msg.id)
      if (msg.projectId) {
        sender.send(`term:history:projectDeleted:${msg.projectId}`, msg.id)
      }
    }
    return { ok: true }
  })

  ipcMain.handle(
    "term:history:clearProject",
    async (event, projectId: string, sinceMs?: number) => {
      await appDb.clearForProject(projectId, sinceMs)
      const sender = event.sender
      if (sender && !sender.isDestroyed()) {
        sender.send(`term:history:projectCleared:${projectId}`, sinceMs)
      }
      return { ok: true }
    }
  )

  ipcMain.handle(
    "term:history:migrateProjectIds",
    async (_event, migrations: Array<{ from: string; to: string }>) => {
      await appDb.migrateProjectIds(
        Array.isArray(migrations) ? migrations : []
      )
      return { ok: true }
    }
  )

  ipcMain.handle("term:history:clear", async (event, sessionId: string) => {
    const projectId =
      sessionProjects.get(sessionId) ??
      (await appDb.projectIdForSession(sessionId))
    await appDb.clearForSession(sessionId)
    const sender = event.sender
    if (projectId && sender && !sender.isDestroyed()) {
      sender.send(`term:history:projectSessionCleared:${projectId}`, sessionId)
    }
    return { ok: true }
  })

  try {
    await getDaemonClient()
    await reconcileDaemonSessions()
  } catch (err) {
    console.error("[pty-daemon] failed to start", err)
  }

  startHistoryRetentionSweep()
  createWindow()
})

const HISTORY_RETENTION_ENABLED_STATE_KEY = "gearshift.historyRetentionEnabled"
const HISTORY_RETENTION_DAYS_STATE_KEY = "gearshift.historyRetentionDays"
const HISTORY_RETENTION_MIN_DAYS = 1
const HISTORY_RETENTION_DEFAULT_DAYS = 30
const HISTORY_RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000

let historyRetentionTimer: NodeJS.Timeout | undefined

async function pruneChatHistory(): Promise<void> {
  try {
    const state = await readState()
    // Enabled by default: only an explicit "0" disables the sweep.
    if (state[HISTORY_RETENTION_ENABLED_STATE_KEY] === "0") return
    const raw = state[HISTORY_RETENTION_DAYS_STATE_KEY]
    const parsed = raw == null ? NaN : Math.floor(Number(raw))
    const days = Number.isFinite(parsed)
      ? Math.max(HISTORY_RETENTION_MIN_DAYS, parsed)
      : HISTORY_RETENTION_DEFAULT_DAYS
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    const removed = await appDb.pruneOlderThan(cutoff)
    if (removed > 0) {
      console.log(`[history] pruned ${removed} message(s) older than ${days}d`)
    }
  } catch (err) {
    console.error("[history] retention sweep failed", err)
  }
}

function startHistoryRetentionSweep(): void {
  void pruneChatHistory()
  historyRetentionTimer = setInterval(() => {
    void pruneChatHistory()
  }, HISTORY_RETENTION_SWEEP_INTERVAL_MS)
}

app.on("before-quit", () => {
  closeAgentHookServer()
  closeHistoryServer()
  cliOpenServer?.close()
  cliOpenServer = null
  // Sessions outlive Electron. Just detach the client; the daemon keeps
  // PTYs alive until the user kills them, the daemon's own no-clients
  // grace timer fires, or the 24h per-session idle sweep triggers.
  daemonClient?.disconnect()
  sessionOwners.clear()
  sessionProjects.clear()
  inputCapture.disposeAll()
  if (historyRetentionTimer) {
    clearInterval(historyRetentionTimer)
    historyRetentionTimer = undefined
  }
  void appDb.closeDb()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
