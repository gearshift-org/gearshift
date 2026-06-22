import path from "node:path"
import { randomUUID } from "node:crypto"
import { app } from "electron"
import { createClient, type Client } from "@libsql/client"
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql"
import { desc, eq, lt } from "drizzle-orm"
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

export async function clearForProject(projectId: string): Promise<void> {
  const handle = await ensureDb()
  await handle.delete(chatMessages).where(eq(chatMessages.projectId, projectId))
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
