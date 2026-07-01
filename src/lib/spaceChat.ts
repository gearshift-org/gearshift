import { store } from "./store"

export type SpaceChatRole = "user" | "assistant"

export type SpaceChatMessage = {
  id: string
  role: SpaceChatRole
  content: string
  createdAt: number
}

export type SpaceChatSettings = {
  authenticated: boolean
  codexAvailable: boolean
  model: string
  reasoningEffort: string
  authLabel?: string
  authEmail?: string
  codexBinaryPath?: string
  codexHomePath?: string
  error?: string
}

export type SpaceChatProject = {
  id: string
  name: string
  path: string
}

export type SpaceChatSession = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

const KEY_PREFIX = "gearshift.spaceChat."
const SESSIONS_KEY_PREFIX = "gearshift.spaceChatSessions."
const ACTIVE_KEY_PREFIX = "gearshift.spaceChatActive."
const MAX_MESSAGES_PER_SPACE = 100
const DEFAULT_SESSION_TITLE = "New chat"

function key(spaceId: string): string {
  return `${KEY_PREFIX}${spaceId}`
}

// Messages live under a per-session key; the legacy per-space key (above) is
// migrated into the first session the first time a space is opened.
function sessionMessagesKey(spaceId: string, sessionId: string): string {
  return `${KEY_PREFIX}${spaceId}.${sessionId}`
}

function sessionsKey(spaceId: string): string {
  return `${SESSIONS_KEY_PREFIX}${spaceId}`
}

function activeKey(spaceId: string): string {
  return `${ACTIVE_KEY_PREFIX}${spaceId}`
}

export function deriveSessionTitle(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, " ")
  if (!trimmed) return DEFAULT_SESSION_TITLE
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed
}

export function createSession(title = DEFAULT_SESSION_TITLE): SpaceChatSession {
  const now = Date.now()
  return { id: crypto.randomUUID(), title, createdAt: now, updatedAt: now }
}

function parseSessions(value: unknown): SpaceChatSession[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): SpaceChatSession[] => {
    if (!item || typeof item !== "object") return []
    const s = item as SpaceChatSession
    if (typeof s.id !== "string" || !s.id) return []
    return [
      {
        id: s.id,
        title:
          typeof s.title === "string" && s.title
            ? s.title
            : DEFAULT_SESSION_TITLE,
        createdAt: typeof s.createdAt === "number" ? s.createdAt : Date.now(),
        updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : Date.now(),
      },
    ]
  })
}

export function loadSessions(spaceId: string): SpaceChatSession[] {
  try {
    const raw = store.get(sessionsKey(spaceId))
    return raw ? parseSessions(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export function saveSessions(
  spaceId: string,
  sessions: SpaceChatSession[]
): void {
  store.set(sessionsKey(spaceId), JSON.stringify(sessions))
}

export function getActiveSessionId(spaceId: string): string | null {
  return store.get(activeKey(spaceId)) || null
}

export function setActiveSessionId(spaceId: string, sessionId: string): void {
  store.set(activeKey(spaceId), sessionId)
}

export function loadSessionMessages(
  spaceId: string,
  sessionId: string
): SpaceChatMessage[] {
  try {
    const raw = store.get(sessionMessagesKey(spaceId, sessionId))
    if (!raw) return []
    return parseMessages(JSON.parse(raw))
  } catch {
    return []
  }
}

export function saveSessionMessages(
  spaceId: string,
  sessionId: string,
  messages: SpaceChatMessage[]
): void {
  const next = parseMessages(messages).slice(-MAX_MESSAGES_PER_SPACE)
  store.set(sessionMessagesKey(spaceId, sessionId), JSON.stringify(next))
}

export function deleteSessionData(spaceId: string, sessionId: string): void {
  store.remove(sessionMessagesKey(spaceId, sessionId))
}

// Returns the space's sessions, creating a first session (and migrating any
// legacy single-thread history into it) when a space has none yet.
export function initSpaceSessions(spaceId: string): {
  sessions: SpaceChatSession[]
  activeId: string
} {
  const existing = loadSessions(spaceId)
  if (existing.length > 0) {
    const storedActive = getActiveSessionId(spaceId)
    const activeId =
      storedActive && existing.some((s) => s.id === storedActive)
        ? storedActive
        : existing[0].id
    return { sessions: existing, activeId }
  }

  const legacy = loadSpaceChatMessages(spaceId)
  const firstUser = legacy.find((m) => m.role === "user")
  const session = createSession(
    firstUser ? deriveSessionTitle(firstUser.content) : DEFAULT_SESSION_TITLE
  )
  if (legacy.length > 0) {
    saveSessionMessages(spaceId, session.id, legacy)
    store.remove(key(spaceId))
  }
  saveSessions(spaceId, [session])
  setActiveSessionId(spaceId, session.id)
  return { sessions: [session], activeId: session.id }
}

function parseMessages(value: unknown): SpaceChatMessage[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): SpaceChatMessage[] => {
    if (!item || typeof item !== "object") return []
    const msg = item as SpaceChatMessage
    if (
      (msg.role !== "user" && msg.role !== "assistant") ||
      typeof msg.content !== "string" ||
      typeof msg.createdAt !== "number"
    ) {
      return []
    }
    return [
      {
        id: typeof msg.id === "string" && msg.id ? msg.id : crypto.randomUUID(),
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
      },
    ]
  })
}

export function loadSpaceChatMessages(spaceId: string): SpaceChatMessage[] {
  try {
    const raw = store.get(key(spaceId))
    if (!raw) return []
    return parseMessages(JSON.parse(raw))
  } catch {
    return []
  }
}

export function saveSpaceChatMessages(
  spaceId: string,
  messages: SpaceChatMessage[]
): void {
  const next = parseMessages(messages).slice(-MAX_MESSAGES_PER_SPACE)
  store.set(key(spaceId), JSON.stringify(next))
}
