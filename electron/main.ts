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
import { randomUUID } from "node:crypto"
import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import fs from "node:fs/promises"
import * as pty from "node-pty"
import parcelWatcher from "@parcel/watcher"

type ParcelSubscription = Awaited<ReturnType<typeof parcelWatcher.subscribe>>

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const execFileP = promisify(execFile)

if (VITE_DEV_SERVER_URL) {
  app.setPath("userData", path.join(app.getPath("appData"), "gearshift-v2-dev"))
}

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
    trafficLightPosition: { x: 16, y: 11 },
    // Dark default so the brief pre-paint frame isn't a jarring white flash
    // while Vite/React boot. Window itself shows immediately.
    backgroundColor: "#0a0a0a",
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

app.whenReady().then(() => {
  buildMenu()

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

  ipcMain.handle(
    "fs:readDir",
    async (_event, absPath: string) => {
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
    },
  )

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
    },
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

  ipcMain.handle(
    "git:stage",
    async (_event, cwd: string, paths: string[]) => {
      if (!cwd || !paths?.length) return { ok: false, error: "no-paths" }
      try {
        await runGit(cwd, ["add", "--", ...paths])
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },
  )

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
    },
  )

  ipcMain.handle(
    "git:commit",
    async (_event, cwd: string, message: string) => {
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
    },
  )

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
    },
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
    },
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
    },
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
    "git:diffFile",
    async (
      _event,
      cwd: string,
      filePath: string,
      staged: boolean,
    ) => {
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
    },
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
        name: "xterm-256color",
        cwd: opts.cwd,
        cols: opts.cols ?? 80,
        rows: opts.rows ?? 24,
        env: {
          ...(process.env as Record<string, string>),
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        },
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

  ipcMain.handle("term:cwd", async (_e, id: string) => {
    const proc = ptys.get(id)
    if (!proc) return null
    const pid = proc.pid
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
