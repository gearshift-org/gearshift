import { app } from "electron"
import fs from "node:fs/promises"
import net from "node:net"
import path from "node:path"

export type TerminalAgentName =
  | "claude"
  | "codex"
  | "opencode"
  | "pi"
  | "gemini"

export type AgentHookEvent = {
  agentName: TerminalAgentName
  event: "stop" | "notification" | "start"
  body?: string
}

const AGENT_HOOK_SOCKET_FILENAME = "gearshift-agent-hooks.sock"
const AGENT_HOOK_SCRIPT_FILENAME = "gearshift-agent-hook.sh"
const OPENCODE_PLUGIN_FILENAME = "gearshift-notify.js"
const AGENT_HOOK_MARKER = "gearshift-agent-hook"
const AGENT_EVENT_MAX_BYTES = 64 * 1024

let agentHookServer: net.Server | null = null

function agentHookSocketPath(): string {
  return path.join(app.getPath("userData"), AGENT_HOOK_SOCKET_FILENAME)
}

function agentHookScriptPath(): string {
  return path.join(app.getPath("userData"), AGENT_HOOK_SCRIPT_FILENAME)
}

function opencodePluginSourcePath(): string {
  return path.join(app.getPath("userData"), OPENCODE_PLUGIN_FILENAME)
}

function parseAgentHookPayload(
  raw: string
): { sessionId: string; event: AgentHookEvent } | null {
  const [agentRaw, sessionIdRaw, eventRaw, ...bodyParts] = raw
    .replace(/\0/g, "")
    .trim()
    .split("|")
  const agentName = agentRaw as TerminalAgentName
  if (!["claude", "codex", "opencode", "pi", "gemini"].includes(agentName)) {
    return null
  }
  const event =
    eventRaw === "notification"
      ? "notification"
      : eventRaw === "start"
        ? "start"
        : "stop"
  const sessionId = sessionIdRaw?.trim()
  if (!sessionId) return null
  const body = bodyParts
    .join("|")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 500)
  return {
    sessionId,
    event: {
      agentName,
      event,
      ...(body ? { body } : {}),
    },
  }
}

export async function startAgentHookServer(
  sendAgentHookEvent: (sessionId: string, event: AgentHookEvent) => void
): Promise<void> {
  if (agentHookServer) return
  const socketPath = agentHookSocketPath()
  try {
    await fs.unlink(socketPath)
  } catch {
    // not there
  }
  await fs.mkdir(path.dirname(socketPath), { recursive: true })
  agentHookServer = net.createServer((socket) => {
    let raw = ""
    socket.on("data", (chunk) => {
      raw += chunk.toString("utf8")
      if (Buffer.byteLength(raw) > AGENT_EVENT_MAX_BYTES) {
        socket.destroy()
      }
    })
    socket.on("end", () => {
      const parsed = parseAgentHookPayload(raw)
      if (!parsed) return
      sendAgentHookEvent(parsed.sessionId, parsed.event)
    })
    socket.on("error", () => {
      // fire-and-forget hook clients may disconnect early
    })
  })
  await new Promise<void>((resolve, reject) => {
    agentHookServer?.once("error", reject)
    agentHookServer?.listen(socketPath, () => {
      agentHookServer?.off("error", reject)
      resolve()
    })
  })
  try {
    await fs.chmod(socketPath, 0o600)
  } catch {
    // best effort
  }
}

export function closeAgentHookServer(): void {
  try {
    agentHookServer?.close()
  } catch {
    // ignore shutdown errors
  }
  agentHookServer = null
}

export function hookEnv(sessionId: string): Record<string, string> {
  return {
    GEARSHIFT_SESSION_ID: sessionId,
    GEARSHIFT_AGENT_SOCKET: agentHookSocketPath(),
    GEARSHIFT_AGENT_HOOK_SCRIPT: agentHookScriptPath(),
    GEARSHIFT_AGENT_HOOKS: "1",
  }
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function readJsonObject(
  filePath: string
): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // missing or malformed config: start from an empty object
  }
  return {}
}

async function writeJsonWithBackup(
  filePath: string,
  data: Record<string, unknown>
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  try {
    await fs.copyFile(filePath, `${filePath}.gearshift-backup`)
  } catch {
    // no existing file to back up
  }
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  })
  try {
    await fs.chmod(filePath, 0o600)
  } catch {
    // best effort
  }
}

function isMarkedHookEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false
  const hooks = (entry as { hooks?: unknown }).hooks
  if (!Array.isArray(hooks)) return false
  return hooks.some((hook) => {
    if (!hook || typeof hook !== "object") return false
    const command = (hook as { command?: unknown }).command
    return typeof command === "string" && command.includes(AGENT_HOOK_MARKER)
  })
}

function buildCommandHookEntry(
  command: string,
  timeout?: number,
  matcher: string = ""
) {
  return {
    matcher,
    hooks: [
      {
        type: "command",
        command,
        ...(timeout ? { timeout } : {}),
      },
    ],
  }
}

function removeMarkedHookEntries(existing: unknown): object[] {
  return Array.isArray(existing)
    ? existing.filter((e) => !isMarkedHookEntry(e))
    : []
}

function mergeMarkedHookEntry(existing: unknown, entry: object): object[] {
  return [...removeMarkedHookEntries(existing), entry]
}

async function writeAgentHookScript(): Promise<void> {
  const script = `#!/usr/bin/env bash
set -euo pipefail

agent="\${1:-}"
event="\${2:-stop}"

if [ -z "\${GEARSHIFT_AGENT_SOCKET:-}" ] || [ -z "\${GEARSHIFT_SESSION_ID:-}" ]; then
  exit 0
fi

case "$agent" in
  claude|codex|opencode|pi|gemini) ;;
  *) exit 0 ;;
esac

# Only "stop" needs to parse the assistant message out of stdin — for "start"
# and "notification" we skip stdin entirely so the bash spawn returns as
# quickly as it can. This is the main savings over the previous version.
case "$event" in
  notification)
    body="Needs attention"
    ;;
  start)
    body=""
    ;;
  *)
    event="stop"
    if [ -t 0 ]; then
      body="Session completed"
    else
      input="$(cat || true)"
      if [ -n "$input" ] && [[ "$input" == *'"last_assistant_message"'* ]]; then
        body=$(printf '%s' "$input" \\
          | grep -o '"last_assistant_message":"[^"]*"' \\
          | head -1 | cut -d'"' -f4 || true)
        if [ -n "$body" ]; then
          body=$(printf '%s' "$body" | tr '|\\n\\r' '   ' | head -c 500)
        else
          body="Session completed"
        fi
      else
        body="Session completed"
      fi
    fi
    ;;
esac

printf '%s|%s|%s|%s' "$agent" "$GEARSHIFT_SESSION_ID" "$event" "$body" \\
  | nc -U "$GEARSHIFT_AGENT_SOCKET" 2>/dev/null || true
`
  const filePath = agentHookScriptPath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, script, { encoding: "utf8", mode: 0o700 })
  try {
    await fs.chmod(filePath, 0o700)
  } catch {
    // best effort
  }
}

async function installClaudeHooks(scriptPath: string): Promise<void> {
  const settingsPath = path.join(
    app.getPath("home"),
    ".claude",
    "settings.json"
  )
  const settings = await readJsonObject(settingsPath)
  const hooks =
    settings.hooks &&
    typeof settings.hooks === "object" &&
    !Array.isArray(settings.hooks)
      ? (settings.hooks as Record<string, unknown>)
      : {}
  const q = shellSingleQuote(scriptPath)
  const cmd = (event: string) => `${q} claude ${event} # ${AGENT_HOOK_MARKER}`
  settings.hooks = {
    ...hooks,
    // Do not mark the pane busy on agent/TUI launch. The busy indicator should
    // only start once the user submits a prompt in the terminal TUI.
    SessionStart: removeMarkedHookEntries(hooks.SessionStart),
    UserPromptSubmit: mergeMarkedHookEntry(
      hooks.UserPromptSubmit,
      buildCommandHookEntry(cmd("start"), 5)
    ),
    PostToolUse: mergeMarkedHookEntry(
      hooks.PostToolUse,
      buildCommandHookEntry(cmd("start"), 5, "*")
    ),
    PostToolUseFailure: mergeMarkedHookEntry(
      hooks.PostToolUseFailure,
      buildCommandHookEntry(cmd("start"), 5, "*")
    ),
    Stop: mergeMarkedHookEntry(
      hooks.Stop,
      buildCommandHookEntry(cmd("stop"), 10)
    ),
    SessionEnd: mergeMarkedHookEntry(
      hooks.SessionEnd,
      buildCommandHookEntry(cmd("stop"), 5)
    ),
    Notification: mergeMarkedHookEntry(
      hooks.Notification,
      buildCommandHookEntry(cmd("notification"), 10)
    ),
    PermissionRequest: mergeMarkedHookEntry(
      hooks.PermissionRequest,
      buildCommandHookEntry(cmd("notification"), 5, "*")
    ),
  }
  await writeJsonWithBackup(settingsPath, settings)
}

async function installCodexHooks(scriptPath: string): Promise<void> {
  const hooksPath = path.join(app.getPath("home"), ".codex", "hooks.json")
  const settings = await readJsonObject(hooksPath)
  const hooks =
    settings.hooks &&
    typeof settings.hooks === "object" &&
    !Array.isArray(settings.hooks)
      ? (settings.hooks as Record<string, unknown>)
      : {}
  const q = shellSingleQuote(scriptPath)
  const cmd = (event: string) => `${q} codex ${event} # ${AGENT_HOOK_MARKER}`
  settings.hooks = {
    ...hooks,
    // Do not mark the pane busy on agent/TUI launch. The busy indicator should
    // only start once the user submits a prompt in the terminal TUI.
    SessionStart: removeMarkedHookEntries(hooks.SessionStart),
    UserPromptSubmit: mergeMarkedHookEntry(
      hooks.UserPromptSubmit,
      buildCommandHookEntry(cmd("start"))
    ),
    Stop: mergeMarkedHookEntry(hooks.Stop, buildCommandHookEntry(cmd("stop"))),
    SessionEnd: mergeMarkedHookEntry(
      hooks.SessionEnd,
      buildCommandHookEntry(cmd("stop"))
    ),
    Notification: mergeMarkedHookEntry(
      hooks.Notification,
      buildCommandHookEntry(cmd("notification"))
    ),
  }
  await writeJsonWithBackup(hooksPath, settings)
}

async function writeOpenCodePlugin(): Promise<void> {
  const plugin = `// Gearshift opencode plugin v2
// State-machine notifier: locks onto the first "busy" session as root, sends
// start on idle→busy edges and stop on busy→idle edges. Subagent (child)
// sessions are filtered so they don't toggle the pane indicator.

export const GearShiftNotificationPlugin = async ({ client }) => {
  if (globalThis.__gearshiftOpencodeNotifyPluginV2) return {}
  globalThis.__gearshiftOpencodeNotifyPluginV2 = true

  const socketPath = process?.env?.GEARSHIFT_AGENT_SOCKET
  const sessionEnvId = process?.env?.GEARSHIFT_SESSION_ID
  if (!socketPath || !sessionEnvId) return {}

  const debug = process?.env?.GEARSHIFT_DEBUG === "1"
  const log = (...args) => { if (debug) console.log("[gearshift-plugin]", ...args) }

  let currentState = "idle"   // "idle" | "busy"
  let rootSessionID = null    // first busy session id
  let stopSent = false
  const cancelledSessions = new Set()
  const childSessionCache = new Map() // sessionID -> boolean isChild

  const send = async (event, body) => {
    try {
      const { createConnection } = await import("net")
      const conn = createConnection({ path: socketPath })
      conn.on("error", () => {})
      const payload = \`opencode|\${sessionEnvId}|\${event}|\${body ?? ""}\`
      log("send", event, body ? body.slice(0, 80) : "")
      await new Promise((resolve) => {
        conn.write(payload, () => conn.end())
        conn.on("close", resolve)
        setTimeout(resolve, 3000)
      })
    } catch (err) {
      log("send failed", err?.message || err)
    }
  }

  const isChildSession = async (sessionID) => {
    if (!sessionID) return true
    if (childSessionCache.has(sessionID)) return childSessionCache.get(sessionID)
    if (!client?.session?.list) return true
    try {
      const sessions = await client.session.list()
      const found = sessions.data?.find((s) => s.id === sessionID)
      const isChild = !!found?.parentID
      childSessionCache.set(sessionID, isChild)
      return isChild
    } catch (err) {
      log("session lookup failed", err?.message || err)
      // Safer to assume child on failure than spam parent notifications.
      return true
    }
  }

  const handleBusy = async (sessionID) => {
    if (!rootSessionID) {
      rootSessionID = sessionID
      log("root session set", rootSessionID)
    }
    if (sessionID !== rootSessionID) {
      log("ignoring busy from non-root", sessionID)
      return
    }
    if (currentState === "busy") return
    currentState = "busy"
    stopSent = false
    await send("start", "")
  }

  const buildStopBody = async (sessionID) => {
    try {
      const result = await client.session.messages({
        path: { id: sessionID },
        query: { limit: 3 },
      })
      const messages = result.data || []
      const lastAssistant = [...messages]
        .reverse()
        .find((m) => m.info.role === "assistant")
      if (lastAssistant) {
        const text = (lastAssistant.parts || [])
          .filter((p) => p.type === "text")
          .map((p) => p.text || "")
          .join("")
        if (text) return text.replace(/[\\n\\r|]+/g, " ").slice(0, 500)
      }
    } catch {}
    return "Session completed"
  }

  const handleIdle = async (sessionID, reason) => {
    if (rootSessionID && sessionID !== rootSessionID) {
      log("ignoring idle from non-root", sessionID, reason)
      return
    }
    if (currentState !== "busy" || stopSent) {
      log("skip stop", currentState, stopSent, reason)
      return
    }
    currentState = "idle"
    stopSent = true

    if (cancelledSessions.has(sessionID)) {
      cancelledSessions.delete(sessionID)
      rootSessionID = null
      log("cancelled, suppress stop body")
      await send("stop", "Cancelled")
      return
    }

    const body = await buildStopBody(sessionID)
    await send("stop", body)
    rootSessionID = null
  }

  return {
    event: async ({ event }) => {
      const sessionID =
        event.properties?.sessionID ??
        event.properties?.info?.id ??
        null
      log("event", event.type, sessionID)

      if (event.type === "session.created") {
        const isChild = Boolean(event.properties?.info?.parentID)
        if (sessionID) childSessionCache.set(sessionID, isChild)
        return
      }

      if (event.type === "session.deleted") {
        if (sessionID) childSessionCache.delete(sessionID)
        return
      }

      if (event.type === "session.error") {
        const err = event.properties?.error
        if (err?.name === "MessageAbortedError" && sessionID) {
          cancelledSessions.add(sessionID)
        }
        // Treat error as idle so the dot doesn't stick if a session crashes.
        if (await isChildSession(sessionID)) return
        await handleIdle(sessionID, "session.error")
        return
      }

      if (await isChildSession(sessionID)) {
        log("skip child session", sessionID)
        return
      }

      if (event.type === "session.status") {
        const statusType = event.properties?.status?.type
        if (statusType === "idle") {
          await handleIdle(sessionID, "session.status.idle")
        } else if (statusType) {
          await handleBusy(sessionID)
        }
        return
      }

      // Backwards-compat for older opencode builds.
      if (event.type === "session.busy") await handleBusy(sessionID)
      if (event.type === "session.idle") await handleIdle(sessionID, "session.idle")
    },
    "permission.ask": async (_permission, output) => {
      if (output?.status === "ask") {
        await send("notification", "Permission requested")
      }
    },
  }
}
`
  const sourcePath = opencodePluginSourcePath()
  await fs.writeFile(sourcePath, plugin, "utf8")
  const pluginsDir = path.join(app.getPath("home"), ".opencode", "plugins")
  const targetPath = path.join(pluginsDir, OPENCODE_PLUGIN_FILENAME)
  await fs.mkdir(pluginsDir, { recursive: true })
  try {
    await fs.copyFile(targetPath, `${targetPath}.gearshift-backup`)
  } catch {
    // no existing plugin to back up
  }
  await fs.copyFile(sourcePath, targetPath)
}

async function writePiExtension(): Promise<void> {
  const extension = `// Gearshift pi extension v2
// Maps pi lifecycle events onto the Gearshift Unix socket directly (no shell
// shim, matching the opencode plugin) so the pane indicator turns off as fast
// for pi as it does for opencode.
//
//   before_agent_start / tool_execution_end    → start
//   agent_end / session_end / session_shutdown → stop

import { createConnection } from "node:net"

export default function (pi: {
  on: (
    event: string,
    handler: (event: unknown, ctx: { hasUI?: boolean }) => void,
  ) => void
}) {
  const socketPath = process.env.GEARSHIFT_AGENT_SOCKET
  const sessionId = process.env.GEARSHIFT_SESSION_ID
  if (!socketPath || !sessionId) return

  const fire = (event: "start" | "stop" | "notification") => {
    try {
      const conn = createConnection({ path: socketPath })
      conn.on("error", () => {})
      conn.write(\`pi|\${sessionId}|\${event}|\`, () => conn.end())
    } catch {
      // Stay silent — hook failures must never affect pi.
    }
  }

  // Subagents and print mode (-p) set hasUI=false; never toggle the pane dot
  // for those. Older pi versions without hasUI still fire (best-effort).
  const skip = (ctx: { hasUI?: boolean }) => ctx.hasUI === false

  // session_start only means the TUI opened. Wait for a prompt submission
  // before marking the terminal agent as busy.
  pi.on("before_agent_start", (_e, ctx) => { if (!skip(ctx)) fire("start") })
  pi.on("tool_execution_end", (_e, ctx) => { if (!skip(ctx)) fire("start") })
  pi.on("agent_end", (_e, ctx) => { if (!skip(ctx)) fire("stop") })
  pi.on("session_end", (_e, ctx) => { if (!skip(ctx)) fire("stop") })
  pi.on("session_shutdown", (_e, ctx) => { if (!skip(ctx)) fire("stop") })
}
`
  const extensionsDir = path.join(
    app.getPath("home"),
    ".pi",
    "agent",
    "extensions"
  )
  const targetPath = path.join(extensionsDir, "gearshift-hooks.ts")
  await fs.mkdir(extensionsDir, { recursive: true })
  try {
    const existing = await fs.readFile(targetPath, "utf8")
    if (existing === extension) return
    await fs.copyFile(targetPath, `${targetPath}.gearshift-backup`)
  } catch {
    // no existing extension to back up
  }
  await fs.writeFile(targetPath, extension, { encoding: "utf8", mode: 0o644 })
}

export async function installAgentHooks(): Promise<void> {
  if (process.platform === "win32") return
  await writeAgentHookScript()
  const scriptPath = agentHookScriptPath()
  const installers = [
    installClaudeHooks(scriptPath),
    installCodexHooks(scriptPath),
    writeOpenCodePlugin(),
    writePiExtension(),
  ]
  const results = await Promise.allSettled(installers)
  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("[agent-hooks] install failed", result.reason)
    }
  }
}
