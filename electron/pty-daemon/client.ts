import * as net from "net"
import { randomUUID } from "crypto"
import {
  CURRENT_PROTOCOL_VERSION,
  FrameDecoder,
  encodeFrame,
  type ClientMessage,
  type ServerMessage,
} from "./protocol"

const PENDING_DATA_CAP = 256 * 1024

// Coalesce PTY output before handing it to data handlers (which forward it to
// the renderer over IPC). A busy agent (Codex, Claude Code) makes node-pty
// emit hundreds of small chunks per second; forwarding each as its own IPC
// message floods the renderer's event loop and makes the whole UI (resizes,
// sidebar toggles) janky while the agent works. The first chunk after an idle
// gap flushes immediately so interactive echo stays instant; sustained streams
// collapse to one message per interval.
const DATA_FLUSH_INTERVAL_MS = 16
// Safety valve: don't let a single batch grow unbounded under extreme output.
const DATA_FLUSH_MAX_BYTES = 256 * 1024

export interface OpenOptions {
  shell: string
  args: string[]
  cwd: string
  cols: number
  rows: number
  env: Record<string, string>
}

type DataHandler = (data: string) => void
type ExitHandler = (info: { exitCode: number; signal?: number }) => void

interface SessionHandle {
  pid: number
  cols: number
  rows: number
  dataHandlers: Set<DataHandler>
  exitHandlers: Set<ExitHandler>
  pendingData: string[]
  pendingDataBytes: number
  pendingExit: { exitCode: number; signal?: number } | null
  snapshotChunks: string[]
  snapshotBytes: number
  batchChunks: string[]
  batchBytes: number
  batchTimer: NodeJS.Timeout | null
  lastFlushAt: number
}

export interface AttachResult {
  ok: boolean
  pid?: number
  replay?: string
  cols?: number
  rows?: number
}

export interface DaemonSessionInfo {
  sessionId: string
  pid: number
}

const SNAPSHOT_CAP = 256 * 1024

export class DaemonClient {
  private socket: net.Socket | null = null
  private decoder = new FrameDecoder()
  private connectPromise: Promise<void> | null = null
  private readonly sessions = new Map<string, SessionHandle>()
  private readonly pendingOpens = new Map<
    string,
    { resolve: (pid: number) => void; reject: (err: Error) => void }
  >()
  private readonly pendingAttaches = new Map<
    string,
    { resolve: (r: AttachResult) => void; abandoned: boolean }
  >()
  private readonly pendingLists: Array<{
    resolve: (sessions: DaemonSessionInfo[]) => void
    reject: (err: Error) => void
  }> = []
  private disconnectHandler: (() => void) | null = null

  constructor(private readonly socketPath: string) {}

  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler
  }

  async connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const sock = net.createConnection(this.socketPath)
      const onPreHandshakeError = (err: Error) => {
        this.connectPromise = null
        reject(err)
      }
      sock.once("error", onPreHandshakeError)
      sock.once("connect", () => {
        sock.off("error", onPreHandshakeError)
        // Handshake: send hello, expect hello-ack before installing the
        // steady-state dispatcher.
        const onHandshakeData = (chunk: Buffer) => {
          const msgs = this.decoder.push(chunk) as ServerMessage[]
          for (const msg of msgs) {
            if (msg.type === "hello-ack") {
              sock.off("data", onHandshakeData)
              this.socket = sock
              sock.on("data", (c) => this.onSocketData(c))
              sock.on("error", () => this.handleDisconnect())
              sock.on("close", () => this.handleDisconnect())
              resolve()
              return
            }
            if (msg.type === "error") {
              reject(new Error(msg.reason))
              sock.destroy()
              return
            }
          }
        }
        sock.on("data", onHandshakeData)
        sock.write(
          encodeFrame({
            type: "hello",
            protocolVersions: [CURRENT_PROTOCOL_VERSION],
          }),
        )
      })
    })
    return this.connectPromise
  }

  disconnect(): void {
    const sock = this.socket
    this.socket = null
    this.connectPromise = null
    try {
      sock?.end()
    } catch {
      // ignore
    }
  }

  private send(msg: ClientMessage): void {
    if (!this.socket || this.socket.destroyed) return
    this.socket.write(encodeFrame(msg))
  }

  private onSocketData(chunk: Buffer): void {
    for (const msg of this.decoder.push(chunk) as ServerMessage[]) {
      this.handleServerMessage(msg)
    }
  }

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "opened": {
        const pending = this.pendingOpens.get(msg.sessionId)
        if (!pending) return
        this.pendingOpens.delete(msg.sessionId)
        this.sessions.set(msg.sessionId, this.newSession(msg.pid, 0, 0))
        pending.resolve(msg.pid)
        return
      }
      case "list": {
        const pending = this.pendingLists.shift()
        if (!pending) return
        pending.resolve(msg.sessions)
        return
      }
      case "attached": {
        const pending = this.pendingAttaches.get(msg.sessionId)
        if (!pending || pending.abandoned) {
          // The caller already gave up. Tell the daemon to drop the session
          // so it isn't left orphaned with no consumer.
          this.send({ type: "close", sessionId: msg.sessionId })
          this.pendingAttaches.delete(msg.sessionId)
          return
        }
        this.pendingAttaches.delete(msg.sessionId)
        const handle = this.newSession(msg.pid, msg.cols, msg.rows)
        // Seed snapshot only — NOT pendingData. The renderer's TerminalView
        // pulls replay via term:snapshot on mount; if we also queued it in
        // pendingData, the IPC data channel would deliver the same bytes a
        // second time once the renderer subscribed.
        if (msg.replay) {
          handle.snapshotChunks.push(msg.replay)
          handle.snapshotBytes = msg.replay.length
        }
        this.sessions.set(msg.sessionId, handle)
        pending.resolve({
          ok: true,
          pid: msg.pid,
          cols: msg.cols,
          rows: msg.rows,
          replay: msg.replay,
        })
        return
      }
      case "data": {
        const s = this.sessions.get(msg.sessionId)
        if (!s) return
        this.appendSnapshot(s, msg.data)
        if (s.dataHandlers.size === 0) {
          this.bufferPendingData(s, msg.data)
        } else {
          this.queueData(s, msg.data)
        }
        return
      }
      case "exit": {
        const s = this.sessions.get(msg.sessionId)
        if (!s) return
        // Deliver any coalesced output before the exit notification so the
        // terminal renders the final bytes ahead of "[process exited]".
        this.flushData(s)
        if (s.exitHandlers.size === 0) {
          s.pendingExit = { exitCode: msg.exitCode, signal: msg.signal }
        } else {
          for (const h of s.exitHandlers) {
            h({ exitCode: msg.exitCode, signal: msg.signal })
          }
          this.sessions.delete(msg.sessionId)
        }
        return
      }
      case "error": {
        // Errors that carry a sessionId resolve/reject the matching pending
        // request. Without this, server-side spawn failures (bad cwd, invalid
        // shell) would leak the entry forever and the renderer's create call
        // would hang.
        const taggedId =
          msg.sessionId ??
          msg.reason.match(/^no such session: (.+)$/)?.[1] ??
          null
        if (taggedId) {
          const open = this.pendingOpens.get(taggedId)
          if (open) {
            this.pendingOpens.delete(taggedId)
            open.reject(new Error(msg.reason))
            return
          }
          const attach = this.pendingAttaches.get(taggedId)
          if (attach) {
            this.pendingAttaches.delete(taggedId)
            attach.resolve({ ok: false })
            return
          }
        }
        process.stderr.write(`[daemon-client] server error: ${msg.reason}\n`)
        return
      }
    }
  }

  private newSession(pid: number, cols: number, rows: number): SessionHandle {
    return {
      pid,
      cols,
      rows,
      dataHandlers: new Set(),
      exitHandlers: new Set(),
      pendingData: [],
      pendingDataBytes: 0,
      pendingExit: null,
      snapshotChunks: [],
      snapshotBytes: 0,
      batchChunks: [],
      batchBytes: 0,
      batchTimer: null,
      lastFlushAt: 0,
    }
  }

  private queueData(s: SessionHandle, chunk: string): void {
    s.batchChunks.push(chunk)
    s.batchBytes += chunk.length
    if (
      s.batchBytes >= DATA_FLUSH_MAX_BYTES ||
      Date.now() - s.lastFlushAt >= DATA_FLUSH_INTERVAL_MS
    ) {
      this.flushData(s)
      return
    }
    if (!s.batchTimer) {
      s.batchTimer = setTimeout(
        () => this.flushData(s),
        DATA_FLUSH_INTERVAL_MS,
      )
    }
  }

  private flushData(s: SessionHandle): void {
    if (s.batchTimer) {
      clearTimeout(s.batchTimer)
      s.batchTimer = null
    }
    if (s.batchChunks.length === 0) return
    const data =
      s.batchChunks.length === 1 ? s.batchChunks[0] : s.batchChunks.join("")
    s.batchChunks = []
    s.batchBytes = 0
    s.lastFlushAt = Date.now()
    for (const h of s.dataHandlers) h(data)
  }

  private clearBatch(s: SessionHandle): void {
    if (s.batchTimer) {
      clearTimeout(s.batchTimer)
      s.batchTimer = null
    }
    s.batchChunks = []
    s.batchBytes = 0
  }

  private bufferPendingData(s: SessionHandle, chunk: string): void {
    s.pendingData.push(chunk)
    s.pendingDataBytes += chunk.length
    while (s.pendingDataBytes > PENDING_DATA_CAP && s.pendingData.length > 1) {
      const dropped = s.pendingData.shift()
      if (dropped) s.pendingDataBytes -= dropped.length
    }
  }

  private appendSnapshot(s: SessionHandle, chunk: string): void {
    s.snapshotChunks.push(chunk)
    s.snapshotBytes += chunk.length
    while (s.snapshotBytes > SNAPSHOT_CAP && s.snapshotChunks.length > 1) {
      const dropped = s.snapshotChunks.shift()
      if (dropped) s.snapshotBytes -= dropped.length
    }
  }

  private handleDisconnect(): void {
    this.socket = null
    this.connectPromise = null
    for (const s of this.sessions.values()) {
      this.clearBatch(s)
      for (const h of s.exitHandlers) h({ exitCode: -1 })
    }
    this.sessions.clear()
    for (const p of this.pendingOpens.values()) {
      p.reject(new Error("daemon disconnected"))
    }
    this.pendingOpens.clear()
    for (const p of this.pendingAttaches.values()) {
      p.resolve({ ok: false })
    }
    this.pendingAttaches.clear()
    for (const p of this.pendingLists.splice(0)) {
      p.reject(new Error("daemon disconnected"))
    }
    const handler = this.disconnectHandler
    if (handler) {
      try {
        handler()
      } catch {
        // ignore — handler failure shouldn't mask the disconnect itself
      }
    }
  }

  async open(opts: OpenOptions, sessionId = randomUUID()): Promise<string> {
    await this.connect()
    const promise = new Promise<number>((resolve, reject) => {
      this.pendingOpens.set(sessionId, { resolve, reject })
    })
    this.send({
      type: "open",
      sessionId,
      shell: opts.shell,
      args: opts.args,
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      env: opts.env,
    })
    await promise
    return sessionId
  }

  async attach(sessionId: string): Promise<AttachResult> {
    await this.connect()
    const pending = {
      // Will be overwritten before any caller can resolve; placeholder keeps
      // the type stable.
      resolve: undefined as unknown as (r: AttachResult) => void,
      abandoned: false,
    }
    const promise = new Promise<AttachResult>((resolve) => {
      pending.resolve = resolve
      this.pendingAttaches.set(sessionId, pending)
      // If the daemon never answers, give up. A late "attached" will still
      // arrive — handleServerMessage marks it abandoned and tells the daemon
      // to drop the session so it doesn't leak.
      setTimeout(() => {
        const cur = this.pendingAttaches.get(sessionId)
        if (cur === pending && !cur.abandoned) {
          cur.abandoned = true
          resolve({ ok: false })
        }
      }, 1_500).unref()
    })
    this.send({ type: "attach", sessionId })
    return promise
  }

  async list(): Promise<DaemonSessionInfo[]> {
    await this.connect()
    const promise = new Promise<DaemonSessionInfo[]>((resolve, reject) => {
      this.pendingLists.push({ resolve, reject })
      setTimeout(() => {
        const idx = this.pendingLists.findIndex((pending) => pending.resolve === resolve)
        if (idx === -1) return
        this.pendingLists.splice(idx, 1)
        reject(new Error("daemon list timed out"))
      }, 1_500).unref()
    })
    this.send({ type: "list" })
    return promise
  }

  write(sessionId: string, data: string): void {
    this.send({ type: "input", sessionId, data })
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const s = this.sessions.get(sessionId)
    if (s) {
      s.cols = cols
      s.rows = rows
    }
    this.send({ type: "resize", sessionId, cols, rows })
  }

  kill(sessionId: string): void {
    const s = this.sessions.get(sessionId)
    if (s) this.clearBatch(s)
    this.send({ type: "close", sessionId })
    this.sessions.delete(sessionId)
  }

  getPid(sessionId: string): number | undefined {
    return this.sessions.get(sessionId)?.pid
  }

  snapshot(sessionId: string): string {
    const s = this.sessions.get(sessionId)
    if (!s) return ""
    // Anything currently in pendingData is also in snapshotChunks (live data
    // is appended to both). The caller is about to render the snapshot, so
    // drop pendingData here — otherwise the next onData() flush would replay
    // those bytes a second time and the terminal would render duplicates.
    // Same for the coalescing batch: anything queued there is already in
    // snapshotChunks, so flushing it after the snapshot renders would
    // duplicate it too.
    s.pendingData = []
    s.pendingDataBytes = 0
    this.clearBatch(s)
    return s.snapshotChunks.join("")
  }

  onData(sessionId: string, handler: DataHandler): () => void {
    const s = this.sessions.get(sessionId)
    if (!s) return () => {}
    s.dataHandlers.add(handler)
    if (s.pendingData.length > 0) {
      const flush = s.pendingData
      s.pendingData = []
      s.pendingDataBytes = 0
      for (const chunk of flush) handler(chunk)
    }
    return () => s.dataHandlers.delete(handler)
  }

  onExit(sessionId: string, handler: ExitHandler): () => void {
    const s = this.sessions.get(sessionId)
    if (!s) return () => {}
    s.exitHandlers.add(handler)
    if (s.pendingExit) {
      const info = s.pendingExit
      s.pendingExit = null
      handler(info)
      this.sessions.delete(sessionId)
    }
    return () => s.exitHandlers.delete(handler)
  }
}
