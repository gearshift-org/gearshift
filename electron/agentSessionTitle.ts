import { app } from "electron"
import fs from "node:fs/promises"
import path from "node:path"
import type { TerminalAgentName } from "./agentHooks"

// Resolves a human-readable title for a coding-agent session, given the
// agent's own session id (the `agentSessionId` we persist per pane).
//
// Two tiers, matching what each agent itself can offer:
//   - Claude / OpenCode generate a real title -> use it.
//   - Codex / pi / Gemini have no title -> fall back to the first user message
//     (the same thing their own `resume` pickers display).
//
// All lookups are best-effort and bounded; any failure returns null so callers
// silently fall back to the existing title logic.

const MAX_TITLE_LEN = 120
const MAX_READ_BYTES = 2 * 1024 * 1024 // cap transcript reads at 2 MB

function clean(raw: string | undefined | null): string | null {
  if (!raw) return null
  const trimmed = raw.replace(/\s+/g, " ").trim()
  if (!trimmed) return null
  return trimmed.slice(0, MAX_TITLE_LEN)
}

async function readCapped(filePath: string): Promise<string | null> {
  try {
    const handle = await fs.open(filePath, "r")
    try {
      const { size } = await handle.stat()
      const len = Math.min(size, MAX_READ_BYTES)
      const buf = Buffer.alloc(len)
      await handle.read(buf, 0, len, 0)
      return buf.toString("utf8")
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

/** Find a file named `<id>.<ext>` anywhere directly under one of `roots`' subdirs. */
async function findFileById(
  roots: string[],
  id: string,
  ext: string,
  depth = 4
): Promise<string | null> {
  const target = `${id}${ext}`
  const walk = async (dir: string, remaining: number): Promise<string | null> => {
    let entries: import("node:fs").Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return null
    }
    const subdirs: string[] = []
    for (const e of entries) {
      // Match exact (claude/opencode: `<id>.ext`) or a timestamp/prefix +
      // separator + id (codex `rollout-…-<id>`, pi `…Z_<id>`). The id is a long
      // opaque token, so an `<id><ext>` suffix is unambiguous.
      if (e.isFile() && (e.name === target || e.name.endsWith(`${id}${ext}`))) {
        return path.join(dir, e.name)
      }
      if (e.isDirectory()) subdirs.push(path.join(dir, e.name))
    }
    if (remaining <= 0) return null
    for (const sub of subdirs) {
      const hit = await walk(sub, remaining - 1)
      if (hit) return hit
    }
    return null
  }
  for (const root of roots) {
    const hit = await walk(root, depth)
    if (hit) return hit
  }
  return null
}

function* jsonLines(content: string): Generator<unknown> {
  for (const line of content.split("\n")) {
    const t = line.trim()
    if (!t) continue
    try {
      yield JSON.parse(t)
    } catch {
      // skip malformed lines
    }
  }
}

function textFromContent(content: unknown): string | null {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") return part
        if (part && typeof part === "object" && "text" in part) {
          const t = (part as { text?: unknown }).text
          return typeof t === "string" ? t : ""
        }
        return ""
      })
      .join("")
    return text || null
  }
  return null
}

// Codex (and others) inject an AGENTS.md / instructions envelope as the first
// user message. Skip those so we land on the prompt the user actually typed.
function looksLikeEnvelope(text: string): boolean {
  const head = text.trimStart()
  return (
    head.startsWith("# AGENTS.md") ||
    head.startsWith("<INSTRUCTIONS") ||
    head.startsWith("<environment_context") ||
    head.startsWith("<user_instructions")
  )
}

async function claudeTitle(id: string): Promise<string | null> {
  const root = path.join(app.getPath("home"), ".claude", "projects")
  const file = await findFileById([root], id, ".jsonl", 2)
  if (!file) return null
  const content = await readCapped(file)
  if (!content) return null
  // Last ai-title line wins — it's rewritten as the conversation evolves.
  let title: string | null = null
  for (const entry of jsonLines(content)) {
    if (
      entry &&
      typeof entry === "object" &&
      (entry as { type?: unknown }).type === "ai-title"
    ) {
      const t = (entry as { aiTitle?: unknown }).aiTitle
      if (typeof t === "string") title = t
    }
  }
  return clean(title)
}

async function openCodeTitle(id: string): Promise<string | null> {
  const roots = [
    path.join(app.getPath("home"), ".local", "share", "opencode", "storage", "session"),
  ]
  const file = await findFileById(roots, id, ".json", 3)
  if (!file) return null
  const content = await readCapped(file)
  if (!content) return null
  try {
    const obj = JSON.parse(content) as { title?: unknown }
    return clean(typeof obj.title === "string" ? obj.title : null)
  } catch {
    return null
  }
}

/** Pull the first real user message from a JSONL transcript. */
function firstUserMessageFromJsonl(
  content: string,
  isUser: (entry: Record<string, unknown>) => boolean,
  getText: (entry: Record<string, unknown>) => unknown
): string | null {
  for (const entry of jsonLines(content)) {
    if (!entry || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    if (!isUser(e)) continue
    const text = textFromContent(getText(e))
    if (text && text.trim() && !looksLikeEnvelope(text)) {
      return clean(text)
    }
  }
  return null
}

async function piTitle(id: string): Promise<string | null> {
  const root = path.join(app.getPath("home"), ".pi", "agent", "sessions")
  const file = await findFileById([root], id, ".jsonl", 3)
  if (!file) return null
  const content = await readCapped(file)
  if (!content) return null
  return firstUserMessageFromJsonl(
    content,
    (e) => e.type === "message" && (e.message as { role?: string })?.role === "user",
    (e) => (e.message as { content?: unknown })?.content
  )
}

async function codexTitle(id: string): Promise<string | null> {
  const root = path.join(app.getPath("home"), ".codex", "sessions")
  const file = await findFileById([root], id, ".jsonl", 5)
  if (!file) return null
  const content = await readCapped(file)
  if (!content) return null
  return firstUserMessageFromJsonl(
    content,
    (e) => {
      const p = (e.payload as Record<string, unknown>) ?? e
      return p?.type === "user_message" || p?.role === "user"
    },
    (e) => {
      const p = (e.payload as Record<string, unknown>) ?? e
      return p?.message ?? p?.content
    }
  )
}

async function geminiTitle(id: string): Promise<string | null> {
  // Gemini stores logs under hashed temp dirs, not keyed by session id, so we
  // scan each logs.json for an entry whose sessionId matches.
  const tmpRoot = path.join(app.getPath("home"), ".gemini", "tmp")
  let dirs: string[]
  try {
    dirs = (await fs.readdir(tmpRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => path.join(tmpRoot, d.name, "logs.json"))
  } catch {
    return null
  }
  for (const logFile of dirs) {
    const content = await readCapped(logFile)
    if (!content) continue
    try {
      const arr = JSON.parse(content) as Array<Record<string, unknown>>
      if (!Array.isArray(arr)) continue
      const hit = arr.find(
        (m) => m.sessionId === id && m.type === "user" && typeof m.message === "string"
      )
      if (hit) return clean(hit.message as string)
    } catch {
      // skip
    }
  }
  return null
}

export async function getAgentSessionTitle(
  agent: TerminalAgentName,
  agentSessionId: string
): Promise<string | null> {
  if (!agentSessionId) return null
  // Guard against path traversal — session ids are opaque tokens.
  if (agentSessionId.includes("/") || agentSessionId.includes("..")) return null
  try {
    switch (agent) {
      case "claude":
        return await claudeTitle(agentSessionId)
      case "opencode":
        return await openCodeTitle(agentSessionId)
      case "pi":
        return await piTitle(agentSessionId)
      case "codex":
        return await codexTitle(agentSessionId)
      case "gemini":
        return await geminiTitle(agentSessionId)
      default:
        return null
    }
  } catch {
    return null
  }
}
