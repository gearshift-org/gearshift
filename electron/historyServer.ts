import http from "node:http"
import { getProjectNote, queryMessages, type HistoryQuery } from "./db/chatDb"

// A small, local-only HTTP API that serves chat history so agents (or any local
// tool) can pull recent prompts and summarize them. Bound to 127.0.0.1 only —
// never reachable off-machine — so it intentionally has no authentication.

export type HistoryServerProject = {
  id: string
  name?: string
  path?: string
}

type StartOptions = {
  /** Returns the current project list for id → name/path enrichment. */
  getProjects?: () => HistoryServerProject[]
}

const DEFAULT_PORT = 41984
const MAX_PORT_ATTEMPTS = 10

let server: http.Server | null = null
let resolvedPort = 0
let getProjectsFn: (() => HistoryServerProject[]) | null = null

export function getHistoryServerPort(): number {
  return resolvedPort
}

function preferredPort(): number {
  const raw = process.env.GEARSHIFT_HISTORY_PORT
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536
    ? parsed
    : DEFAULT_PORT
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(payload),
  })
  res.end(payload)
}

function sendMarkdown(res: http.ServerResponse, status: number, body: string) {
  res.writeHead(status, {
    "Content-Type": "text/markdown; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(body),
  })
  res.end(body)
}

function metadataLine(value: string | undefined): string | null {
  const cleaned = value?.replace(/\s+/g, " ").trim()
  return cleaned ? cleaned : null
}

function projectNotesMarkdown({
  projectId,
  project,
  body,
  updatedAt,
}: {
  projectId: string
  project: HistoryServerProject | null
  body: string
  updatedAt: number | null
}) {
  const lines = ["# Project Notes", "", `Project ID: \`${projectId}\``]
  const projectName = metadataLine(project?.name)
  const projectPath = metadataLine(project?.path)
  if (projectName) lines.push(`Project: ${projectName}`)
  if (projectPath) lines.push(`Path: \`${projectPath}\``)
  if (updatedAt !== null) {
    lines.push(`Updated: ${new Date(updatedAt).toISOString()}`)
  }
  lines.push(
    "",
    "## Notes",
    "",
    body.trim() || "_No notes saved for this project._",
    ""
  )
  return lines.join("\n")
}

function parseIntParam(value: string | null): number | undefined {
  if (value == null) return undefined
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : undefined
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  // Only GET is supported; everything else is rejected.
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" })
    return
  }
  let url: URL
  try {
    url = new URL(req.url ?? "/", `http://127.0.0.1:${resolvedPort}`)
  } catch {
    sendJson(res, 400, { error: "bad_request" })
    return
  }

  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true, port: resolvedPort })
    return
  }

  if (url.pathname === "/history") {
    const p = url.searchParams
    const query: HistoryQuery = {
      ...(p.get("projectId") ? { projectId: p.get("projectId")! } : {}),
      ...(p.get("sessionId") ? { sessionId: p.get("sessionId")! } : {}),
      ...(parseIntParam(p.get("since")) !== undefined
        ? { since: parseIntParam(p.get("since")) }
        : {}),
      ...(parseIntParam(p.get("until")) !== undefined
        ? { until: parseIntParam(p.get("until")) }
        : {}),
      ...(parseIntParam(p.get("limit")) !== undefined
        ? { limit: parseIntParam(p.get("limit")) }
        : {}),
      order: p.get("order") === "asc" ? "asc" : "desc",
    }
    queryMessages(query)
      .then((messages) => {
        const projects = getProjectsFn?.() ?? []
        sendJson(res, 200, {
          count: messages.length,
          messages,
          projects,
        })
      })
      .catch((err) => {
        console.error("[history-server] query failed", err)
        sendJson(res, 500, { error: "query_failed" })
      })
    return
  }

  if (url.pathname === "/notes") {
    const projectId = url.searchParams.get("projectId")
    if (!projectId) {
      sendJson(res, 400, { error: "missing_project_id" })
      return
    }
    getProjectNote(projectId)
      .then((note) => {
        const projects = getProjectsFn?.() ?? []
        const project = projects.find((p) => p.id === projectId) ?? null
        sendMarkdown(
          res,
          200,
          projectNotesMarkdown({
            projectId,
            project,
            body: note?.body ?? "",
            updatedAt: note?.updatedAt ?? null,
          })
        )
      })
      .catch((err) => {
        console.error("[history-server] notes query failed", err)
        sendJson(res, 500, { error: "query_failed" })
      })
    return
  }

  sendJson(res, 404, { error: "not_found" })
}

function listenWithRetry(srv: http.Server, port: number, attempt: number) {
  return new Promise<number>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      srv.off("error", onError)
      if (err.code === "EADDRINUSE" && attempt < MAX_PORT_ATTEMPTS) {
        listenWithRetry(srv, port + 1, attempt + 1).then(resolve, reject)
      } else {
        reject(err)
      }
    }
    srv.once("error", onError)
    srv.listen(port, "127.0.0.1", () => {
      srv.off("error", onError)
      const address = srv.address()
      resolve(typeof address === "object" && address ? address.port : port)
    })
  })
}

export async function startHistoryServer(
  opts: StartOptions = {}
): Promise<void> {
  if (server) return
  getProjectsFn = opts.getProjects ?? null
  const srv = http.createServer(handleRequest)
  server = srv
  try {
    resolvedPort = await listenWithRetry(srv, preferredPort(), 0)
  } catch (err) {
    console.warn("[history-server] failed to start", err)
    server = null
    resolvedPort = 0
  }
}

export function closeHistoryServer(): void {
  try {
    server?.close()
  } catch {
    // ignore shutdown errors
  }
  server = null
  resolvedPort = 0
  getProjectsFn = null
}
