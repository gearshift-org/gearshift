import { toast } from "sonner"

// Time windows offered by the "Summarize" dropdown, ordered from the
// narrowest/most-recent to the widest.
export type HistoryRange =
  | "today"
  | "yesterday"
  | "this-week"
  | "last-week"
  | "this-month"

export const HISTORY_RANGE_OPTIONS: { key: HistoryRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this-week", label: "This week" },
  { key: "last-week", label: "Last week" },
  { key: "this-month", label: "This month" },
]

// Resolve a range into an inclusive epoch-ms window (local time, weeks start
// Monday) plus a human label for the prompt.
export function historyRangeBounds(range: HistoryRange): {
  since: number
  until: number
  label: string
} {
  const now = new Date()
  const nowMs = now.getTime()
  const startOfDay = (d: Date) => {
    const x = new Date(d)
    x.setHours(0, 0, 0, 0)
    return x
  }
  const startOfWeek = (d: Date) => {
    const x = startOfDay(d)
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7)) // Mon = start of week
    return x
  }
  switch (range) {
    case "today":
      return { since: startOfDay(now).getTime(), until: nowMs, label: "today" }
    case "yesterday": {
      const todayStart = startOfDay(now)
      const yesterdayStart = new Date(todayStart)
      yesterdayStart.setDate(yesterdayStart.getDate() - 1)
      return {
        since: yesterdayStart.getTime(),
        until: todayStart.getTime(),
        label: "yesterday",
      }
    }
    case "this-week":
      return {
        since: startOfWeek(now).getTime(),
        until: nowMs,
        label: "this week",
      }
    case "last-week": {
      const thisWeek = startOfWeek(now)
      const lastWeek = new Date(thisWeek)
      lastWeek.setDate(lastWeek.getDate() - 7)
      return {
        since: lastWeek.getTime(),
        until: thisWeek.getTime(),
        label: "last week",
      }
    }
    case "this-month": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1)
      return { since: first.getTime(), until: nowMs, label: "this month" }
    }
  }
}

const AGENT_PROMPT_SUBMIT_DELAY_MS = 80

// Type the prompt into the agent terminal and submit it. App-injected prompts
// pass skipCapture so they're never recorded as the user's own chat history.
export function writeAgentPrompt(sessionId: string, prompt: string): void {
  const body = prompt.trim()
  if (!body) return
  window.term.write(sessionId, body, true)
  window.setTimeout(() => {
    window.term.write(sessionId, "\r", true)
  }, AGENT_PROMPT_SUBMIT_DELAY_MS)
}

// Whose history to summarize: a whole project (sidebar) or a single terminal
// session (terminal header).
export type HistoryScope = { projectId: string } | { sessionId: string }

// Build the recap prompt and send it to the agent running in `sessionId`. The
// agent fetches the messages itself from the local history HTTP API.
export async function summarizeHistoryToAgent(args: {
  sessionId: string
  scope: HistoryScope
  range: HistoryRange
}): Promise<void> {
  let port = 0
  try {
    port = (await window.term.history.serverInfo()).port
  } catch {
    // fall through — port stays 0 and we error below
  }
  if (!port) {
    toast.error("History server is not running")
    return
  }

  const { since, until, label } = historyRangeBounds(args.range)
  const scopeParam =
    "projectId" in args.scope
      ? `projectId=${args.scope.projectId}`
      : `sessionId=${args.scope.sessionId}`
  const scopeNoun =
    "projectId" in args.scope ? "this project" : "this conversation"

  // Single-line prompt: raw newlines submit early in agent TUIs.
  const prompt = `Run this command to fetch my chat history from ${label} for ${scopeNoun}, then summarize it for me — do NOT make any code changes: curl -s 'http://127.0.0.1:${port}/history?${scopeParam}&since=${since}&until=${until}&limit=500&order=asc' — Summarize the work and tasks I did ${label} in plain, human-friendly language: lead with the main things done, group related items into a few short bullets, and keep it concise. If there are no messages, say there's nothing recorded for ${label}.`

  writeAgentPrompt(args.sessionId, prompt)
}
