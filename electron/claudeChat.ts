import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { promisify } from "node:util"
import {
  getSessionInfo,
  query,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk"
import type { WebContents } from "electron"

const execFileAsync = promisify(execFile)

export type ClaudeChatEvent =
  | { chatId: string; type: "text"; text: string }
  | {
      chatId: string
      type: "tool"
      name: string
      detail: string
      /** Human-readable line, e.g. "Listing PRs created today in this repo". */
      summary: string
    }
  | {
      chatId: string
      type: "status"
      phase: ClaudeChatPhase
      /** Output tokens this turn; estimated while a message streams. */
      outputTokens: number
    }
  | {
      chatId: string
      type: "permission"
      requestId: string
      name: string
      detail: string
    }
  | {
      chatId: string
      type: "question"
      requestId: string
      questions: ClaudeChatQuestion[]
    }
  | {
      chatId: string
      type: "finished"
      sessionId?: string
      error?: string
      /** The user stopped this turn. */
      stopped?: boolean
    }

export type ClaudeChatPhase =
  | "thinking"
  | "writing"
  | "tools"
  | "approval"
  | "question"

export type ClaudeChatQuestion = {
  question: string
  header: string
  multiSelect: boolean
  options: Array<{ label: string; description: string; preview?: string }>
}

// Claude Code's AskUserQuestion input, validated before it reaches the UI.
function readQuestions(input: Record<string, unknown>): ClaudeChatQuestion[] {
  if (!Array.isArray(input.questions)) return []
  return input.questions.flatMap((raw): ClaudeChatQuestion[] => {
    if (!raw || typeof raw !== "object") return []
    const q = raw as Record<string, unknown>
    if (typeof q.question !== "string") return []
    const options = Array.isArray(q.options)
      ? q.options.flatMap((option) => {
          const o = option as Record<string, unknown> | null
          return o && typeof o.label === "string"
            ? [
                {
                  label: o.label,
                  description:
                    typeof o.description === "string" ? o.description : "",
                  ...(typeof o.preview === "string"
                    ? { preview: o.preview }
                    : {}),
                },
              ]
            : []
        })
      : []
    return [
      {
        question: q.question,
        header: typeof q.header === "string" ? q.header : "",
        multiSelect: q.multiSelect === true,
        options,
      },
    ]
  })
}

export type ClaudeChatPermissionMode =
  | "auto"
  | "default"
  | "acceptEdits"
  | "plan"

const PERMISSION_MODES: ClaudeChatPermissionMode[] = [
  "auto",
  "default",
  "acceptEdits",
  "plan",
]

function isPermissionMode(value: unknown): value is ClaudeChatPermissionMode {
  return PERMISSION_MODES.includes(value as ClaudeChatPermissionMode)
}

export type ClaudeChatModel = {
  value: string
  displayName: string
  /** e.g. "Opus 5.5 with 1M context · Best for everyday, complex tasks" */
  description?: string
  supportedEffortLevels?: Array<"low" | "medium" | "high" | "xhigh" | "max">
}

type PendingPermission = {
  /** `answers` carries the user's choices for an AskUserQuestion prompt. */
  resolve: (allow: boolean, answers?: Record<string, string>) => void
}
type ActiveChat = {
  query?: Query
  permissions: Map<string, PendingPermission>
  stopping?: boolean
  /** Ends the turn and tells the chat; safe to call more than once. */
  finish?: (error?: string) => void
}

const activeChats = new Map<string, ActiveChat>()

function emit(sender: WebContents, event: ClaudeChatEvent) {
  if (!sender.isDestroyed()) sender.send("claudeChat:event", event)
}

function describeInput(
  input: Record<string, unknown>,
  { full = false } = {}
): string {
  // ExitPlanMode carries the plan the user is approving; show all of it.
  if (full && typeof input.plan === "string") return input.plan
  const value =
    input.command ?? input.file_path ?? input.path ?? input.description
  return typeof value === "string" ? value.slice(0, 500) : ""
}

function basename(value: unknown): string {
  return typeof value === "string" ? (value.split("/").pop() ?? value) : ""
}

// One readable line per tool call. Bash and Agent calls carry Claude's own
// description; for the rest, describe the call from its input.
function summarizeTool(name: string, input: Record<string, unknown>): string {
  if (typeof input.description === "string" && input.description.trim())
    return input.description.trim()
  const quoted = (value: unknown) =>
    typeof value === "string" ? `"${value.slice(0, 80)}"` : ""
  switch (name) {
    case "Read":
      return `Reading ${basename(input.file_path)}`
    case "Edit":
    case "MultiEdit":
      return `Editing ${basename(input.file_path)}`
    case "Write":
      return `Writing ${basename(input.file_path)}`
    case "NotebookEdit":
      return `Editing ${basename(input.notebook_path)}`
    case "Grep":
      return `Searching for ${quoted(input.pattern)}`
    case "Glob":
      return `Finding files matching ${quoted(input.pattern)}`
    case "WebFetch":
      return `Fetching ${typeof input.url === "string" ? input.url : "a page"}`
    case "WebSearch":
      return `Searching the web for ${quoted(input.query)}`
    case "TodoWrite":
      return "Updating the to-do list"
    case "ExitPlanMode":
      return "Presenting the plan"
    case "Bash":
      return `Running ${quoted(input.command)}`
    default:
      return name.startsWith("mcp__")
        ? `Using ${name.split("__").slice(1).join(" · ")}`
        : `Using ${name}`
  }
}

export async function findSystemClaude(pathEnv: string): Promise<string> {
  const { stdout } = await execFileAsync(
    process.platform === "win32" ? "where" : "which",
    ["claude"],
    { env: { ...process.env, PATH: pathEnv }, timeout: 5000 }
  )
  const binary = stdout.split(/\r?\n/).find(Boolean)?.trim()
  if (!binary)
    throw new Error(
      "Claude Code was not found. Install it and run claude auth login."
    )
  return binary
}

export type ClaudeChatCommand = {
  /** Without the leading slash. */
  name: string
  description: string
  argumentHint: string
}

export type ClaudeChatCatalog = {
  models: ClaudeChatModel[]
  commands: ClaudeChatCommand[]
}

// Models and slash commands (built-ins, custom commands, and skills for this
// project) from one short-lived Claude Code process, without sending a prompt.
export async function getClaudeChatCatalog(
  cwd: string,
  pathEnv: string
): Promise<ClaudeChatCatalog> {
  const binary = await findSystemClaude(pathEnv)
  let releaseInput: (() => void) | undefined
  const idleInput: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          await new Promise<void>((resolve) => {
            releaseInput = resolve
          })
          return { done: true as const, value: undefined }
        },
      }
    },
  }
  const probe = query({
    prompt: idleInput,
    options: {
      cwd,
      pathToClaudeCodeExecutable: binary,
      env: { ...process.env, PATH: pathEnv },
      settingSources: ["user", "project", "local"],
    },
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const [models, commands] = await Promise.race([
      Promise.all([
        probe.supportedModels(),
        probe.supportedCommands().catch(() => []),
      ]),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Model lookup timed out.")),
          10000
        )
      }),
    ])
    if (models.length === 0) throw new Error("Claude returned no models.")
    return {
      models: models.map((model) => ({
        value: model.value,
        displayName: model.displayName,
        description: model.description,
        supportedEffortLevels: model.supportedEffortLevels,
      })),
      commands: commands.map((command) => ({
        name: command.name,
        description: command.description,
        argumentHint: command.argumentHint,
      })),
    }
  } finally {
    if (timer) clearTimeout(timer)
    releaseInput?.()
    probe.close()
  }
}

// Interrupt the turn the way Esc does in the CLI. If Claude doesn't wind down
// promptly, kill the process, then end the turn regardless so the chat never
// stays stuck on "Stopping…".
export async function stopClaudeChat(chatId: string): Promise<void> {
  const active = activeChats.get(chatId)
  if (!active || active.stopping) return
  active.stopping = true
  for (const pending of active.permissions.values()) pending.resolve(false)
  active.permissions.clear()
  const stillRunning = () => activeChats.get(chatId) === active
  setTimeout(() => {
    if (!stillRunning()) return
    active.query?.close()
    setTimeout(() => {
      if (stillRunning()) active.finish?.()
    }, 1000)
  }, 1500)
  try {
    await active.query?.interrupt()
  } catch {
    active.query?.close()
  }
}

// The same title Claude Code shows for the session: a /rename title, else
// Claude's generated title, else the first prompt.
export async function getClaudeChatTitle(
  sessionId: string,
  cwd: string
): Promise<string | null> {
  try {
    const info = await getSessionInfo(sessionId, { dir: cwd })
    const title = (info?.customTitle || info?.summary || "")
      .replace(/\s+/g, " ")
      .trim()
    return title ? title.slice(0, 120) : null
  } catch {
    return null
  }
}

export async function setClaudeChatPermissionMode(
  chatId: string,
  mode: unknown
): Promise<void> {
  if (!isPermissionMode(mode)) return
  await activeChats.get(chatId)?.query?.setPermissionMode(mode)
}

export function answerClaudePermission(
  chatId: string,
  requestId: string,
  allow: boolean
): boolean {
  const pending = activeChats.get(chatId)?.permissions.get(requestId)
  if (!pending) return false
  activeChats.get(chatId)?.permissions.delete(requestId)
  pending.resolve(allow)
  return true
}

// `answers` maps each question's text to the chosen label(s), comma-separated
// for multi-select, or the user's own text; null dismisses the question.
export function answerClaudeQuestion(
  chatId: string,
  requestId: string,
  answers: Record<string, string> | null
): boolean {
  const pending = activeChats.get(chatId)?.permissions.get(requestId)
  if (!pending) return false
  activeChats.get(chatId)?.permissions.delete(requestId)
  pending.resolve(answers !== null, answers ?? undefined)
  return true
}

export async function startClaudeChat(
  sender: WebContents,
  input: {
    chatId: string
    cwd: string
    prompt: string
    sessionId?: string
    model?: string
    effort?: "low" | "medium" | "high" | "xhigh" | "max"
    permissionMode?: ClaudeChatPermissionMode
  },
  pathEnv: string
): Promise<{ ok: boolean; error?: string }> {
  if (!input.chatId || !input.cwd || !input.prompt.trim()) {
    return { ok: false, error: "A project and message are required." }
  }
  if (activeChats.has(input.chatId)) {
    return { ok: false, error: "Claude is already working in this chat." }
  }

  let binary: string
  try {
    binary = await findSystemClaude(pathEnv)
  } catch {
    return {
      ok: false,
      error: "Claude Code was not found. Install it and run claude auth login.",
    }
  }

  const active: ActiveChat = { permissions: new Map() }
  activeChats.set(input.chatId, active)
  let sessionId = input.sessionId
  let finished = false
  active.finish = (error?: string) => {
    if (finished) return
    finished = true
    for (const pending of active.permissions.values()) pending.resolve(false)
    active.permissions.clear()
    if (activeChats.get(input.chatId) === active)
      activeChats.delete(input.chatId)
    emit(sender, {
      chatId: input.chatId,
      type: "finished",
      sessionId,
      // An interrupted turn ends with an error result; that's expected.
      ...(active.stopping ? { stopped: true } : error ? { error } : {}),
    })
  }
  void (async () => {
    let streamedText = false
    // Separate Markdown from different content blocks so a table or list
    // after earlier text still starts on its own line.
    let emittedText = false
    const emitText = (text: string, startsBlock: boolean) => {
      emit(sender, {
        chatId: input.chatId,
        type: "text",
        text: startsBlock && emittedText ? `\n\n${text}` : text,
      })
      emittedText = true
    }

    // Live status for the chat's activity line. Output tokens are exact once
    // a message's usage arrives; while it streams, estimate ~4 chars/token.
    let phase: ClaudeChatPhase = "thinking"
    let finishedTokens = 0
    let messageTokens = 0
    let messageChars = 0
    let lastStatusAt = 0
    const emitStatus = (force: boolean) => {
      const now = Date.now()
      if (!force && now - lastStatusAt < 200) return
      lastStatusAt = now
      emit(sender, {
        chatId: input.chatId,
        type: "status",
        phase,
        outputTokens: finishedTokens + messageTokens,
      })
    }
    const setPhase = (next: ClaudeChatPhase) => {
      if (phase === next) return
      phase = next
      emitStatus(true)
    }
    emitStatus(true)
    try {
      const conversation = query({
        prompt: input.prompt,
        options: {
          cwd: input.cwd,
          pathToClaudeCodeExecutable: binary,
          env: { ...process.env, PATH: pathEnv },
          ...(sessionId ? { resume: sessionId } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.effort ? { effort: input.effort } : {}),
          includePartialMessages: true,
          permissionMode: isPermissionMode(input.permissionMode)
            ? input.permissionMode
            : "auto",
          settingSources: ["user", "project", "local"],
          canUseTool: (name, toolInput, options) =>
            new Promise((resolve) => {
              const isQuestion = name === "AskUserQuestion"
              const requestId = randomUUID()
              const onAbort = () => settle(false)
              const settle = (
                allow: boolean,
                answers?: Record<string, string>
              ) => {
                options.signal.removeEventListener("abort", onAbort)
                active.permissions.delete(requestId)
                resolve(
                  allow
                    ? {
                        behavior: "allow",
                        // Claude Code reads the user's choices from `answers`.
                        updatedInput: isQuestion
                          ? { ...toolInput, answers: answers ?? {} }
                          : toolInput,
                      }
                    : {
                        behavior: "deny",
                        message: isQuestion
                          ? "The user dismissed the question without answering."
                          : "User declined tool execution.",
                      }
                )
              }
              active.permissions.set(requestId, {
                resolve: (allow, answers) => {
                  setPhase("tools")
                  settle(allow, answers)
                },
              })
              setPhase(isQuestion ? "question" : "approval")
              options.signal.addEventListener("abort", onAbort, { once: true })
              emit(
                sender,
                isQuestion
                  ? {
                      chatId: input.chatId,
                      type: "question",
                      requestId,
                      questions: readQuestions(toolInput),
                    }
                  : {
                      chatId: input.chatId,
                      type: "permission",
                      requestId,
                      name,
                      detail: describeInput(toolInput, { full: true }),
                    }
              )
              if (options.signal.aborted) settle(false)
            }),
        },
      })
      active.query = conversation
      for await (const message of conversation) {
        if (message.session_id) sessionId = message.session_id
        if (message.type === "stream_event") {
          const event = message.event
          if (event.type === "message_start") {
            finishedTokens += messageTokens
            messageTokens = 0
            messageChars = 0
            setPhase("thinking")
          } else if (event.type === "message_delta") {
            if (event.usage?.output_tokens) {
              messageTokens = event.usage.output_tokens
              emitStatus(true)
            }
          } else if (event.type === "content_block_start") {
            const kind = event.content_block.type
            if (kind === "text") {
              setPhase("writing")
              if (emittedText) emitText("", true)
            } else if (kind === "thinking" || kind === "redacted_thinking") {
              setPhase("thinking")
            } else if (kind === "tool_use" || kind === "server_tool_use") {
              setPhase("tools")
            }
          } else if (event.type === "content_block_delta") {
            const delta = event.delta
            if (delta.type === "text_delta") {
              streamedText = true
              emitText(delta.text, false)
              messageChars += delta.text.length
            } else if (delta.type === "thinking_delta") {
              messageChars += delta.thinking.length
            } else if (delta.type === "input_json_delta") {
              messageChars += delta.partial_json.length
            }
            messageTokens = Math.round(messageChars / 4)
            emitStatus(false)
          }
        } else if (message.type === "assistant") {
          for (const block of message.message.content) {
            if (block.type === "tool_use") {
              const toolInput = block.input as Record<string, unknown>
              setPhase("tools")
              emit(sender, {
                chatId: input.chatId,
                type: "tool",
                name: block.name,
                detail: describeInput(toolInput),
                summary: summarizeTool(block.name, toolInput),
              })
            } else if (block.type === "text" && !streamedText) {
              emitText(block.text, true)
            }
          }
          streamedText = false
        } else if (
          message.type === "result" &&
          (message.subtype !== "success" || message.is_error)
        ) {
          active.finish?.(
            "errors" in message
              ? message.errors.join("\n")
              : message.result || "Claude could not finish this turn."
          )
          return
        }
      }
      active.finish?.()
    } catch (error) {
      active.finish?.(
        error instanceof Error ? error.message : "Claude Code failed to start."
      )
    } finally {
      active.finish?.()
    }
  })()
  return { ok: true }
}
