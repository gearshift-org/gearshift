import { app } from "electron"
import * as path from "node:path"
import * as fs from "node:fs"
import * as net from "node:net"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const MANIFEST_FILENAME = "pty-daemon.json"
const SOCKET_FILENAME = "pty-daemon.sock"
const LOG_FILENAME = "pty-daemon.log"
const READY_TIMEOUT_MS = 5_000

interface Manifest {
  pid: number
  socket: string
  spawnedAt: number
}

function userDataDir(): string {
  return app.getPath("userData")
}

function manifestPath(): string {
  return path.join(userDataDir(), MANIFEST_FILENAME)
}

function socketPath(): string {
  return path.join(userDataDir(), SOCKET_FILENAME)
}

function logPath(): string {
  return path.join(userDataDir(), LOG_FILENAME)
}

function readManifest(): Manifest | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath(), "utf8")) as Manifest
    if (
      typeof parsed.pid === "number" &&
      typeof parsed.socket === "string" &&
      typeof parsed.spawnedAt === "number"
    ) {
      return parsed
    }
  } catch {
    // missing or malformed
  }
  return null
}

function writeManifest(m: Manifest): void {
  fs.mkdirSync(userDataDir(), { recursive: true })
  fs.writeFileSync(manifestPath(), JSON.stringify(m, null, 2))
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function socketReachable(socket: string, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection(socket)
    const timer = setTimeout(() => {
      s.destroy()
      resolve(false)
    }, timeoutMs)
    s.once("connect", () => {
      clearTimeout(timer)
      s.destroy()
      resolve(true)
    })
    s.once("error", () => {
      clearTimeout(timer)
      s.destroy()
      resolve(false)
    })
  })
}

function daemonScriptPath(): string {
  // ESM equivalent of __dirname. After build, this resolves to
  // dist-electron/, and the daemon lives in dist-electron/pty-daemon/main.cjs
  // (cjs to side-step the package.json "type": "module" inheritance).
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.join(here, "pty-daemon", "main.cjs")
}

async function waitForSocket(socket: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await socketReachable(socket, 200)) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`pty-daemon socket not reachable within ${timeoutMs}ms`)
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function spawnDetachedDaemon(
  socket: string,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  if (process.platform === "win32") {
    const logFd = fs.openSync(logPath(), "a")
    const child = spawn(
      process.execPath,
      [daemonScriptPath(), `--socket=${socket}`],
      {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env,
        cwd: userDataDir(),
      },
    )
    child.on("error", (err) => {
      fs.appendFileSync(logPath(), `[supervisor] spawn error: ${err.message}\n`)
    })
    child.unref()
    try {
      fs.closeSync(logFd)
    } catch {
      // ignore
    }
    if (!child.pid) throw new Error("failed to spawn pty-daemon (no pid)")
    return child.pid
  }

  // In development, test harnesses often restart the app by killing the whole
  // process tree. A normal detached child still appears as Electron's child
  // until Electron exits, so the tree killer terminates it and terminal
  // sessions cannot survive a dev restart. Spawn through a short-lived shell
  // that backgrounds the daemon and exits immediately; launchd then reparents
  // the daemon so app restarts can adopt the existing PTYs.
  const command = [
    shellQuote(process.execPath),
    shellQuote(daemonScriptPath()),
    shellQuote(`--socket=${socket}`),
    ">>",
    shellQuote(logPath()),
    "2>&1",
    "<",
    "/dev/null",
    "&",
    "echo $!",
  ].join(" ")

  const shell = spawn("/bin/sh", ["-c", command], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
    env,
    cwd: userDataDir(),
  })
  shell.unref()

  const stdout = await new Promise<string>((resolve, reject) => {
    let out = ""
    shell.stdout?.on("data", (chunk) => {
      out += chunk.toString("utf8")
    })
    shell.on("error", reject)
    shell.on("close", (code) => {
      if (code === 0) resolve(out)
      else reject(new Error(`pty-daemon launcher exited with code ${code}`))
    })
  })
  const pid = Number.parseInt(stdout.trim(), 10)
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error("failed to spawn pty-daemon (no pid)")
  }
  return pid
}

async function spawnDaemon(): Promise<Manifest> {
  const socket = socketPath()
  try {
    fs.unlinkSync(socket)
  } catch {
    // not there
  }
  fs.mkdirSync(userDataDir(), { recursive: true })

  // ELECTRON_RUN_AS_NODE: makes Electron's binary behave as plain Node so
  // the daemon runs under the same V8/ABI node-pty was built against.
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
  const pid = await spawnDetachedDaemon(socket, env)

  await waitForSocket(socket, READY_TIMEOUT_MS)

  const manifest: Manifest = {
    pid,
    socket,
    spawnedAt: Date.now(),
  }
  writeManifest(manifest)
  return manifest
}

export interface DaemonHandle {
  socket: string
  pid: number
  adopted: boolean
}

export async function ensureDaemonRunning(): Promise<DaemonHandle> {
  const existing = readManifest()
  if (
    existing &&
    isPidAlive(existing.pid) &&
    (await socketReachable(existing.socket))
  ) {
    return { socket: existing.socket, pid: existing.pid, adopted: true }
  }
  const fresh = await spawnDaemon()
  return { socket: fresh.socket, pid: fresh.pid, adopted: false }
}
