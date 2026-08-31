// Opt-in typing-latency instrumentation for the terminal.
//
// Terminal lag is hard to attribute by reading code: a keystroke crosses the
// renderer, the main process, the PTY daemon, the agent's own TUI redraw, and
// then all the way back. Any one of them can be the stall, and a single
// end-to-end number can't tell them apart — which matters, because only some
// of those hops are ours to fix. Turn this on in the renderer devtools console:
//
//   window.__gsTerminalPerf = true            // log echoes slower than 50ms
//   window.__gsTerminalPerf = 16              // ...or pick your own threshold
//   window.__gsTerminalPerf = false           // off
//
// Each slow keystroke logs a three-way split:
//
//   roundtrip — keystroke sent → first byte back in the renderer. Covers IPC,
//               the daemon, and the agent redrawing its input line. A big
//               number here that isn't accompanied by a long task means the
//               agent (or a blocked main process), not our render path.
//   queue     — byte arrived → handed to xterm. This is our batching. Should
//               be ~0 while typing; anything else is a bug in the input window.
//   parse     — handed to xterm → xterm finished parsing it.
//
// Long tasks on the renderer's main thread are logged separately: if the total
// is bad and long tasks line up with it, the stall is local jank, not the hop.
//
// Inert when the flag is unset — the terminal only calls into it after
// checking terminalPerfThreshold().

declare global {
  interface Window {
    __gsTerminalPerf?: boolean | number
  }
}

const DEFAULT_THRESHOLD_MS = 50

export function terminalPerfThreshold(): number | null {
  const flag =
    typeof window === "undefined" ? undefined : window.__gsTerminalPerf
  if (flag === undefined || flag === false) return null
  return typeof flag === "number" ? flag : DEFAULT_THRESHOLD_MS
}

/**
 * Tracks one in-flight keystroke per session. Only the first echo after a
 * keystroke is timed; further output until the next keystroke is ignored, so
 * a streaming agent doesn't drown the log.
 */
export class EchoTimer {
  private sentAt = 0
  private arrivedAt = 0
  private writtenAt = 0
  private readonly label: string

  constructor(label: string) {
    this.label = label
  }

  /** Call when a keystroke is handed to the IPC bridge. */
  markSent(): void {
    if (this.sentAt !== 0) return
    this.sentAt = performance.now()
    this.arrivedAt = 0
    this.writtenAt = 0
  }

  /** Call when PTY bytes land in the renderer. */
  markArrived(): void {
    if (this.sentAt === 0 || this.arrivedAt !== 0) return
    this.arrivedAt = performance.now()
  }

  /** Call immediately before handing bytes to xterm. */
  markWritten(): void {
    if (this.sentAt === 0 || this.writtenAt !== 0) return
    this.writtenAt = performance.now()
  }

  /** Call from xterm's write callback, once the chunk has been parsed. */
  markParsed(): void {
    const { sentAt, arrivedAt, writtenAt } = this
    if (sentAt === 0) return
    this.sentAt = 0
    const threshold = terminalPerfThreshold()
    if (threshold === null) return
    const now = performance.now()
    const total = now - sentAt
    if (total < threshold) return
    const roundtrip = arrivedAt === 0 ? total : arrivedAt - sentAt
    const queue = arrivedAt === 0 || writtenAt === 0 ? 0 : writtenAt - arrivedAt
    const parse = writtenAt === 0 ? 0 : now - writtenAt
    console.warn(
      `[gs-perf] echo ${total.toFixed(1)}ms — roundtrip ${roundtrip.toFixed(1)} · queue ${queue.toFixed(1)} · parse ${parse.toFixed(1)} — ${this.label}`
    )
  }
}

let longTasksObserved = false

/** Registers a one-time long-task logger (no-op after the first call). */
export function observeLongTasks(): void {
  if (longTasksObserved || typeof PerformanceObserver === "undefined") return
  longTasksObserved = true
  try {
    new PerformanceObserver((list) => {
      const threshold = terminalPerfThreshold()
      if (threshold === null) return
      for (const entry of list.getEntries()) {
        console.warn(
          `[gs-perf] main thread blocked ${entry.duration.toFixed(1)}ms (${entry.name})`
        )
      }
    }).observe({ type: "longtask", buffered: false })
  } catch {
    // longtask isn't observable everywhere; instrumentation is best-effort.
  }
}
