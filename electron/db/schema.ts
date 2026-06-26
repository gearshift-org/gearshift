import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    projectId: text("project_id"),
    body: text("body").notNull(),
    agent: text("agent"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_chat_session").on(t.sessionId, t.createdAt),
    index("idx_chat_project").on(t.projectId, t.createdAt),
  ]
)

export const projectNotes = sqliteTable("project_notes", {
  projectId: text("project_id").primaryKey(),
  body: text("body").notNull(),
  updatedAt: integer("updated_at").notNull(),
})

export type ChatMessageRow = typeof chatMessages.$inferSelect
export type ProjectNoteRow = typeof projectNotes.$inferSelect
