import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu } from "electron"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import fs from "node:fs/promises"
import * as pty from "node-pty"
import parcelWatcher from "@parcel/watcher"

type ParcelSubscription = Awaited<ReturnType<typeof parcelWatcher.subscribe>>

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const execFileP = promisify(execFile)

const ptys = new Map<string, pty.IPty>()
const projectWatchers = new Map<
  string,
  {
    cwd: string
    subscription: ParcelSubscription
    paths: Set<string>
    timer?: NodeJS.Timeout
  }
>()

const WATCHER_IGNORE_BASE = [
  "**/.git/**",
  "**/.DS_Store",
]

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

function defaultShell(): string {
  if (process.platform === "win32") return process.env.COMSPEC || "powershell.exe"
  return process.env.SHELL || "/bin/zsh"
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
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
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win) return
  win.webContents.send(channel)
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
          accelerator: "CmdOrCtrl+T",
          click: () => sendToFocused("app:new-terminal"),
        },
        {
          label: "Close Terminal",
          accelerator: "CmdOrCtrl+W",
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

function queueProjectWatchEvent(watchId: string, filePath?: string | Buffer | null) {
  const entry = projectWatchers.get(watchId)
  if (!entry) return
  if (filePath) entry.paths.add(String(filePath))
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => flushProjectWatch(watchId), 150)
}

function parseGitStatus(raw: string) {
  const staged: Array<{ path: string; status: string }> = []
  const unstaged: Array<{ path: string; status: string }> = []
  const entries = raw.split("\0").filter(Boolean)

  for (const entry of entries) {
    if (entry.length < 3) continue
    const x = entry[0]
    const y = entry[1]
    const filePath = entry.slice(3)

    if (x === "?" && y === "?") {
      unstaged.push({ path: filePath, status: "A" })
      continue
    }
    if (x !== " " && x !== "?") staged.push({ path: filePath, status: x })
    if (y !== " " && y !== "?") unstaged.push({ path: filePath, status: y })
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
            `diff --git a/${filePath} b/${filePath}`,
          )
          .replace(/^--- a\/dev\/null$/m, "--- /dev/null")
      } catch {
        return ""
      }
    }),
  )
  return patches.filter(Boolean).join("\n")
}

app.whenReady().then(() => {
  buildMenu()

  ipcMain.handle("clipboard:hasImage", () => {
    try {
      return !clipboard.readImage().isEmpty()
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
        { ignore },
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
      const raw = await runGit(cwd, ["status", "--porcelain=v1", "-z"])
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

  ipcMain.handle("git:diffAll", async (_event, cwd: string) => {
    if (!cwd) {
      return { ok: false, error: "no-cwd", unstagedPatch: "", stagedPatch: "" }
    }
    try {
      const [unstagedRaw, stagedPatch, statusRaw] = await Promise.all([
        runGit(cwd, ["diff", "--no-color", "--text"]),
        runGit(cwd, ["diff", "--no-color", "--text", "--cached"]),
        runGit(cwd, ["status", "--porcelain=v1", "-z"]),
      ])
      const untracked = parseGitStatus(statusRaw).unstaged
        .filter((file) => file.status === "A")
        .map((file) => file.path)
      const untrackedPatch = await buildUntrackedPatch(cwd, untracked)
      const unstagedPatch = [unstagedRaw, untrackedPatch].filter(Boolean).join("\n")
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
      opts: { cwd: string; cols?: number; rows?: number },
    ) => {
      const id = randomUUID()
      const proc = pty.spawn(defaultShell(), [], {
        name: "xterm-color",
        cwd: opts.cwd,
        cols: opts.cols ?? 80,
        rows: opts.rows ?? 24,
        env: process.env as Record<string, string>,
      })
      ptys.set(id, proc)

      const sender = event.sender
      proc.onData((chunk) => {
        if (sender.isDestroyed()) return
        sender.send(`term:data:${id}`, chunk)
      })
      proc.onExit((info) => {
        if (!sender.isDestroyed()) {
          sender.send(`term:exit:${id}`, info)
        }
        ptys.delete(id)
      })

      return { id }
    },
  )

  ipcMain.on("term:write", (_e, id: string, data: string) => {
    ptys.get(id)?.write(data)
  })

  ipcMain.on("term:resize", (_e, id: string, cols: number, rows: number) => {
    try {
      ptys.get(id)?.resize(cols, rows)
    } catch {
      // ignore resize errors on dead PTYs
    }
  })

  ipcMain.on("term:kill", (_e, id: string) => {
    const proc = ptys.get(id)
    if (!proc) return
    try {
      proc.kill()
    } catch {
      // ignore
    }
    ptys.delete(id)
  })

  createWindow()
})

app.on("before-quit", () => {
  for (const proc of ptys.values()) {
    try {
      proc.kill()
    } catch {
      // ignore
    }
  }
  ptys.clear()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
