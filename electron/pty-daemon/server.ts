import * as net from "net"
import * as fs from "fs"
import * as nodePty from "node-pty"
import type { IPty } from "node-pty"
import {
  FrameDecodeError,
  FrameDecoder,
  SUPPORTED_PROTOCOL_VERSIONS,
  encodeFrame,
  type ClientMessage,
  type ServerMessage,
} from "./protocol"

const DEFAULT_BUFFER_CAP = 256 * 1024

// Per-session idle threshold: kill the PTY (but leave the tab) after no user
// input for 48 h. Output, attach, and resize do not reset this timer: the goal
// is "user has not touched this terminal", not "process is quiet".
const SESSION_IDLE_TIMEOUT_MS = 48 * 60 * 60 * 1000
const IDLE_SWEEP_INTERVAL_MS = 5 * 60 * 1000
// Commit input activity at most once per second with a trailing update. This
// keeps keystroke bursts cheap while still making the final typed character the
// effective idle baseline.
const USER_ACTIVITY_DEBOUNCE_MS = 1_000

// Grace between SIGHUP and the SIGKILL fallback when terminating a session.
const KILL_GRACE_MS = 2_000
// After SIGKILL, give node-pty a short chance to emit onExit before we forcibly
// drop the session reference. This prevents stale PTY master fds from piling up
// when node-pty never observes the exit on macOS.
const FORCE_CLEANUP_GRACE_MS = 250

interface DestroyablePty extends IPty {
  destroy?: () => void
}

interface Session {
  id: string
  pty: DestroyablePty
  cols: number
  rows: number
  ringChunks: string[]
  ringBytes: number
  subscribers: Set<net.Socket>
  lastActivityAt: number
  pendingActivityAt: number | null
  activityTimer: NodeJS.Timeout | null
  outChunks: string[]
  outImmediate: NodeJS.Immediate | null
}

interface ClientState {
  decoder: FrameDecoder
  helloDone: boolean
  attached: Set<string>
}

export interface ServerOptions {
  socketPath: string
  daemonVersion: string
  bufferCap?: number
}

export class Server {
  private readonly socketPath: string
  private readonly daemonVersion: string
  private readonly bufferCap: number
  private readonly sessions = new Map<string, Session>()
  private readonly clients = new Map<net.Socket, ClientState>()
  private server: net.Server | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private sessionIdleSweep: NodeJS.Timeout | null = null

  constructor(opts: ServerOptions) {
    this.socketPath = opts.socketPath
    this.daemonVersion = opts.daemonVersion
    this.bufferCap = opts.bufferCap ?? DEFAULT_BUFFER_CAP
  }

  async listen(): Promise<void> {
    try {
      fs.unlinkSync(this.socketPath)
    } catch {
      // not there
    }
    await new Promise<void>((resolve, reject) => {
      const server = net.createServer((socket) => this.onConnection(socket))
      server.on("error", reject)
      server.listen(this.socketPath, () => {
        try {
          fs.chmodSync(this.socketPath, 0o600)
        } catch {
          // best effort
        }
        this.server = server
        resolve()
      })
    })
    this.startIdleWatch()
    this.startSessionIdleSweep()
  }

  async close(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (this.sessionIdleSweep) {
      clearInterval(this.sessionIdleSweep)
      this.sessionIdleSweep = null
    }
    const server = this.server
    this.server = null
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    for (const session of this.sessions.values()) {
      this.terminateSession(session)
    }
    this.sessions.clear()
    try {
      fs.unlinkSync(this.socketPath)
    } catch {
      // gone
    }
  }

  // Retire the daemon once every session has exited. 5-minute grace on boot
  // so a renewed app launch can reattach without racing a shutdown.
  private startIdleWatch(): void {
    const tick = () => {
      // Exit only when nobody is using us: no sessions AND no live clients.
      // Without the clients check, a renderer that connected during the grace
      // window but hasn't called open() yet would be cut adrift mid-handshake.
      if (this.sessions.size === 0 && this.clients.size === 0) {
        this.close().finally(() => process.exit(0))
        return
      }
      this.idleTimer = setTimeout(tick, 60_000)
      this.idleTimer.unref()
    }
    this.idleTimer = setTimeout(tick, 5 * 60_000)
    this.idleTimer.unref()
  }

  // Sweep every 5 min; force-stop any session idle for >= 48 h. The renderer
  // sees a normal exit event and flips the pane back to pending-start; the
  // tab entry stays in the project so the user can re-launch.
  private startSessionIdleSweep(): void {
    const sweep = () => {
      const now = Date.now()
      for (const session of this.sessions.values()) {
        if (now - session.lastActivityAt >= SESSION_IDLE_TIMEOUT_MS) {
          process.stderr.write(
            `[pty-daemon] session ${session.id} idle >48h, killing\n`,
          )
          this.terminateSession(session)
        }
      }
    }
    this.sessionIdleSweep = setInterval(sweep, IDLE_SWEEP_INTERVAL_MS)
    this.sessionIdleSweep.unref()
  }

  private onConnection(socket: net.Socket): void {
    const state: ClientState = {
      decoder: new FrameDecoder(),
      helloDone: false,
      attached: new Set(),
    }
    this.clients.set(socket, state)

    socket.on("data", (chunk) => {
      let msgs: ReturnType<typeof state.decoder.push>
      try {
        msgs = state.decoder.push(chunk)
      } catch (err) {
        if (err instanceof FrameDecodeError) {
          this.send(socket, { type: "error", reason: err.message })
          socket.destroy()
          return
        }
        throw err
      }
      for (const msg of msgs) {
        this.dispatch(socket, state, msg as ClientMessage)
      }
    })
    socket.on("close", () => {
      for (const sessionId of state.attached) {
        this.sessions.get(sessionId)?.subscribers.delete(socket)
      }
      this.clients.delete(socket)
    })
    socket.on("error", () => {
      // close follows
    })
  }

  private send(socket: net.Socket, msg: ServerMessage): void {
    if (socket.destroyed || !socket.writable) return
    socket.write(encodeFrame(msg))
  }

  private dispatch(
    socket: net.Socket,
    state: ClientState,
    msg: ClientMessage,
  ): void {
    if (msg.type === "hello") {
      const negotiated = msg.protocolVersions
        .filter((v) => SUPPORTED_PROTOCOL_VERSIONS.includes(v))
        .sort((a, b) => b - a)[0]
      if (negotiated == null) {
        this.send(socket, {
          type: "error",
          reason: `no compatible protocol version (we support ${SUPPORTED_PROTOCOL_VERSIONS.join(",")})`,
        })
        socket.end()
        return
      }
      state.helloDone = true
      this.send(socket, {
        type: "hello-ack",
        protocolVersion: negotiated,
        daemonVersion: this.daemonVersion,
      })
      return
    }
    if (!state.helloDone) {
      this.send(socket, { type: "error", reason: "handshake required" })
      socket.end()
      return
    }

    switch (msg.type) {
      case "open":
        return this.handleOpen(socket, state, msg)
      case "list":
        return this.handleList(socket)
      case "attach":
        return this.handleAttach(socket, state, msg)
      case "input":
        return this.handleInput(msg)
      case "resize":
        return this.handleResize(msg)
      case "close":
        return this.handleClose(msg)
    }
  }

  private handleList(socket: net.Socket): void {
    this.send(socket, {
      type: "list",
      sessions: Array.from(this.sessions.values(), (session) => ({
        sessionId: session.id,
        pid: session.pty.pid,
      })),
    })
  }

  private handleOpen(
    socket: net.Socket,
    state: ClientState,
    msg: Extract<ClientMessage, { type: "open" }>,
  ): void {
    if (this.sessions.has(msg.sessionId)) {
      this.send(socket, {
        type: "error",
        reason: `session already exists: ${msg.sessionId}`,
      })
      return
    }
    let pty: DestroyablePty
    try {
      pty = nodePty.spawn(msg.shell, msg.args, {
        name: "xterm-256color",
        cwd: msg.cwd,
        cols: msg.cols,
        rows: msg.rows,
        env: msg.env,
      })
    } catch (err) {
      this.send(socket, {
        type: "error",
        reason: `spawn failed: ${(err as Error).message}`,
        sessionId: msg.sessionId,
      })
      return
    }
    const session: Session = {
      id: msg.sessionId,
      pty,
      cols: msg.cols,
      rows: msg.rows,
      ringChunks: [],
      ringBytes: 0,
      subscribers: new Set([socket]),
      lastActivityAt: Date.now(),
      pendingActivityAt: null,
      activityTimer: null,
      outChunks: [],
      outImmediate: null,
    }
    this.sessions.set(msg.sessionId, session)
    state.attached.add(msg.sessionId)
    this.wirePtyEvents(session)
    this.send(socket, { type: "opened", sessionId: msg.sessionId, pid: pty.pid })
  }

  private handleAttach(
    socket: net.Socket,
    state: ClientState,
    msg: Extract<ClientMessage, { type: "attach" }>,
  ): void {
    const session = this.sessions.get(msg.sessionId)
    if (!session) {
      this.send(socket, {
        type: "error",
        reason: `no such session: ${msg.sessionId}`,
      })
      return
    }
    // Deliver any coalesced output to the *existing* subscribers before this
    // socket joins. Those bytes are already in the ring, so they go out in the
    // replay below — leaving them queued would send them to the new subscriber
    // a second time.
    this.flushOut(session)
    session.subscribers.add(socket)
    state.attached.add(msg.sessionId)
    this.send(socket, {
      type: "attached",
      sessionId: session.id,
      pid: session.pty.pid,
      cols: session.cols,
      rows: session.rows,
      replay: session.ringChunks.join(""),
    })
  }

  private handleInput(msg: Extract<ClientMessage, { type: "input" }>): void {
    const session = this.sessions.get(msg.sessionId)
    if (!session) return
    this.recordUserActivity(session)
    try {
      session.pty.write(msg.data)
    } catch {
      // pty dead — exit event will follow
    }
  }

  private handleResize(msg: Extract<ClientMessage, { type: "resize" }>): void {
    const session = this.sessions.get(msg.sessionId)
    if (!session) return
    const cols = Math.max(1, msg.cols)
    const rows = Math.max(1, msg.rows)
    session.cols = cols
    session.rows = rows
    try {
      session.pty.resize(cols, rows)
    } catch {
      // already exited
    }
  }

  private handleClose(msg: Extract<ClientMessage, { type: "close" }>): void {
    const session = this.sessions.get(msg.sessionId)
    if (!session) return
    this.terminateSession(session)
  }

  // Tear a session down so its PTY master fd is actually released. The shell
  // is a session/process-group leader (node-pty calls setsid), so we signal
  // the whole group — otherwise lingering grandchildren (e.g. MCP servers
  // spawned by the shell) keep the slave open, the master never EOFs, node-pty
  // never fires onExit, and the master fd leaks until the daemon dies. Past
  // leaks like this exhausted the system PTY table (kern.tty.ptmx_max).
  private terminateSession(session: Session): void {
    const pid = session.pty.pid
    const signalGroup = (signal: NodeJS.Signals) => {
      try {
        process.kill(-pid, signal) // negative pid → whole process group
      } catch {
        // group already gone
      }
    }
    signalGroup("SIGHUP")
    try {
      session.pty.kill() // let node-pty tear down its own socket/streams too
    } catch {
      // already dead
    }
    // Fallback: if the group ignored SIGHUP and onExit hasn't removed the
    // session yet, force it. If node-pty still doesn't emit onExit, destroy the
    // internal stream and drop our reference so the PTY master fd can close.
    // Unref timers so pending cleanup never holds the daemon open.
    const timer = setTimeout(() => {
      if (this.sessions.get(session.id) !== session) return
      signalGroup("SIGKILL")
      this.destroyPty(session)
      const cleanupTimer = setTimeout(() => {
        this.finalizeSession(session, 1, 9)
      }, FORCE_CLEANUP_GRACE_MS)
      cleanupTimer.unref()
    }, KILL_GRACE_MS)
    timer.unref()
  }

  private recordUserActivity(session: Session): void {
    const now = Date.now()
    session.pendingActivityAt = now
    // Immediate throttled update prevents a near-expired terminal from being
    // killed while the user is actively typing.
    if (now - session.lastActivityAt >= USER_ACTIVITY_DEBOUNCE_MS) {
      session.lastActivityAt = now
    }
    if (session.activityTimer) return
    session.activityTimer = setTimeout(() => {
      session.activityTimer = null
      if (session.pendingActivityAt != null) {
        session.lastActivityAt = session.pendingActivityAt
        session.pendingActivityAt = null
      }
    }, USER_ACTIVITY_DEBOUNCE_MS)
    session.activityTimer.unref()
  }

  private clearActivityTimer(session: Session): void {
    if (!session.activityTimer) return
    clearTimeout(session.activityTimer)
    session.activityTimer = null
    session.pendingActivityAt = null
  }

  private destroyPty(session: Session): void {
    try {
      session.pty.destroy?.()
    } catch {
      // already closed or unsupported by this node-pty build
    }
  }

  private finalizeSession(
    session: Session,
    exitCode: number,
    signal?: number,
  ): void {
    if (this.sessions.get(session.id) !== session) return
    this.clearActivityTimer(session)
    // The process's final output must reach subscribers before its exit.
    this.flushOut(session)
    const encoded = encodeFrame({
      type: "exit",
      sessionId: session.id,
      exitCode,
      signal,
    })
    for (const sub of session.subscribers) {
      if (!sub.destroyed && sub.writable) sub.write(encoded)
    }
    session.subscribers.clear()
    this.sessions.delete(session.id)
  }

  private appendToRing(session: Session, chunk: string): void {
    session.ringChunks.push(chunk)
    session.ringBytes += chunk.length
    while (
      session.ringBytes > this.bufferCap &&
      session.ringChunks.length > 1
    ) {
      const oldest = session.ringChunks.shift()
      if (oldest) session.ringBytes -= oldest.length
    }
    // Single chunk larger than the cap: tail-trim in place to stay bounded.
    if (
      session.ringBytes > this.bufferCap &&
      session.ringChunks.length === 1
    ) {
      const only = session.ringChunks[0]
      const trimmed = only.slice(-this.bufferCap)
      session.ringChunks[0] = trimmed
      session.ringBytes = trimmed.length
    }
  }

  // Coalesce everything node-pty emits within one event-loop turn into a
  // single frame. A busy TUI agent emits many small chunks per redraw, and
  // each frame costs the *client* (the Electron main process) a socket event
  // and a JSON.parse on the same thread that relays the user's keystrokes.
  // setImmediate runs at the end of the current turn, so this cuts frame count
  // sharply while adding no measurable delay.
  private flushOut(session: Session): void {
    if (session.outImmediate) {
      clearImmediate(session.outImmediate)
      session.outImmediate = null
    }
    if (session.outChunks.length === 0) return
    const data =
      session.outChunks.length === 1
        ? session.outChunks[0]
        : session.outChunks.join("")
    session.outChunks = []
    const encoded = encodeFrame({
      type: "data",
      sessionId: session.id,
      data,
    })
    for (const sub of session.subscribers) {
      if (!sub.destroyed && sub.writable) sub.write(encoded)
    }
  }

  private wirePtyEvents(session: Session): void {
    session.pty.onData((chunk) => {
      this.appendToRing(session, chunk)
      session.outChunks.push(chunk)
      if (!session.outImmediate) {
        session.outImmediate = setImmediate(() => this.flushOut(session))
      }
    })
    session.pty.onExit(({ exitCode, signal }) => {
      this.finalizeSession(session, exitCode, signal)
    })
  }
}
