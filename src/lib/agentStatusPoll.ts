// Shared agent-status poller.
//
// Every terminal pane needs to know whether an agent is running in it, and
// panes for *all* open projects stay mounted (they're hidden, not unmounted).
// One interval per pane meant N invokes every 2s — N promises, N structured
// clones, N handler runs in the main process, growing with every project the
// user opens, on the same thread that relays keystrokes.
//
// One timer now asks for every subscribed session at once. The main process
// answers them all off a single cached `ps` snapshot, so the cost of polling
// is flat in the number of open projects instead of linear.

export type PolledAgentStatus = {
  running: boolean
  agentName?: "claude" | "codex" | "opencode" | "pi" | "grok"
}

// null = the lookup failed; subscribers keep their last known state rather
// than treating a transient IPC error as "no agent".
type Listener = (status: PolledAgentStatus | null) => void

const AGENT_STATUS_POLL_MS = 2000

const listeners = new Map<string, Set<Listener>>()
let timer: number | undefined
let pendingImmediate: number | undefined
let inFlight = false

async function tick(): Promise<void> {
  if (inFlight) return
  const ids = [...listeners.keys()]
  if (ids.length === 0) return
  inFlight = true
  try {
    const statuses = await window.term.agentStatusMany(ids)
    for (const id of ids) {
      const subs = listeners.get(id)
      if (!subs) continue
      const status = statuses[id] ?? { running: false }
      for (const fn of subs) fn(status)
    }
  } catch {
    for (const subs of listeners.values()) {
      for (const fn of subs) fn(null)
    }
  } finally {
    inFlight = false
  }
}

/**
 * Subscribe to `sessionId`'s agent status. The callback fires on the shared
 * poll cadence; returns an unsubscribe function.
 */
export function subscribeAgentStatus(
  sessionId: string,
  listener: Listener
): () => void {
  const subs = listeners.get(sessionId) ?? new Set<Listener>()
  subs.add(listener)
  listeners.set(sessionId, subs)
  if (timer === undefined) {
    timer = window.setInterval(() => void tick(), AGENT_STATUS_POLL_MS)
  }
  // A newly mounted pane wants its status right away, but panes mount in
  // bursts (opening a project mounts every one of its tabs), so coalesce those
  // first reads into a single extra round trip.
  if (pendingImmediate === undefined) {
    pendingImmediate = window.setTimeout(() => {
      pendingImmediate = undefined
      void tick()
    }, 0)
  }
  return () => {
    const current = listeners.get(sessionId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) listeners.delete(sessionId)
    if (listeners.size === 0 && timer !== undefined) {
      window.clearInterval(timer)
      timer = undefined
    }
  }
}
