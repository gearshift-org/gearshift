import path from "node:path"
import { randomUUID } from "node:crypto"
import { app } from "electron"
import { createClient, type Client } from "@libsql/client"
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql"
import { and, asc, desc, eq, gte, lte, lt } from "drizzle-orm"
import { chatMessages } from "./schema"
import { sanitizeChatHistoryBody } from "../redactSecrets"

export type ChatHistoryMessage = {
  id: string
  sessionId: string
  projectId: string | null
  body: string
  agent: string | null
  createdAt: number
}

let client: Client | null = null
let db: LibSQLDatabase | null = null
let ready: Promise<void> | null = null

function sanitizeMessage(msg: ChatHistoryMessage): ChatHistoryMessage {
  return { ...msg, body: sanitizeChatHistoryBody(msg.body) }
}

async function ensureDb(): Promise<LibSQLDatabase> {
  if (db) return db
  if (!ready) {
    ready = (async () => {
      const file = path.join(app.getPath("userData"), "chat.db")
      client = createClient({ url: `file:${file}` })
      const handle = drizzle(client)
      await client.execute("PRAGMA journal_mode = WAL")
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id         TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          project_id TEXT,
          body       TEXT NOT NULL,
          agent      TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chat_session
          ON chat_messages (session_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_chat_project
          ON chat_messages (project_id, created_at);
      `)
      db = handle
    })()
  }
  await ready
  return db!
}

export async function appendMessage(
  sessionId: string,
  projectId: string | null,
  body: string,
  agent: string | null
): Promise<ChatHistoryMessage> {
  const handle = await ensureDb()
  const msg: ChatHistoryMessage = {
    id: randomUUID(),
    sessionId,
    projectId,
    body: sanitizeChatHistoryBody(body),
    agent,
    createdAt: Date.now(),
  }
  await handle.insert(chatMessages).values(msg)
  return msg
}

export async function listForProject(
  projectId: string,
  limit = 500
): Promise<ChatHistoryMessage[]> {
  const handle = await ensureDb()
  const rows = await handle
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.projectId, projectId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit)
  return rows.map(sanitizeMessage)
}

export async function listForSession(
  sessionId: string
): Promise<ChatHistoryMessage[]> {
  const handle = await ensureDb()
  const rows = await handle
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(desc(chatMessages.createdAt))
  return rows.map(sanitizeMessage)
}

export type HistoryQuery = {
  projectId?: string
  sessionId?: string
  /** Epoch ms, inclusive lower bound on created_at. */
  since?: number
  /** Epoch ms, inclusive upper bound on created_at. */
  until?: number
  /** Defaults to 50, hard-capped at 500. */
  limit?: number
  /** Order by created_at. Defaults to "desc" (newest first). */
  order?: "asc" | "desc"
}

const HISTORY_DEFAULT_LIMIT = 50
const HISTORY_MAX_LIMIT = 500

// Unified read used by the local history HTTP API. Filters are all optional and
// combined with AND; an empty query returns the most recent messages across
// every project. Bodies are sanitized like every other read path.
export async function queryMessages(
  q: HistoryQuery
): Promise<ChatHistoryMessage[]> {
  const handle = await ensureDb()
  const filters = []
  if (q.projectId) filters.push(eq(chatMessages.projectId, q.projectId))
  if (q.sessionId) filters.push(eq(chatMessages.sessionId, q.sessionId))
  if (typeof q.since === "number")
    filters.push(gte(chatMessages.createdAt, q.since))
  if (typeof q.until === "number")
    filters.push(lte(chatMessages.createdAt, q.until))
  const limit = Math.min(
    Math.max(1, Math.floor(q.limit ?? HISTORY_DEFAULT_LIMIT)),
    HISTORY_MAX_LIMIT
  )
  const orderBy =
    q.order === "asc"
      ? asc(chatMessages.createdAt)
      : desc(chatMessages.createdAt)
  const base = handle.select().from(chatMessages)
  const filtered = filters.length > 0 ? base.where(and(...filters)) : base
  const rows = await filtered.orderBy(orderBy).limit(limit)
  return rows.map(sanitizeMessage)
}

export async function projectIdForSession(
  sessionId: string
): Promise<string | null> {
  const handle = await ensureDb()
  const rows = await handle
    .select({ projectId: chatMessages.projectId })
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .limit(1)
  return rows[0]?.projectId ?? null
}

export async function deleteMessage(
  id: string
): Promise<ChatHistoryMessage | null> {
  const handle = await ensureDb()
  const rows = await handle
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.id, id))
    .limit(1)
  const msg = rows[0]
  if (!msg) return null
  await handle.delete(chatMessages).where(eq(chatMessages.id, id))
  return sanitizeMessage(msg)
}

export async function clearForSession(sessionId: string): Promise<void> {
  const handle = await ensureDb()
  await handle.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId))
}

// Clear a project's chat history. With `sinceMs`, only messages created at or
// after that epoch-ms cutoff are removed; otherwise the whole project is wiped.
export async function clearForProject(
  projectId: string,
  sinceMs?: number
): Promise<void> {
  const handle = await ensureDb()
  const where =
    sinceMs == null
      ? eq(chatMessages.projectId, projectId)
      : and(
          eq(chatMessages.projectId, projectId),
          gte(chatMessages.createdAt, sinceMs)
        )
  await handle.delete(chatMessages).where(where)
}

// Delete every message created before `cutoffMs` (epoch ms). Returns the
// number of rows removed. Used by the retention sweep.
export async function pruneOlderThan(cutoffMs: number): Promise<number> {
  const handle = await ensureDb()
  const res = await handle
    .delete(chatMessages)
    .where(lt(chatMessages.createdAt, cutoffMs))
  return res.rowsAffected ?? 0
}

export async function migrateProjectIds(
  migrations: Array<{ from: string; to: string }>
): Promise<void> {
  if (migrations.length === 0) return
  const handle = await ensureDb()
  for (const migration of migrations) {
    if (!migration.from || !migration.to || migration.from === migration.to) {
      continue
    }
    await handle
      .update(chatMessages)
      .set({ projectId: migration.to })
      .where(eq(chatMessages.projectId, migration.from))
  }
}

export async function closeDb(): Promise<void> {
  if (client) {
    client.close()
    client = null
    db = null
    ready = null
  }
}
