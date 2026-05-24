import path from "node:path"
import { randomUUID } from "node:crypto"
import { app } from "electron"
import Database from "better-sqlite3"

export type ChatHistoryMessage = {
  id: string
  sessionId: string
  projectId: string | null
  body: string
  agent: string | null
  createdAt: number
}

let db: Database.Database | null = null

function ensureDb(): Database.Database {
  if (db) return db
  const file = path.join(app.getPath("userData"), "chat.db")
  const handle = new Database(file)
  handle.pragma("journal_mode = WAL")
  handle.exec(`
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
  return handle
}

const COLS = "id, session_id AS sessionId, project_id AS projectId, body, agent, created_at AS createdAt"

export function appendMessage(
  sessionId: string,
  projectId: string | null,
  body: string,
  agent: string | null,
): ChatHistoryMessage {
  const handle = ensureDb()
  const msg: ChatHistoryMessage = {
    id: randomUUID(),
    sessionId,
    projectId,
    body,
    agent,
    createdAt: Date.now(),
  }
  handle
    .prepare(
      "INSERT INTO chat_messages (id, session_id, project_id, body, agent, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(msg.id, msg.sessionId, msg.projectId, msg.body, msg.agent, msg.createdAt)
  return msg
}

export function listForSession(sessionId: string): ChatHistoryMessage[] {
  const handle = ensureDb()
  return handle
    .prepare(
      `SELECT ${COLS} FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC`,
    )
    .all(sessionId) as ChatHistoryMessage[]
}

export function clearForSession(sessionId: string): void {
  const handle = ensureDb()
  handle
    .prepare("DELETE FROM chat_messages WHERE session_id = ?")
    .run(sessionId)
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
