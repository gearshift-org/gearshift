import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  shell,
} from "electron"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import fs from "node:fs/promises"
import { randomUUID } from "node:crypto"
import parcelWatcher from "@parcel/watcher"
import { ensureDaemonRunning } from "./daemonSupervisor"
import { DaemonClient } from "./pty-daemon/client"
import { buildOpenOptions } from "./pty-daemon/spawnOpts"
import * as chatDb from "./db/chatDb"
import * as inputCapture from "./inputCapture"
import {
  closeAgentHookServer,
  hookEnv,
  installAgentHooks,
  startAgentHookServer,
  type AgentHookEvent,
  type TerminalAgentName,
} from "./agentHooks"

type ParcelSubscription = Awaited<ReturnType<typeof parcelWatcher.subscribe>>

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const execFileP = promisify(execFile)

type PullRequestInfo = {
  number: number
  id: string
  title: string
  url: string
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
} else {
  // Use the bundle id as the userData folder name so uninstallers
  // (Raycast, AppCleaner, etc.) can correlate leftover state to the app.
  app.setPath("userData", path.join(app.getPath("appData"), "com.gearshift"))
}

let daemonClient: DaemonClient | null = null
let daemonConnectPromise: Promise<DaemonClient> | null = null

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

function gitignoreToGlobs(line: string): string[] {
  let p = line.trim()
  if (!p || p.startsWith("#") || p.startsWith("!")) return []
  // strip trailing slash; we'll match both file and dir contents below
  const dirOnly = p.endsWith("/")
  if (dirOnly) p = p.slice(0, -1)
  // anchored to repo root
  if (p.startsWith("/")) {
    p = p.slice(1)
    return dirOnly ? [`${p}/**`] : [p, `${p}/**`]
  }
  // unanchored — match anywhere in tree
  return dirOnly ? [`**/${p}/**`] : [`**/${p}`, `**/${p}/**`]
}

async function readGitignoreGlobs(cwd: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.join(cwd, ".gitignore"), "utf8")
    return raw.split(/\r?\n/).flatMap(gitignoreToGlobs)
  } catch {
    return []
  }
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
  if (
    basenames.some((base) => base === "gemini" || base === "gemini-cli") ||
    hasPathSegment("gemini-cli") ||
    hasPathSegment("@google/gemini-cli")
  ) {
    return "gemini"
  }
  return undefined
}

async function detectPtyAgent(rootPid: number): Promise<AgentStatusInfo> {
  if (process.platform === "win32") return { running: false }

  try {
    const { stdout } = await execFileP("/bin/ps", [
      "-axo",
      "pid=,ppid=,command=",
    ])
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

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 11 },
    // Dark default so the brief pre-paint frame isn't a jarring white flash
    // while Vite/React boot. Window itself shows immediately.
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"))
  }
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
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: "about" },
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

async function runGitAllowExit1(cwd: string, args: string[]): Promise<string> {
  try {
    return await runGit(cwd, args)
  } catch (err) {
    const e = err as { code?: number; stdout?: string }
    if (e.code === 1 && typeof e.stdout === "string") return e.stdout
    throw err
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

function parsePullRequest(raw: string): PullRequestInfo | null {
  try {
    const parsed = JSON.parse(raw) as PullRequestInfo[]
    const pr = parsed[0]
    if (
      !pr ||
      typeof pr.number !== "number" ||
      typeof pr.id !== "string" ||
      typeof pr.title !== "string" ||
      typeof pr.url !== "string"
    ) {
      return null
    }
    return pr
  } catch {
    return null
  }
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

function parseGitStatus(raw: string) {
  const staged: Array<{ path: string; status: string }> = []
  const unstaged: Array<{ path: string; status: string }> = []
  // -z output is NUL-separated. Rename/copy entries take TWO tokens
  // (newpath\0oldpath) and we need to advance the cursor past the second one.
  const tokens = raw.split("\0")

  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i]
    if (!entry || entry.length < 3) continue
    const x = entry[0]
    const y = entry[1]
    const filePath = entry.slice(3)

    if (x === "?" && y === "?") {
      unstaged.push({ path: filePath, status: "A" })
      continue
    }
    if (x !== " " && x !== "?") staged.push({ path: filePath, status: x })
    if (y !== " " && y !== "?") unstaged.push({ path: filePath, status: y })
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
        if (isProbablyBinaryBuffer(buf)) return ""
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

function stateFilePath(): string {
  return path.join(app.getPath("userData"), "state.json")
}

async function readState(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(stateFilePath(), "utf8")
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") out[k] = v
      }
      return out
    }
  } catch {
    // missing or corrupt → start empty
  }
  return {}
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
  const file = stateFilePath()
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8")
    await fs.rename(tmp, file)
  } catch (err) {
    console.error("state write failed", err)
  } finally {
    stateWriteInFlight = false
    if (pendingState) void flushState()
  }
}

app.whenReady().then(async () => {
  buildMenu()
  // The socket server must be listening before any agent tries to connect, so
  // we still await it — but it's just a Unix-socket bind, milliseconds.
  try {
    await startAgentHookServer(sendAgentHookEvent)
  } catch (err) {
    console.warn("[agent-hooks] socket server failed", err)
  }
  // Writing hook configs / plugins / extensions is pure file I/O across
  // several agent dirs and was previously blocking window creation. Run it in
  // the background — agents launched before it finishes will simply miss the
  // current run's hook updates and pick them up on the next start.
  void installAgentHooks().catch((err) => {
    console.warn("[agent-hooks] install failed", err)
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
    // Match the original Gearshift app: on macOS prefer `/usr/bin/open -a`
    // (launchd hand-off, instant) over the `code` CLI (boots Node).
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
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return false
      }
      await shell.openExternal(parsed.toString())
      return true
    } catch {
      return false
    }
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

  ipcMain.handle("fs:watchProject", async (_event, cwd: string) => {
    if (!cwd) return { ok: false, error: "no-cwd" }
    try {
      const watchId = randomUUID()
      const gitignoreGlobs = await readGitignoreGlobs(cwd)
      const ignore = [...WATCHER_IGNORE_BASE, ...gitignoreGlobs]
      const subscription = await parcelWatcher.subscribe(
        cwd,
        (err, events) => {
          if (err) return
          for (const ev of events) queueProjectWatchEvent(watchId, ev.path)
        },
        { ignore }
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
      const raw = await runGit(cwd, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ])
      return { ok: true, ...parseGitStatus(raw) }
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
      // Always hide .git; everything else is filtered by git check-ignore.
      const candidates = dirents
        .filter((d) => d.name !== ".git")
        .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
      if (candidates.length === 0) return { ok: true, entries: [] }

      // Find the enclosing repo root so check-ignore has a consistent cwd
      // (works for subdirectories too). Fall back to no filtering if not a repo.
      let repoRoot: string | null = null
      try {
        repoRoot = (
          await runGit(absPath, ["rev-parse", "--show-toplevel"])
        ).trim()
      } catch {
        repoRoot = null
      }

      if (!repoRoot) {
        return { ok: true, entries: candidates }
      }

      const relPaths = candidates.map((c) => {
        const full = path.join(absPath, c.name)
        const rel = path.relative(repoRoot!, full)
        return c.isDir ? `${rel}/` : rel
      })

      // git check-ignore exits 1 when nothing matches; 0 when matches; >1 on error.
      const ignored = new Set<string>()
      await new Promise<void>((resolve) => {
        const child = spawn("git", ["check-ignore", "--stdin", "-z"], {
          cwd: repoRoot!,
        })
        let buf = ""
        child.stdout.on("data", (d) => (buf += d.toString()))
        child.on("close", () => {
          for (const line of buf.split("\0")) {
            if (line) ignored.add(line.replace(/\/$/, ""))
          }
          resolve()
        })
        child.on("error", () => resolve())
        // `--stdin -z` requires every input path NUL-terminated, including
        // the last one — otherwise git silently fails to match it.
        child.stdin.write(relPaths.map((p) => p + "\0").join(""))
        child.stdin.end()
      })

      // Allow-list: .env, .env.local, .env.production etc. should appear in
      // the tree even when gitignored, since the user often needs to view
      // them in the app.
      const isAllowlistedDotenv = (name: string) =>
        name === ".env" || name.startsWith(".env.")

      const entries = candidates.filter((c) => {
        if (isAllowlistedDotenv(c.name)) return true
        const full = path.join(absPath, c.name)
        const rel = path.relative(repoRoot!, full)
        return !ignored.has(rel)
      })
      return { ok: true, entries }
    } catch (err) {
      return { ok: false, error: (err as Error).message, entries: [] }
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
      return { ok: true, files }
    } catch (err) {
      return { ok: false, error: (err as Error).message, files: [] }
    }
  })

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
      const [currentRaw, listRaw] = await Promise.all([
        runGitAllowExit1(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
        runGit(cwd, [
          "for-each-ref",
          "--format=%(refname:short)",
          "refs/heads/",
        ]),
      ])
      const current = currentRaw.trim()
      const branches = listRaw
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
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
        const expectedMissingRemote = message.includes("no git remotes found")
        if (
          signal !== "SIGINT" &&
          signal !== "SIGTERM" &&
          !expectedMissingRemote
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
      await runGit(cwd, ["pull", "--ff-only"])
      return { ok: true }
    } catch (err) {
      const e = err as { stderr?: string; message?: string }
      return { ok: false, error: e.stderr || e.message || "pull failed" }
    }
  })

  ipcMain.handle("git:push", async (_event, cwd: string) => {
    if (!cwd) return { ok: false, error: "no-cwd" }
    try {
      await runGit(cwd, ["push"])
      return { ok: true }
    } catch (err) {
      const e = err as { stderr?: string; message?: string }
      return { ok: false, error: e.stderr || e.message || "push failed" }
    }
  })

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
        const args = ["diff", "--no-color", "--text"]
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

  ipcMain.handle("git:diffAll", async (_event, cwd: string) => {
    if (!cwd) {
      return { ok: false, error: "no-cwd", unstagedPatch: "", stagedPatch: "" }
    }
    try {
      const [unstagedRaw, stagedPatch, statusRaw] = await Promise.all([
        runGit(cwd, ["diff", "--no-color", "--text"]),
        runGit(cwd, ["diff", "--no-color", "--text", "--cached"]),
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
      }
    ) => {
      const client = await getDaemonClient()
      const resolved = buildOpenOptions({
        cwd: opts.cwd,
        cols: opts.cols,
        rows: opts.rows,
        theme: opts.theme,
      })
      const id = randomUUID()
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

  ipcMain.on("term:write", (_e, id: string, data: string) => {
    daemonClient?.write(id, data)
    void captureInput(id, data)
  })

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

  ipcMain.on("term:kill", (_e, id: string) => {
    daemonClient?.kill(id)
    sessionOwners.delete(id)
    sessionProjects.delete(id)
    inputCapture.dispose(id)
  })

  ipcMain.handle("term:history:list", async (_e, sessionId: string) => {
    return chatDb.listForSession(sessionId)
  })

  ipcMain.handle("term:history:clear", async (_e, sessionId: string) => {
    chatDb.clearForSession(sessionId)
    return { ok: true }
  })

  try {
    await getDaemonClient()
    await reconcileDaemonSessions()
  } catch (err) {
    console.error("[pty-daemon] failed to start", err)
  }

  createWindow()
})

app.on("before-quit", () => {
  closeAgentHookServer()
  // Sessions outlive Electron. Just detach the client; the daemon keeps
  // PTYs alive until the user kills them, the daemon's own no-clients
  // grace timer fires, or the 24h per-session idle sweep triggers.
  daemonClient?.disconnect()
  sessionOwners.clear()
  sessionProjects.clear()
  inputCapture.disposeAll()
  chatDb.closeDb()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
