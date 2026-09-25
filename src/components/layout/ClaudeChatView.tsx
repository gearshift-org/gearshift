import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import Fuse from "fuse.js"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Gauge,
  History,
  Square,
  Sparkles,
  X,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FileIcon } from "@/components/icons/FileIcon"
import { getPathDragData, hasPathDragData } from "@/lib/pathDrag"
import { store } from "@/lib/store"
import { cn } from "@/lib/utils"
import type {
  ClaudeChatCatalog,
  ClaudeChatCommand,
  ClaudeChatDiff,
  ClaudeChatImage,
  ClaudeChatModel,
  ClaudeChatPermissionMode,
  ClaudeChatPhase,
  ClaudeChatQuestion,
  ClaudeChatSession,
} from "../../../electron/claudeChat"
import type { TerminalAgentStatus } from "./types"

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  /** Older replies: all tool calls, shown above `text`. */
  tools?: Array<{ name: string; detail: string; summary?: string }>
  /** Replies' text and tool calls in order. When present, `text`/`tools` are unused. */
  parts?: ChatPart[]
  error?: string
  /** The user stopped this reply. */
  stopped?: boolean
  /** When the message was sent (user) or the reply started (assistant). */
  createdAt?: number
  /** When Claude finished this reply. */
  finishedAt?: number
  /** Output tokens Claude produced for this reply. */
  outputTokens?: number
  /** Sent while a turn was ending; goes out as the next turn. */
  queued?: boolean
  /** Thumbnails (data URLs) of images sent with the message. */
  images?: string[]
}

type ChatPart =
  | { type: "text"; text: string }
  | {
      type: "tool"
      name: string
      detail: string
      summary?: string
      diff?: ClaudeChatDiff
    }

type ChatEffort = "" | "low" | "medium" | "high" | "xhigh" | "max"
type ChatStatus = { phase: ClaudeChatPhase; outputTokens: number }

const phaseLabels: Record<ClaudeChatPhase, string> = {
  thinking: "Thinking…",
  writing: "Writing…",
  tools: "Running tools…",
  approval: "Waiting for your approval…",
  question: "Waiting for your answer…",
}

// Claude Code's spinner glyphs, played forward then back.
const SPINNER_FRAMES = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"]

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

// "12:04 PM" today, "Sep 23, 12:04 PM" otherwise.
function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })
  if (date.toDateString() === new Date().toDateString()) return time
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`
}

function formatFullTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "medium",
  })
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens} tokens`
  return `${(tokens / 1000).toFixed(1)}k tokens`
}

// Live "what Claude is doing" line under the streaming reply.
function ActivityStatus({
  startedAt,
  status,
  stopping,
}: {
  startedAt: number
  status: ChatStatus
  stopping: boolean
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 120)
    return () => clearInterval(timer)
  }, [])
  const frame = SPINNER_FRAMES[Math.floor(now / 120) % SPINNER_FRAMES.length]
  return (
    <div
      role="status"
      className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"
    >
      <span
        aria-hidden
        className="inline-block w-3.5 text-center text-[13px] text-[#d97757]"
      >
        {frame}
      </span>
      <span className="tabular-nums">
        {formatElapsed(Math.max(0, now - startedAt))} ·{" "}
        {formatTokens(status.outputTokens)} ·{" "}
        {stopping ? "Stopping…" : phaseLabels[status.phase]}
      </span>
    </div>
  )
}
type ChatSnapshot = {
  sessionId?: string
  model?: string
  effort?: ChatEffort
  permissionMode?: ClaudeChatPermissionMode
  messages: ChatMessage[]
}

const DEFAULT_PERMISSION_MODE: ClaudeChatPermissionMode = "auto"

const permissionModes: Array<{
  value: ClaudeChatPermissionMode
  label: string
  description: string
}> = [
  {
    value: "auto",
    label: "Auto",
    description: "Claude handles permission decisions",
  },
  {
    value: "default",
    label: "Manual",
    description: "Always ask before making changes",
  },
  {
    value: "acceptEdits",
    label: "Accept edits",
    description: "Automatically accept all file edits",
  },
  {
    value: "plan",
    label: "Plan",
    description: "Create a plan before making changes",
  },
  {
    value: "bypassPermissions",
    label: "Full access",
    description: "Allow commands and edits without prompts",
  },
]

// Full access is never carried into new chats or reached by Shift+Tab, so it
// is always a deliberate choice.
const FULL_ACCESS: ClaudeChatPermissionMode = "bypassPermissions"
const cyclePermissionModes = permissionModes.filter(
  (mode) => mode.value !== FULL_ACCESS
)

const efforts: Array<{ value: ChatEffort; label: string }> = [
  { value: "", label: "Default effort" },
  { value: "low", label: "Low effort" },
  { value: "medium", label: "Medium effort" },
  { value: "high", label: "High effort" },
  { value: "xhigh", label: "Extra-high effort" },
  { value: "max", label: "Max effort" },
]

// Fenced code block with a copy button that appears on hover or focus.
// Copies `getText()` and shows "Copied" briefly. Hidden until its `group`
// ancestor is hovered, unless focused or just used.
function CopyButton({
  getText,
  label,
  showText = false,
  className,
}: {
  getText: () => string | undefined
  label: string
  showText?: boolean
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  const copy = async () => {
    const text = getText()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // Clipboard unavailable; leave the button as is.
    }
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded text-[11px] text-muted-foreground transition-opacity hover:text-foreground focus-visible:opacity-100",
        showText ? "px-1.5" : "w-6 justify-center",
        copied ? "opacity-100" : "opacity-0",
        className
      )}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {showText && (copied ? "Copied" : "Copy")}
    </button>
  )
}

// Fenced code block with a copy button that appears on hover or focus.
function CodeBlock({ children }: { children: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null)
  return (
    <div className="group/code relative my-2 first:mt-0 last:mb-0">
      <pre
        ref={preRef}
        className="overflow-x-auto rounded-md border border-border bg-background p-2.5 pr-16 font-mono text-xs leading-5 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-xs"
      >
        {children}
      </pre>
      <CopyButton
        getText={() => preRef.current?.textContent?.replace(/\n$/, "")}
        label="Copy code"
        showText
        className="absolute top-1.5 right-1.5 border border-border bg-card group-hover/code:opacity-100"
      />
    </div>
  )
}

const linkClass =
  "font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"

// Where a bare URL in plain text ends: trailing sentence punctuation, and a
// closing bracket with no opening one inside the URL, belong to the text.
function trimUrl(url: string): string {
  let end = url.length
  for (;;) {
    const last = url[end - 1]
    if (/[.,;:!?'"]/.test(last)) {
      end -= 1
      continue
    }
    const open = { ")": "(", "]": "[", "}": "{" }[last]
    if (open) {
      const body = url.slice(0, end)
      if (body.split(open).length <= body.split(last).length - 1) {
        end -= 1
        continue
      }
    }
    return url.slice(0, end)
  }
}

// Plain text with its http(s) URLs as links, which open in the browser.
function LinkifiedText({ text }: { text: string }) {
  const parts: ReactNode[] = []
  let index = 0
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
    const url = trimUrl(match[0])
    if (url.length <= "https://".length) continue
    const start = match.index
    if (start > index) parts.push(text.slice(index, start))
    parts.push(
      <a
        key={start}
        href={url}
        target="_blank"
        rel="noreferrer"
        className={linkClass}
      >
        {url}
      </a>
    )
    index = start + url.length
  }
  if (parts.length === 0) return <>{text}</>
  if (index < text.length) parts.push(text.slice(index))
  return <>{parts}</>
}

const markdownComponents: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => (
    <h1 className="mt-4 mb-1.5 text-[15px] font-semibold first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-4 mb-1.5 text-[14px] font-semibold first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-1 text-[13px] font-semibold first:mt-0">
      {children}
    </h3>
  ),
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-0.5 pl-5 marker:text-muted-foreground first:mt-0 last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-0.5 pl-5 marker:text-muted-foreground first:mt-0 last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="pl-0.5 [&>ol]:my-0.5 [&>ul]:my-0.5">{children}</li>
  ),
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className={linkClass}>
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground first:mt-0 last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-border" />,
  code: ({ children }) => (
    <code className="rounded bg-foreground/10 px-1 py-px font-mono text-[0.85em]">
      {/* Claude often writes URLs as code, e.g. `http://localhost:3000`. */}
      {typeof children === "string" ? (
        <LinkifiedText text={children} />
      ) : (
        children
      )}
    </code>
  ),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-md border border-border first:mt-0 last:mb-0">
      <table className="w-full border-collapse text-left text-xs leading-5">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-foreground/5">{children}</thead>
  ),
  tr: ({ children }) => (
    <tr className="border-b border-border last:border-b-0">{children}</tr>
  ),
  th: ({ children, style }) => (
    <th
      style={style}
      className="border-r border-border px-2.5 py-1.5 font-semibold last:border-r-0"
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td
      style={style}
      className="border-r border-border px-2.5 py-1.5 align-top last:border-r-0"
    >
      {children}
    </td>
  ),
}

// The model's version name and what it's best for. Newer Claude Code puts
// the version in the display name ("Opus 5.5") and only the tagline in the
// description ("Most capable for ambitious work"). Older versions used a bare
// display name ("Opus") and led the description with the version, e.g.
// "Opus 5.5 with 1M context · Best for everyday, complex tasks". The
// "default" entry still uses that combined form in its description.
function modelVersion(model: ClaudeChatModel) {
  const description = model.description?.trim() ?? ""
  const [lead, ...rest] = description.split(" · ")
  const combined = rest.length > 0 && !!lead?.trim()
  const version = (combined ? lead : model.displayName).trim()
  return {
    name: version,
    short: version.replace(/ (with 1M context|\(1M context\))$/, " · 1M"),
    tagline: combined ? rest.join(" · ") : description,
  }
}

type ChatSettings = Pick<ChatSnapshot, "model" | "effort" | "permissionMode">

// The last model/effort/mode the user picked in any chat; new chats start
// from it.
const SETTINGS_KEY = "gearshift.claudeChat.lastSettings"

function sanitizeSettings(parsed: Partial<ChatSettings>): ChatSettings {
  return {
    model: typeof parsed.model === "string" ? parsed.model : "",
    effort: efforts.some((effort) => effort.value === parsed.effort)
      ? parsed.effort
      : "",
    permissionMode: permissionModes.some(
      (mode) => mode.value === parsed.permissionMode
    )
      ? parsed.permissionMode
      : DEFAULT_PERMISSION_MODE,
  }
}

function readLastSettings(): ChatSettings {
  try {
    const raw = store.get(SETTINGS_KEY)
    return sanitizeSettings(raw ? (JSON.parse(raw) as ChatSettings) : {})
  } catch {
    return sanitizeSettings({})
  }
}

function rememberSettings(settings: ChatSettings) {
  store.set(
    SETTINGS_KEY,
    JSON.stringify({ ...readLastSettings(), ...settings })
  )
}

const MODELS_CACHE_KEY = "gearshift.claudeChat.models"
const MODELS_REFRESH_MS = 10 * 60 * 1000

function readCachedModels(): ClaudeChatModel[] {
  try {
    const parsed = JSON.parse(store.get(MODELS_CACHE_KEY) ?? "[]") as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (model): model is ClaudeChatModel =>
        !!model &&
        typeof model.value === "string" &&
        typeof model.displayName === "string"
    )
  } catch {
    return []
  }
}

function commandsCacheKey(cwd: string) {
  return `gearshift.claudeChat.commands.${cwd}`
}

function readCachedCommands(cwd: string): ClaudeChatCommand[] {
  try {
    const parsed = JSON.parse(
      store.get(commandsCacheKey(cwd)) ?? "[]"
    ) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (command): command is ClaudeChatCommand =>
        !!command && typeof command.name === "string"
    )
  } catch {
    return []
  }
}

// One lookup per project folder, shared by every chat tab and reused for ten
// minutes. Each lookup starts a short-lived Claude Code process, so tabs
// mounting at once (e.g. after a reload) share it instead of each starting
// their own. Models are cached globally; commands and skills per folder.
const catalogRequests = new Map<
  string,
  { request: Promise<ClaudeChatCatalog>; at: number }
>()

function loadCatalog(cwd: string): Promise<ClaudeChatCatalog> {
  const existing = catalogRequests.get(cwd)
  if (existing && Date.now() - existing.at < MODELS_REFRESH_MS)
    return existing.request
  const request = window.claudeChat.catalog(cwd).then((catalog) => {
    store.set(MODELS_CACHE_KEY, JSON.stringify(catalog.models))
    store.set(commandsCacheKey(cwd), JSON.stringify(catalog.commands))
    return catalog
  })
  request.catch(() => {
    if (catalogRequests.get(cwd)?.request === request)
      catalogRequests.delete(cwd)
  })
  catalogRequests.set(cwd, { request, at: Date.now() })
  return request
}

function readSnapshot(chatId: string): ChatSnapshot {
  try {
    const raw = store.get(`gearshift.claudeChat.${chatId}`)
    if (!raw) return { ...readLastSettings(), messages: [] }
    const parsed = JSON.parse(raw) as ChatSnapshot
    return {
      sessionId:
        typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
      ...sanitizeSettings(parsed),
      messages: Array.isArray(parsed.messages)
        ? parsed.messages.filter(
            (message) =>
              message &&
              typeof message.id === "string" &&
              (message.role === "user" || message.role === "assistant") &&
              typeof message.text === "string"
          )
        : [],
    }
  } catch {
    return { ...readLastSettings(), messages: [] }
  }
}

// Compact, borderless toolbar buttons inside the composer, VS Code style.
const chipClass =
  "inline-flex h-6 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[popup-open]:bg-foreground/10 data-[popup-open]:text-foreground"
const primaryButtonClass =
  "h-6 rounded bg-foreground px-2.5 text-xs font-medium text-background disabled:opacity-40"
const secondaryButtonClass =
  "h-6 rounded border border-border px-2.5 text-xs hover:bg-foreground/5"

// A leading "/command" in a sent message is shown bold, like the input chip.
function UserMessageText({ text }: { text: string }) {
  // Command-shaped only, so a leading path like "/Users/me" isn't bolded.
  const match = /^(\/[\w:.-]+)(\s[\s\S]*)?$/.exec(text)
  if (!match) return <LinkifiedText text={text} />
  return (
    <>
      <span className="font-semibold">{match[1]}</span>
      <LinkifiedText text={match[2] ?? ""} />
    </>
  )
}

function isEditableTarget(el: Element | null): boolean {
  if (!el) return false
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    (el as HTMLElement).isContentEditable
  )
}

// True while a visible menu or dialog should keep keyboard input.
function overlayOpen(): boolean {
  const overlays = document.querySelectorAll<HTMLElement>(
    "[role=menu], [role=dialog]"
  )
  return [...overlays].some((el) => el.offsetParent !== null)
}

const OTHER_OPTION = "\u0000other"

// Claude Code's AskUserQuestion prompt: 1–4 questions, each with 2–4 options
// (single or multi-select) plus a free-text "Other".
function QuestionCard({
  questions,
  onSubmit,
  onDismiss,
}: {
  questions: ClaudeChatQuestion[]
  onSubmit: (answers: Record<string, string>) => void
  onDismiss: () => void
}) {
  const [selected, setSelected] = useState<Record<number, string[]>>({})
  const [other, setOther] = useState<Record<number, string>>({})

  const answerFor = (index: number) => {
    const picks = selected[index] ?? []
    const labels = picks.filter((label) => label !== OTHER_OPTION)
    const custom = other[index]?.trim()
    if (picks.includes(OTHER_OPTION) && custom) labels.push(custom)
    return labels.join(", ")
  }
  const complete = questions.every((_, index) => answerFor(index))
  const submit = () => {
    if (!complete) return
    onSubmit(
      Object.fromEntries(
        questions.map((q, index) => [q.question, answerFor(index)])
      )
    )
  }
  const toggle = (index: number, label: string, multi: boolean) =>
    setSelected((current) => {
      const picks = current[index] ?? []
      const next = multi
        ? picks.includes(label)
          ? picks.filter((pick) => pick !== label)
          : [...picks, label]
        : [label]
      return { ...current, [index]: next }
    })

  return (
    <div className="rounded-lg border border-border bg-background p-3 text-[13px] leading-5">
      {questions.map((q, index) => {
        const picks = selected[index] ?? []
        const choices = [
          ...q.options,
          {
            label: OTHER_OPTION,
            description: "Type your own answer",
            preview: undefined,
          },
        ]
        return (
          <div
            key={q.question}
            role={q.multiSelect ? "group" : "radiogroup"}
            aria-label={q.question}
            className="[&+&]:mt-4"
          >
            <div className="flex items-center gap-2">
              {q.header && (
                <span className="rounded bg-foreground/10 px-1.5 text-[11px] leading-5 font-medium text-muted-foreground">
                  {q.header}
                </span>
              )}
              {q.multiSelect && (
                <span className="text-xs text-muted-foreground">
                  Select all that apply
                </span>
              )}
            </div>
            <p className="mt-1.5 font-medium">{q.question}</p>
            <div className="mt-2 flex flex-col gap-1">
              {choices.map((option) => {
                const isOther = option.label === OTHER_OPTION
                const checked = picks.includes(option.label)
                return (
                  <div key={option.label}>
                    <button
                      type="button"
                      role={q.multiSelect ? "checkbox" : "radio"}
                      aria-checked={checked}
                      onClick={() => toggle(index, option.label, q.multiSelect)}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors",
                        checked
                          ? "border-foreground/50 bg-foreground/5"
                          : "border-border hover:bg-foreground/5"
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1 grid size-3.5 shrink-0 place-items-center border",
                          q.multiSelect ? "rounded-sm" : "rounded-full",
                          checked
                            ? "border-foreground bg-foreground"
                            : "border-muted-foreground/60"
                        )}
                      >
                        {checked && (
                          <span
                            className={cn(
                              "size-1.5 bg-background",
                              q.multiSelect ? "rounded-[1px]" : "rounded-full"
                            )}
                          />
                        )}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium">
                          {isOther ? "Other" : option.label}
                        </span>
                        {option.description && (
                          <span className="text-xs text-muted-foreground">
                            {option.description}
                          </span>
                        )}
                      </span>
                    </button>
                    {checked && option.preview && (
                      <pre className="mt-1 overflow-x-auto rounded border border-border bg-card p-2.5 font-mono text-[11px] leading-5">
                        {option.preview}
                      </pre>
                    )}
                    {checked && isOther && (
                      <input
                        autoFocus
                        value={other[index] ?? ""}
                        onChange={(event) =>
                          setOther((current) => ({
                            ...current,
                            [index]: event.target.value,
                          }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault()
                            submit()
                          }
                        }}
                        placeholder="Your answer"
                        aria-label={`Your answer to: ${q.question}`}
                        className="mt-1 w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-[13px] outline-none focus:border-ring"
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      <div className="mt-3 flex gap-1.5">
        <button
          type="button"
          onClick={submit}
          disabled={!complete}
          className={primaryButtonClass}
        >
          Submit
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className={secondaryButtonClass}
        >
          Skip
        </button>
      </div>
    </div>
  )
}

// An image attached in the composer: what Claude receives, plus a small
// thumbnail kept in the transcript (the full image isn't stored).
type Attachment = ClaudeChatImage & { id: string; thumb: string }

const MAX_ATTACHMENTS = 20
// Anthropic's recommended maximum edge; larger images are scaled down first.
const MAX_IMAGE_EDGE = 1568
// Keep base64 under the API's 5 MB per-image limit.
const MAX_IMAGE_BASE64 = 6_500_000
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

function imageFiles(data: DataTransfer | null): File[] {
  return Array.from(data?.files ?? []).filter((file) =>
    IMAGE_TYPES.includes(file.type)
  )
}

function fileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// Read an image file for sending: kept as-is when small enough, otherwise
// redrawn at most MAX_IMAGE_EDGE on its long side. Null if unreadable.
async function readImage(file: File): Promise<Attachment | null> {
  if (!IMAGE_TYPES.includes(file.type)) return null
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const draw = (maxEdge: number, type: string, quality?: number) => {
      const scale = Math.min(
        1,
        maxEdge / Math.max(image.naturalWidth, image.naturalHeight)
      )
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext("2d")
      if (!context) throw new Error("Canvas unavailable")
      if (type === "image/jpeg") {
        // JPEG has no transparency; flatten onto white.
        context.fillStyle = "#fff"
        context.fillRect(0, 0, canvas.width, canvas.height)
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL(type, quality)
    }
    const oversized =
      Math.max(image.naturalWidth, image.naturalHeight) > MAX_IMAGE_EDGE
    let dataUrl = oversized ? "" : await fileAsDataUrl(file)
    let mediaType = file.type as ClaudeChatImage["mediaType"]
    if (oversized || dataUrl.length > MAX_IMAGE_BASE64) {
      // PNG keeps screenshots crisp; fall back to JPEG if it's still too big.
      mediaType = file.type === "image/png" ? "image/png" : "image/jpeg"
      dataUrl = draw(MAX_IMAGE_EDGE, mediaType, 0.9)
      if (dataUrl.length > MAX_IMAGE_BASE64) {
        mediaType = "image/jpeg"
        dataUrl = draw(MAX_IMAGE_EDGE, mediaType, 0.85)
      }
    }
    return {
      id: crypto.randomUUID(),
      mediaType,
      data: dataUrl.slice(dataUrl.indexOf(",") + 1),
      thumb: draw(160, "image/jpeg", 0.8),
    }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

function toClaudeImage({ mediaType, data }: Attachment): ClaudeChatImage {
  return { mediaType, data }
}

// Add streamed text to a reply: onto its last text part (a new one after a
// tool call), or onto `text` for replies saved before parts.
function appendText(message: ChatMessage, text: string): ChatMessage {
  if (!message.parts) return { ...message, text: message.text + text }
  const last = message.parts.at(-1)
  return {
    ...message,
    parts:
      last?.type === "text"
        ? [
            ...message.parts.slice(0, -1),
            { type: "text", text: last.text + text },
          ]
        : [...message.parts, { type: "text", text }],
  }
}

// Project files for "@" mentions (git-tracked and untracked, not ignored),
// shared across chats in a project and refreshed at most every 30 seconds.
const projectFiles = new Map<string, { at: number; files: Promise<string[]> }>()
function loadProjectFiles(cwd: string): Promise<string[]> {
  const cached = projectFiles.get(cwd)
  if (cached && Date.now() - cached.at < 30_000) return cached.files
  const files = window.fsApi
    .listAllFiles(cwd)
    .then((result) => (result.ok ? result.files : []))
    .catch(() => [])
  projectFiles.set(cwd, { at: Date.now(), files })
  return files
}

// A dragged-in path as an "@" file reference, like one picked from the "@"
// menu: relative to the project when it's inside it, absolute otherwise.
// Paths with spaces are quoted so they stay one reference.
function pathReference(path: string, cwd: string): string {
  const root = cwd.replace(/\/+$/, "")
  const ref =
    root && path.startsWith(`${root}/`)
      ? path.slice(root.length + 1)
      : root && path === root
        ? "."
        : path
  return /\s/.test(ref) ? `@"${ref}"` : `@${ref}`
}

// The "@partial" being typed at the caret, if any.
function mentionAt(draft: string, caret: number) {
  const match = /(^|\s)@([^\s@]*)$/.exec(draft.slice(0, caret))
  if (!match) return null
  return { start: caret - match[2].length - 1, query: match[2] }
}

// Index of the last Claude reply (-1 if none).
function lastReplyIndex(messages: ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1)
    if (messages[index].role === "assistant") return index
  return -1
}

// "5m ago", "3h ago", "Yesterday", or a date.
function formatRelative(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000)
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  if (hours < 48) return "Yesterday"
  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  })
}

// Empty-chat button that lists this project's Claude Code sessions (what
// `/resume` shows) and continues the one picked.
function SessionPicker({
  cwd,
  onPick,
}: {
  cwd: string
  onPick: (session: ClaudeChatSession) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<ClaudeChatSession[] | null>(null)
  const [filter, setFilter] = useState("")
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const show = () => {
    setOpen(true)
    setError(null)
    void window.claudeChat
      .sessions(cwd)
      .then(setSessions)
      .catch(() => setSessions([]))
  }
  const pick = async (session: ClaudeChatSession) => {
    setLoadingId(session.sessionId)
    setError(null)
    try {
      await onPick(session)
    } catch {
      setError("Couldn't load that session.")
      setLoadingId(null)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={show}
        className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs text-foreground hover:bg-foreground/5"
      >
        <History className="size-3.5" />
        Resume a previous session
      </button>
    )
  }

  const query = filter.trim().toLowerCase()
  const shown = (sessions ?? []).filter(
    (session) =>
      !query ||
      session.title.toLowerCase().includes(query) ||
      session.gitBranch?.toLowerCase().includes(query)
  )
  return (
    <div className="mt-3 w-full max-w-md overflow-hidden rounded-lg border border-border bg-background text-left">
      <div className="flex items-center gap-2 border-b border-border px-2.5">
        <History className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              setOpen(false)
            } else if (event.key === "Enter" && shown[0]) {
              event.preventDefault()
              void pick(shown[0])
            }
          }}
          placeholder="Search sessions…"
          aria-label="Search previous sessions"
          className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="grid size-5 place-items-center rounded text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto p-1">
        {sessions === null ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            Loading sessions…
          </p>
        ) : shown.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {sessions.length === 0
              ? "No Claude Code sessions for this project yet."
              : "No sessions match."}
          </p>
        ) : (
          shown.map((session) => (
            <button
              key={session.sessionId}
              type="button"
              disabled={loadingId !== null}
              onClick={() => void pick(session)}
              className="flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left hover:bg-foreground/5 disabled:opacity-60"
            >
              <span className="truncate text-[13px] text-foreground">
                {loadingId === session.sessionId ? "Loading…" : session.title}
              </span>
              <span className="flex gap-1.5 text-[11px] text-muted-foreground">
                <span>{formatRelative(session.lastModified)}</span>
                {session.gitBranch && (
                  <span className="truncate">· {session.gitBranch}</span>
                )}
              </span>
            </button>
          ))
        )}
      </div>
      {error && (
        <p
          role="alert"
          className="border-t border-border px-2.5 py-1.5 text-xs text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  )
}

type PendingPermission = {
  requestId: string
  name: string
  detail: string
  diff?: ClaudeChatDiff
  sessionRules?: string[]
}

function toPendingPermission({
  requestId,
  name,
  detail,
  diff,
  sessionRules,
}: PendingPermission): PendingPermission {
  return { requestId, name, detail, diff, sessionRules }
}

type DiffRow = { kind: "same" | "add" | "del"; text: string }

// Line diff of one edit. LCS for normal sizes; very large edits fall back to
// "all removed, then all added" so rendering stays fast.
function diffLines(before: string, after: string): DiffRow[] {
  const a = before ? before.split("\n") : []
  const b = after ? after.split("\n") : []
  if (a.length * b.length > 250_000)
    return [
      ...a.map((text) => ({ kind: "del" as const, text })),
      ...b.map((text) => ({ kind: "add" as const, text })),
    ]
  const lcs = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  )
  for (let i = a.length - 1; i >= 0; i -= 1)
    for (let j = b.length - 1; j >= 0; j -= 1)
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      rows.push({ kind: "same", text: a[i] })
      i += 1
      j += 1
    } else if (
      i < a.length &&
      (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])
    ) {
      // Removals before additions, as in a normal diff.
      rows.push({ kind: "del", text: a[i] })
      i += 1
    } else {
      rows.push({ kind: "add", text: b[j] })
      j += 1
    }
  }
  return rows
}

function diffStats(diff: ClaudeChatDiff) {
  let added = 0
  let removed = 0
  for (const edit of diff.edits)
    for (const row of diffLines(edit.before, edit.after)) {
      if (row.kind === "add") added += 1
      else if (row.kind === "del") removed += 1
    }
  return { added, removed }
}

function DiffCounts({ diff }: { diff: ClaudeChatDiff }) {
  const { added, removed } = diffStats(diff)
  return (
    <span className="shrink-0 font-mono text-[11px] tabular-nums">
      <span className="text-emerald-600 dark:text-emerald-400">+{added}</span>{" "}
      <span className="text-red-600 dark:text-red-400">−{removed}</span>
    </span>
  )
}

// A file change as removed/added lines, one block per edit.
function DiffView({
  diff,
  className,
}: {
  diff: ClaudeChatDiff
  className?: string
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded border border-border bg-background font-mono text-[11px] leading-5",
        className
      )}
    >
      <div className="truncate border-b border-border px-2.5 py-1 text-muted-foreground">
        {diff.path}
      </div>
      <div className="max-h-80 overflow-auto">
        {diff.edits.map((edit, index) => (
          <div
            key={index}
            className={cn(index > 0 && "border-t border-dashed border-border")}
          >
            {diffLines(edit.before, edit.after).map((row, rowIndex) => (
              <div
                key={rowIndex}
                className={cn(
                  "flex min-w-fit",
                  row.kind === "add" &&
                    "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
                  row.kind === "del" &&
                    "bg-red-500/10 text-red-800 dark:text-red-300"
                )}
              >
                <span
                  aria-hidden
                  className="w-5 shrink-0 text-center opacity-60 select-none"
                >
                  {row.kind === "add" ? "+" : row.kind === "del" ? "−" : ""}
                </span>
                <span className="pr-3 whitespace-pre">{row.text || " "}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

type ChatTool = {
  name: string
  detail: string
  summary?: string
  diff?: ClaudeChatDiff
}

// A tool call as one readable line that expands to the exact call.
function ToolLine({ tool, className }: { tool: ChatTool; className?: string }) {
  return (
    <details
      className={cn("group text-xs leading-6 text-muted-foreground", className)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1 hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 truncate">{tool.summary || tool.name}</span>
        {tool.diff && <DiffCounts diff={tool.diff} />}
        <ChevronRight className="size-3 shrink-0 transition-transform group-open:rotate-90" />
      </summary>
      {tool.diff ? (
        <DiffView diff={tool.diff} className="mt-0.5 mb-1.5" />
      ) : (
        <div className="mt-0.5 mb-1.5 rounded border border-border bg-background px-2.5 py-1.5 font-mono text-[11px] leading-5">
          <span className="font-semibold text-foreground">{tool.name}</span>
          {tool.detail && <span className="ml-2 break-all">{tool.detail}</span>}
        </div>
      )}
    </details>
  )
}

function MarkdownText({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  if (!text.trim()) return null
  return (
    <div className={cn("min-w-0 break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

// One Claude reply. Memoized so streaming into the latest reply doesn't
// re-render (and re-parse the Markdown of) every earlier one.
const ReplyMessage = memo(function ReplyMessage({
  message,
  activity,
}: {
  message: ChatMessage
  /** Live status line; only the reply being streamed gets one. */
  activity: ReactNode
}) {
  return (
    <div className="min-w-0 text-[13px] leading-6">
      {message.parts ? (
        // In the order Claude produced them: text, tool calls, more text.
        message.parts.map((part, index) => {
          const previous = message.parts?.[index - 1]
          // Space where the reply switches between text and tool calls.
          const gap = !!previous && previous.type !== part.type && "mt-2"
          return part.type === "tool" ? (
            <ToolLine key={index} tool={part} className={gap || undefined} />
          ) : (
            <MarkdownText
              key={index}
              text={part.text}
              className={gap || undefined}
            />
          )
        })
      ) : (
        // Replies saved before parts: all tool calls, then the text.
        <>
          {message.tools?.map((tool, index) => (
            <ToolLine key={index} tool={tool} />
          ))}
          {message.text && (
            <MarkdownText
              text={message.text}
              className={message.tools?.length ? "mt-2" : undefined}
            />
          )}
        </>
      )}
      {activity}
      {message.error && (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {message.error}
        </p>
      )}
      {(message.stopped || message.finishedAt) && (
        // Claude Code's end-of-turn line: "✻ Worked for 18s".
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1 text-[11px] text-muted-foreground">
          <span aria-hidden className="text-[#d97757]">
            ✻
          </span>
          <span>
            {message.stopped ? "Stopped" : "Worked"}
            {message.createdAt && message.finishedAt
              ? ` ${message.stopped ? "after" : "for"} ${formatElapsed(message.finishedAt - message.createdAt)}`
              : ""}
          </span>
          {!!message.outputTokens && (
            <span>· {formatTokens(message.outputTokens)}</span>
          )}
          {message.finishedAt && (
            <span>
              ·{" "}
              <time
                dateTime={new Date(message.finishedAt).toISOString()}
                title={formatFullTime(message.finishedAt)}
              >
                {formatTime(message.finishedAt)}
              </time>
            </span>
          )}
        </p>
      )}
    </div>
  )
})

export function ClaudeChatView({
  chatId,
  cwd,
  isActive,
  isVisible = true,
  onTitleChange,
  onAgentStatusChange,
}: {
  chatId: string
  cwd: string
  isActive: boolean
  /** False while the chat's tab or project is hidden. */
  isVisible?: boolean
  onTitleChange?: (title: string) => void
  onAgentStatusChange?: (status: TerminalAgentStatus) => void
}) {
  const [snapshot, setSnapshot] = useState(() => readSnapshot(chatId))
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [models, setModels] = useState(readCachedModels)
  const [modelsLoading, setModelsLoading] = useState(() => models.length === 0)
  const [modelsError, setModelsError] = useState(false)
  const [commands, setCommands] = useState(() => readCachedCommands(cwd))
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [command, setCommand] = useState<ClaudeChatCommand | null>(null)
  // "@" file mentions: caret position, the project's files, and the menu.
  const [caret, setCaret] = useState(0)
  const [files, setFiles] = useState<string[] | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionDismissed, setMentionDismissed] = useState(false)
  // Up-arrow recall: index into sent messages, or null when not recalling.
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  // Images pasted or dropped into the composer, sent with the next message.
  const [attachments, setAttachments] = useState<Attachment[]>([])
  // What's being dragged over the chat: OS files (images attach, other files
  // become references) or paths from GearShift's file tree and diffs.
  const [dropActive, setDropActive] = useState<false | "files" | "paths">(false)
  const addImages = async (files: File[]) => {
    const images = (await Promise.all(files.map(readImage))).filter(
      (image): image is Attachment => image !== null
    )
    if (images.length === 0) return
    setAttachments((current) =>
      [...current, ...images].slice(0, MAX_ATTACHMENTS)
    )
    inputRef.current?.focus()
  }
  const addImagesRef = useRef(addImages)
  addImagesRef.current = addImages
  // Claude Code's predicted next prompt, shown as the placeholder; Tab
  // accepts it. Cleared as soon as the user types or a turn starts.
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const savedDraftRef = useRef("")
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [status, setStatus] = useState<ChatStatus | null>(null)
  // Latest token count, read when the turn ends (the event listener is
  // registered once, so it can't read `status` directly).
  const outputTokensRef = useRef(0)
  // Current Claude session id, readable from the once-registered listener.
  const sessionIdRef = useRef(snapshot.sessionId)
  sessionIdRef.current = snapshot.sessionId ?? sessionIdRef.current
  const [stopping, setStopping] = useState(false)
  const [escArmed, setEscArmed] = useState(false)
  // Claude can wait on several prompts at once (parallel tool calls); each
  // gets its own card and is answered independently.
  const [questions, setQuestions] = useState<
    Array<{ requestId: string; questions: ClaudeChatQuestion[] }>
  >([])
  const [turnStartedAt, setTurnStartedAt] = useState(0)
  const [permissions, setPermissions] = useState<PendingPermission[]>([])
  const scrollerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(
    () => store.onReady(() => setSnapshot(readSnapshot(chatId))),
    [chatId]
  )
  // Save the transcript at most every 400ms: streaming changes it many times a
  // second, and serializing a long chat on each chunk competes with scrolling.
  // Pending changes are flushed when the chat closes or the window unloads.
  const pendingSaveRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    const save = () => {
      pendingSaveRef.current = null
      store.set(`gearshift.claudeChat.${chatId}`, JSON.stringify(snapshot))
    }
    pendingSaveRef.current = save
    const timer = setTimeout(save, 400)
    return () => clearTimeout(timer)
  }, [chatId, snapshot])
  useEffect(() => {
    const flush = () => pendingSaveRef.current?.()
    window.addEventListener("pagehide", flush)
    return () => {
      window.removeEventListener("pagehide", flush)
      // Closing the tab deletes the transcript first; don't write it back.
      if (store.get(`gearshift.claudeChat.${chatId}`) !== null) flush()
    }
  }, [chatId])
  // Becomes true a frame after reveal, once the chat has been laid out again.
  const visibleRef = useRef(isVisible)
  useEffect(() => {
    if (!isVisible) {
      visibleRef.current = false
      return
    }
    const frame = requestAnimationFrame(() => {
      visibleRef.current = true
    })
    return () => cancelAnimationFrame(frame)
  }, [isVisible])
  // Follow streamed output only while the user is at the bottom, so scrolling
  // up to read earlier messages isn't yanked back on every chunk.
  const followRef = useRef(true)
  const [following, setFollowing] = useState(true)
  const scrollToLatest = () => {
    followRef.current = true
    setFollowing(true)
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight })
  }
  const lastScrollTopRef = useRef(0)
  const handleScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    const previousTop = lastScrollTopRef.current
    lastScrollTopRef.current = el.scrollTop
    // Ignore scroll events while hidden or being revealed: layout is skipped
    // or stale then, and they'd wrongly turn following off.
    if (!visibleRef.current) return
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    // Only moving up stops following. Being short of the bottom isn't enough:
    // the scroll event from our own jump to the bottom can land after the
    // reply has grown again (fast replies do this), which would wrongly read
    // as the user having scrolled away.
    // Moving up never resumes following, even within the bottom zone: the
    // first few pixels of a scroll-up would otherwise turn it back on, and
    // the next streamed chunk would snap the view down again (stutter). The
    // one exception is the browser clamping scrollTop when content shrinks,
    // which leaves the view exactly at the bottom.
    const movedUp = el.scrollTop < previousTop
    const follow = movedUp
      ? followRef.current && fromBottom <= 1
      : followRef.current || fromBottom < 48
    followRef.current = follow
    setFollowing(follow)
  }
  // Stay pinned to the bottom whenever the transcript or the view changes
  // size — status lines, question cards, late markdown layout, or the input
  // growing — not just when messages change.
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollerRef.current
    const content = contentRef.current
    if (!el || !content) return
    const observer = new ResizeObserver(() => {
      if (followRef.current && visibleRef.current)
        el.scrollTo({ top: el.scrollHeight })
    })
    observer.observe(el)
    observer.observe(content)
    return () => observer.disconnect()
  }, [])
  // Hidden tabs skip layout (content-visibility), so scrolling while hidden is
  // a no-op. Scroll once visible — including on reveal, after the first frame
  // lays the chat out — so a chat you left at the bottom is still there.
  useEffect(() => {
    if (!followRef.current || !isVisible) return
    const el = scrollerRef.current
    el?.scrollTo({ top: el.scrollHeight })
    const frame = requestAnimationFrame(() => {
      if (followRef.current) el?.scrollTo({ top: el.scrollHeight })
    })
    return () => cancelAnimationFrame(frame)
  }, [snapshot.messages, permissions, questions, isVisible])
  useEffect(() => {
    if (isActive) inputRef.current?.focus()
  }, [isActive])

  // Type-to-focus and paste-to-focus: with nothing editable focused, typing
  // or pasting in the active chat goes to the input instead of being lost.
  useEffect(() => {
    if (!isActive) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.length !== 1 || event.defaultPrevented) return
      const active = document.activeElement
      if (isEditableTarget(active) || overlayOpen()) return
      // Space on a focused button or link should still activate it.
      if (event.key === " " && active?.closest("button, a, [role=button]"))
        return
      inputRef.current?.focus()
    }
    const onPaste = (event: ClipboardEvent) => {
      const textarea = inputRef.current
      if (!textarea || isEditableTarget(document.activeElement)) return
      if (overlayOpen()) return
      const images = imageFiles(event.clipboardData)
      if (images.length > 0) {
        event.preventDefault()
        void addImagesRef.current(images)
        return
      }
      const text = event.clipboardData?.getData("text") ?? ""
      if (!text) return
      event.preventDefault()
      textarea.focus()
      setDraft((current) => current + text)
      requestAnimationFrame(() => {
        const end = textarea.value.length
        textarea.setSelectionRange(end, end)
      })
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("paste", onPaste)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("paste", onPaste)
    }
  }, [isActive])
  // Show the cached model list at once, then refresh it in the background
  // and apply any changes.
  useEffect(() => {
    let disposed = false
    const apply = (available: ClaudeChatModel[]) => {
      setModels(available)
      setModelsLoading(false)
      setModelsError(false)
      setSnapshot((current) => {
        const selected = available.find(
          (model) => model.value === (current.model || "default")
        )
        if (!selected) return { ...current, model: "", effort: "" }
        if (
          current.effort &&
          !selected.supportedEffortLevels?.includes(current.effort)
        )
          return { ...current, effort: "" }
        return current
      })
    }
    const unsubscribe = store.onReady(() => {
      const cachedCommands = readCachedCommands(cwd)
      if (!disposed && cachedCommands.length > 0)
        setCommands((current) =>
          current.length > 0 ? current : cachedCommands
        )
      const cached = readCachedModels()
      if (!disposed && cached.length > 0)
        setModels((current) => (current.length > 0 ? current : cached))
      if (cached.length > 0) setModelsLoading(false)
    })
    loadCatalog(cwd)
      .then((catalog) => {
        if (disposed) return
        apply(catalog.models)
        setCommands(catalog.commands)
      })
      .catch(() => {
        if (disposed) return
        setModelsLoading(false)
        // Keep a cached list over an error; only fall back without one.
        if (readCachedModels().length === 0) setModelsError(true)
      })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [cwd])

  // A reload (Cmd+R) resets this view but not the turn running in the main
  // process, whose events keep arriving. Pick that turn back up: busy state,
  // timer, status, and any prompts still waiting for an answer.
  useEffect(() => {
    let disposed = false
    void window.claudeChat.liveState(chatId).then((live) => {
      if (disposed || !live) return
      setBusy(true)
      setTurnStartedAt(live.startedAt)
      outputTokensRef.current = live.outputTokens
      setStatus({ phase: live.phase, outputTokens: live.outputTokens })
      setPermissions(
        live.prompts.flatMap((prompt) =>
          prompt.type === "permission" ? [toPendingPermission(prompt)] : []
        )
      )
      setQuestions(
        live.prompts.flatMap((prompt) =>
          prompt.type === "question"
            ? [{ requestId: prompt.requestId, questions: prompt.questions }]
            : []
        )
      )
    })
    return () => {
      disposed = true
    }
  }, [chatId])

  // Report working / waiting-on-you / done so the sidebar and tab bar show
  // the same indicators as agent terminals.
  // When a reply finished while this chat wasn't in view; null once seen.
  const [unseenReply, setUnseenReply] = useState<number | null>(null)
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive
  const onAgentStatusChangeRef = useRef(onAgentStatusChange)
  onAgentStatusChangeRef.current = onAgentStatusChange
  useEffect(() => {
    if (isActive) setUnseenReply(null)
  }, [isActive])
  const waitingOnUser = busy && (permissions.length > 0 || questions.length > 0)
  const [lastSubmitAt, setLastSubmitAt] = useState<number>()
  useEffect(() => {
    onAgentStatusChangeRef.current?.({
      // No agentName: that marks a pane as an agent terminal to type into.
      // "running" only while a turn is live, so closing an idle chat doesn't
      // ask for confirmation.
      running: busy,
      working: busy && !waitingOnUser,
      needsAttention: waitingOnUser,
      completed: !busy && unseenReply !== null,
      ...(turnStartedAt ? { workStartedAt: turnStartedAt } : {}),
      ...(!busy && unseenReply !== null ? { completedAt: unseenReply } : {}),
      ...(lastSubmitAt ? { lastSubmitAt } : {}),
    })
  }, [busy, waitingOnUser, unseenReply, turnStartedAt, lastSubmitAt])

  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange
  // Follow the Claude session's title on open and after each turn. Claude
  // writes its generated title in the background, so check once more shortly
  // after the turn ends.
  useEffect(() => {
    const sessionId = snapshot.sessionId
    if (!sessionId || busy) return
    let disposed = false
    const refresh = () =>
      void window.claudeChat.title(sessionId, cwd).then((title) => {
        if (!disposed && title) onTitleChangeRef.current?.(title)
      })
    refresh()
    const timer = setTimeout(refresh, 4000)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [snapshot.sessionId, busy, cwd])

  // The live status line belongs to the reply being written.
  const lastMessageId = snapshot.messages[lastReplyIndex(snapshot.messages)]?.id
  // Group each user message with the replies that follow it.
  const sections: Array<{ user?: ChatMessage; replies: ChatMessage[] }> = []
  for (const message of snapshot.messages) {
    if (message.role === "user" || sections.length === 0)
      sections.push(
        message.role === "user"
          ? { user: message, replies: [] }
          : { replies: [message] }
      )
    else sections[sections.length - 1].replies.push(message)
  }

  const permissionMode = snapshot.permissionMode ?? DEFAULT_PERMISSION_MODE
  const currentMode =
    permissionModes.find((mode) => mode.value === permissionMode) ??
    permissionModes[0]

  const selectedModel = models.find(
    (model) => model.value === (snapshot.model || "default")
  )
  const availableEfforts = efforts.filter(
    (effort) =>
      !effort.value ||
      selectedModel?.supportedEffortLevels?.includes(
        effort.value as Exclude<ChatEffort, "">
      )
  )

  useEffect(() => {
    // Streamed text waiting for the next frame; flushed before any other
    // update to the reply so order is kept.
    let pendingText = ""
    let textFrame = 0
    const flushText = () => {
      if (textFrame) cancelAnimationFrame(textFrame)
      textFrame = 0
      if (!pendingText) return
      const text = pendingText
      pendingText = ""
      setSnapshot((current) => ({
        ...current,
        messages: current.messages.map((message, index) =>
          index === current.messages.length - 1 && message.role === "assistant"
            ? appendText(message, text)
            : message
        ),
      }))
    }
    const unsubscribe = window.claudeChat.onEvent((event) => {
      if (event.chatId !== chatId) return
      if (event.type === "permission") {
        const permission = toPendingPermission(event)
        setPermissions((current) =>
          current.some((item) => item.requestId === permission.requestId)
            ? current
            : [...current, permission]
        )
        return
      }
      if (event.type === "session") {
        sessionIdRef.current = event.sessionId
        setSnapshot((current) =>
          current.sessionId === event.sessionId
            ? current
            : { ...current, sessionId: event.sessionId }
        )
        return
      }
      if (event.type === "title") {
        onTitleChangeRef.current?.(event.title)
        return
      }
      if (event.type === "suggestion") {
        setSuggestion(event.text)
        return
      }
      if (event.type === "question") {
        const { requestId, questions } = event
        setQuestions((current) =>
          current.some((item) => item.requestId === requestId)
            ? current
            : [...current, { requestId, questions }]
        )
        return
      }
      if (event.type === "status") {
        outputTokensRef.current = event.outputTokens
        setStatus({ phase: event.phase, outputTokens: event.outputTokens })
        return
      }
      if (event.type === "finished") {
        flushText()
        // Finished while the user is elsewhere: flag it until they look.
        if (!isActiveRef.current) setUnseenReply(Date.now())
        setBusy(false)
        setStopping(false)
        setPermissions([])
        setQuestions([])
        setStatus(null)
        if (event.sessionId) sessionIdRef.current = event.sessionId
        setSnapshot((current) => {
          // The reply is the last Claude message; queued messages may follow.
          const replyIndex = lastReplyIndex(current.messages)
          return {
            ...current,
            sessionId: event.sessionId ?? current.sessionId,
            messages: current.messages.map((message, index) =>
              index === replyIndex
                ? {
                    ...message,
                    finishedAt: Date.now(),
                    outputTokens: outputTokensRef.current,
                    ...(event.stopped
                      ? { stopped: true }
                      : event.error
                        ? { error: event.error }
                        : {}),
                  }
                : message
            ),
          }
        })
        // Messages sent while the turn was ending go out as the next turn.
        const queued = queuedRef.current.splice(0)
        if (queued.length > 0)
          void startTurnRef.current(
            queued
              .map((item) => item.text)
              .filter(Boolean)
              .join("\n\n"),
            {
              withUserMessage: false,
              images: queued.flatMap((item) => item.images),
            }
          )
        return
      }
      if (event.type === "text") {
        // Text chunks can outpace the screen; apply them once per frame.
        pendingText += event.text
        if (!textFrame) textFrame = requestAnimationFrame(flushText)
        return
      }
      if (event.type !== "tool") return
      flushText()
      setSnapshot((current) => ({
        ...current,
        messages: current.messages.map((message, index) => {
          if (
            index !== current.messages.length - 1 ||
            message.role !== "assistant"
          )
            return message
          const tool = {
            name: event.name,
            detail: event.detail,
            summary: event.summary,
            ...(event.diff ? { diff: event.diff } : {}),
          }
          return message.parts
            ? {
                ...message,
                parts: [...message.parts, { type: "tool", ...tool }],
              }
            : { ...message, tools: [...(message.tools ?? []), tool] }
        }),
      }))
    })
    return () => {
      unsubscribe()
      flushText()
    }
  }, [chatId])

  // Start a turn. With `withUserMessage` false the user's message is already
  // in the transcript (it was queued while the previous turn ended).
  const startTurn = async (
    prompt: string,
    {
      withUserMessage = true,
      images = [],
    }: { withUserMessage?: boolean; images?: Attachment[] } = {}
  ) => {
    setSuggestion(null)
    followRef.current = true
    setFollowing(true)
    setBusy(true)
    setTurnStartedAt(Date.now())
    setLastSubmitAt(Date.now())
    outputTokensRef.current = 0
    setStatus({ phase: "thinking", outputTokens: 0 })
    setSnapshot((current) => ({
      ...current,
      messages: [
        ...current.messages.map((message) =>
          message.queued ? { ...message, queued: false } : message
        ),
        ...(withUserMessage
          ? [
              {
                id: crypto.randomUUID(),
                role: "user" as const,
                text: prompt,
                createdAt: Date.now(),
                ...(images.length
                  ? { images: images.map((image) => image.thumb) }
                  : {}),
              },
            ]
          : []),
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "",
          parts: [],
          createdAt: Date.now(),
        },
      ],
    }))
    try {
      const result = await window.claudeChat.send({
        chatId,
        cwd,
        prompt,
        sessionId: sessionIdRef.current,
        model: modelsError ? undefined : snapshot.model || undefined,
        effort: modelsError ? undefined : snapshot.effort || undefined,
        permissionMode,
        images: images.map(toClaudeImage),
      })
      if (!result.ok) throw new Error(result.error ?? "Could not start Claude.")
    } catch (error) {
      setBusy(false)
      setStatus(null)
      setSnapshot((current) => ({
        ...current,
        messages: current.messages.map((message, index) =>
          index === current.messages.length - 1
            ? {
                ...message,
                error:
                  error instanceof Error
                    ? error.message
                    : "Could not start Claude.",
              }
            : message
        ),
      }))
    }
  }
  const startTurnRef = useRef(startTurn)
  startTurnRef.current = startTurn

  // While Claude works, a sent message steers the running turn (like typing
  // mid-turn in the CLI). If the turn is already ending, it's queued and sent
  // as the next turn.
  const queuedRef = useRef<Array<{ text: string; images: Attachment[] }>>([])
  const steer = async (prompt: string, images: Attachment[]) => {
    setLastSubmitAt(Date.now())
    followRef.current = true
    setFollowing(true)
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: prompt,
      createdAt: Date.now(),
      ...(images.length ? { images: images.map((image) => image.thumb) } : {}),
    }
    const steered = await window.claudeChat.steer(
      chatId,
      prompt,
      images.map(toClaudeImage)
    )
    if (steered) {
      // Claude's reply continues below the steering message.
      setSnapshot((current) => ({
        ...current,
        messages: [
          ...current.messages,
          userMessage,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: "",
            parts: [],
            createdAt: Date.now(),
          },
        ],
      }))
      return
    }
    queuedRef.current.push({ text: prompt, images })
    setSnapshot((current) => ({
      ...current,
      messages: [...current.messages, { ...userMessage, queued: true }],
    }))
  }

  const send = async (event?: FormEvent) => {
    event?.preventDefault()
    const args = draft.trim()
    const prompt = command ? `/${command.name}${args ? ` ${args}` : ""}` : args
    const images = attachments
    if (!prompt && images.length === 0) return
    setDraft("")
    setCommand(null)
    setHistoryIndex(null)
    setAttachments([])
    if (busy) await steer(prompt, images)
    else await startTurn(prompt, { images })
  }

  // "/" menu: open while the first word of the draft is a partial command.
  // Prefix matches come first, then names or descriptions containing it.
  const slashQuery = /^\/(\S*)$/.exec(draft)?.[1]?.toLowerCase()
  const slashMatches =
    slashQuery === undefined
      ? []
      : [
          ...commands.filter((command) =>
            command.name.toLowerCase().startsWith(slashQuery)
          ),
          ...commands.filter(
            (command) =>
              !command.name.toLowerCase().startsWith(slashQuery) &&
              (command.name.toLowerCase().includes(slashQuery) ||
                command.description.toLowerCase().includes(slashQuery))
          ),
        ]
  const slashMenuOpen = !command && !slashDismissed && slashMatches.length > 0
  // A picked command becomes a chip before the input; the draft holds only
  // its arguments. It's sent as "/name args".
  const pickCommand = (picked: ClaudeChatCommand | undefined) => {
    if (!picked) return
    setCommand(picked)
    setDraft("")
    setSlashIndex(0)
    inputRef.current?.focus()
  }
  const mention = mentionAt(draft, caret)
  const mentionActive = mention !== null
  useEffect(() => {
    if (!mentionActive) return
    let disposed = false
    void loadProjectFiles(cwd).then((list) => {
      if (!disposed) setFiles(list)
    })
    return () => {
      disposed = true
    }
  }, [mentionActive, cwd])
  const fileFuse = useMemo(
    () =>
      new Fuse(
        (files ?? []).map((path) => ({
          path,
          name: path.split("/").pop() ?? path,
        })),
        {
          keys: [
            { name: "name", weight: 0.65 },
            { name: "path", weight: 0.35 },
          ],
          ignoreLocation: true,
          threshold: 0.4,
        }
      ),
    [files]
  )
  const mentionMatches = !mention
    ? []
    : mention.query
      ? fileFuse
          .search(mention.query, { limit: 30 })
          .map((hit) => hit.item.path)
      : (files ?? []).slice(0, 30)
  const mentionMenuOpen =
    !mentionDismissed && mention !== null && mentionMatches.length > 0
  const pickMention = (path: string | undefined) => {
    if (!path || !mention) return
    // "@path " replaces the partial; Claude Code expands it into the file.
    const inserted = `@${path} `
    const next = draft.slice(0, mention.start) + inserted + draft.slice(caret)
    const end = mention.start + inserted.length
    setDraft(next)
    setCaret(end)
    setMentionIndex(0)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(end, end)
    })
  }

  // Dropped paths go in at the caret as "@" references, spaced from the
  // surrounding text.
  const insertPaths = (paths: string[]) => {
    if (paths.length === 0) return
    const at = Math.min(caret, draft.length)
    const before = draft.slice(0, at)
    const after = draft.slice(at)
    const refs = paths.map((path) => pathReference(path, cwd)).join(" ")
    const inserted = `${before && !/\s$/.test(before) ? " " : ""}${refs}${
      after.startsWith(" ") ? "" : " "
    }`
    const end = at + inserted.length
    setDraft(before + inserted + after)
    setCaret(end)
    setSuggestion(null)
    setHistoryIndex(null)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(end, end)
    })
  }

  const changeDraft = (value: string) => {
    setMentionIndex(0)
    setMentionDismissed(false)
    if (value) setSuggestion(null)
    // Editing a recalled message makes it a new draft.
    setHistoryIndex(null)
    setSlashIndex(0)
    setSlashDismissed(false)
    // Typing a known command in full, then a space, turns it into a chip.
    const typed = !command && /^\/(\S+)\s([\s\S]*)$/.exec(value)
    const known =
      typed && commands.find((candidate) => candidate.name === typed[1])
    if (typed && known) {
      setCommand(known)
      setDraft(typed[2])
      return
    }
    setDraft(value)
  }

  // Continue a Claude Code session from this project's history: show its past
  // messages and resume it on the next message.
  const resumeSession = async (session: ClaudeChatSession) => {
    const history = await window.claudeChat.loadSession(session.sessionId, cwd)
    setSnapshot((current) => ({
      ...current,
      sessionId: session.sessionId,
      messages: history.map((message) => ({
        id: crypto.randomUUID(),
        ...message,
      })),
    }))
    onTitleChangeRef.current?.(session.title)
    followRef.current = true
    setFollowing(true)
    inputRef.current?.focus()
  }

  // Applies to the next message, and to the running turn when there is one.
  const changePermissionMode = (
    mode: ClaudeChatPermissionMode,
    { remember = true } = {}
  ) => {
    setSnapshot((current) => ({ ...current, permissionMode: mode }))
    if (remember && mode !== FULL_ACCESS)
      rememberSettings({ permissionMode: mode })
    if (busy) void window.claudeChat.setPermissionMode(chatId, mode)
  }

  // Reflect the stop right away; the main process confirms with "finished".
  const stop = () => {
    if (!busy || stopping) return
    setStopping(true)
    setEscArmed(false)
    setPermissions([])
    setQuestions([])
    void window.claudeChat.stop(chatId)
  }
  const stopRef = useRef(stop)
  stopRef.current = stop

  // Double Esc stops Claude, as in the Claude Code CLI (where a single Esc
  // interrupts). Two presses guard against an Esc meant for a menu or dialog.
  useEffect(() => {
    if (!isActive || !busy) return
    let armedAt = 0
    let disarm: ReturnType<typeof setTimeout> | undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      // Leave Esc to an open menu or dialog.
      if (overlayOpen()) return
      const now = Date.now()
      clearTimeout(disarm)
      if (now - armedAt < 1000) {
        armedAt = 0
        stopRef.current()
        return
      }
      armedAt = now
      setEscArmed(true)
      disarm = setTimeout(() => setEscArmed(false), 1000)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      clearTimeout(disarm)
      setEscArmed(false)
    }
  }, [isActive, busy])

  const answerQuestion = async (
    requestId: string,
    answers: Record<string, string> | null
  ) => {
    setQuestions((current) =>
      current.filter((item) => item.requestId !== requestId)
    )
    await window.claudeChat.answerQuestion(chatId, requestId, answers)
  }

  const answer = async (
    permission: PendingPermission,
    allow: boolean | "session"
  ) => {
    // Approving a plan leaves plan mode so Claude can carry it out.
    if (allow !== false && permission.name === "ExitPlanMode")
      changePermissionMode(DEFAULT_PERMISSION_MODE, { remember: false })
    setPermissions((current) =>
      current.filter((item) => item.requestId !== permission.requestId)
    )
    await window.claudeChat.answer(chatId, permission.requestId, allow)
  }

  return (
    // --chat-bg lets a host (the split-pane frame) set the chat's background;
    // the sticky message headers use it too so they stay opaque.
    <div
      // Files and paths can be dropped anywhere on the chat.
      onDragOver={(event) => {
        const paths = hasPathDragData(event.dataTransfer)
        if (!paths && !event.dataTransfer.types.includes("Files")) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "copy"
        setDropActive(paths ? "paths" : "files")
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setDropActive(false)
      }}
      onDrop={(event) => {
        const dragged = getPathDragData(event.dataTransfer)
        if (dragged.length === 0 && !event.dataTransfer.types.includes("Files"))
          return
        event.preventDefault()
        event.stopPropagation()
        setDropActive(false)
        // From the file tree or a diff: reference the paths.
        if (dragged.length > 0) {
          insertPaths(dragged)
          return
        }
        // From Finder: attach images, reference everything else.
        const images = imageFiles(event.dataTransfer)
        if (images.length > 0) void addImages(images)
        const others = Array.from(event.dataTransfer.files)
          .filter((file) => !images.includes(file))
          .map((file) => window.electronUtils.getPathForFile(file))
          .filter(Boolean)
        insertPaths(others)
      }}
      className="relative flex h-full min-h-0 flex-col bg-[var(--chat-bg,var(--card))]"
    >
      {dropActive && (
        <div className="pointer-events-none absolute inset-2 z-40 grid place-items-center rounded-lg border-2 border-dashed border-ring bg-background/80 text-[13px] text-muted-foreground">
          {dropActive === "paths"
            ? "Drop to add file references"
            : "Drop images to attach, or files to reference"}
        </div>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          onWheel={(event) => {
            // Scrolling up means reading back: stop following at once rather
            // than waiting to leave the bottom zone, or the next streamed
            // chunk snaps the view back down mid-gesture.
            // Only when the view can actually move up: with nothing to scroll
            // (or already at the top) it would just show the jump button.
            const el = event.currentTarget
            if (event.deltaY < 0 && followRef.current && el.scrollTop > 0) {
              followRef.current = false
              setFollowing(false)
            }
          }}
          className="min-h-0 flex-1 overflow-y-auto px-4"
        >
          {/* Vertical padding lives inside the scroller so sticky user
            messages pin flush to its top edge. */}
          <div
            ref={contentRef}
            className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-4"
          >
            {snapshot.messages.length === 0 && (
              <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                <Sparkles className="size-5" />
                <p className="text-[13px]">
                  Ask Claude to explore, explain, or change this project.
                </p>
                <p className="text-[11px] text-muted-foreground/70">
                  Enter to send · Shift+Enter for a new line · Shift+Tab to
                  switch mode · Esc Esc to stop
                </p>
                <SessionPicker cwd={cwd} onPick={resumeSession} />
              </div>
            )}
            {sections.map((section) => (
              // Each user message sticks to the top while its replies scroll
              // under it, until the next section pushes it off.
              <section
                key={section.user?.id ?? section.replies[0]?.id}
                className="flex min-w-0 flex-col gap-3"
              >
                {section.user && (
                  <div className="group/user sticky top-0 z-10 -mx-1 flex flex-col items-end bg-[var(--chat-bg,var(--card))] px-1 pt-2 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-3 after:bg-gradient-to-b after:from-[var(--chat-bg,var(--card))] after:to-transparent">
                    <div className="max-h-32 max-w-[85%] overflow-y-auto rounded-lg border border-border/60 bg-foreground/[0.06] px-3 py-1.5 text-[13px] leading-5 whitespace-pre-wrap">
                      {section.user.images?.length ? (
                        <span
                          className={cn(
                            "flex flex-wrap justify-end gap-1.5",
                            section.user.text && "mb-1.5"
                          )}
                        >
                          {section.user.images.map((src, index) => (
                            <img
                              key={index}
                              src={src}
                              alt={`Attached image ${index + 1}`}
                              className="size-16 rounded border border-border/60 object-cover"
                            />
                          ))}
                        </span>
                      ) : null}
                      <UserMessageText text={section.user.text} />
                    </div>
                    {/* Revealed on hover: when it was sent, and copy. */}
                    <div className="flex h-6 items-center gap-0.5">
                      {section.user.queued && (
                        <span className="mr-1 text-[11px] text-muted-foreground">
                          Queued · sends when Claude finishes
                        </span>
                      )}
                      {section.user.createdAt && (
                        <time
                          dateTime={new Date(
                            section.user.createdAt
                          ).toISOString()}
                          title={formatFullTime(section.user.createdAt)}
                          className="text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover/user:opacity-100"
                        >
                          {formatTime(section.user.createdAt)}
                        </time>
                      )}
                      <CopyButton
                        getText={() => section.user?.text}
                        label="Copy message"
                        className="group-hover/user:opacity-100"
                      />
                    </div>
                  </div>
                )}
                {section.replies.map((message) => (
                  <ReplyMessage
                    key={message.id}
                    message={message}
                    activity={
                      busy && status && message.id === lastMessageId ? (
                        <ActivityStatus
                          startedAt={turnStartedAt}
                          status={status}
                          stopping={stopping}
                        />
                      ) : null
                    }
                  />
                ))}
              </section>
            ))}
            {questions.map((question) => (
              <QuestionCard
                key={question.requestId}
                questions={question.questions}
                onSubmit={(answers) =>
                  void answerQuestion(question.requestId, answers)
                }
                onDismiss={() => void answerQuestion(question.requestId, null)}
              />
            ))}
            {permissions.map((permission) => (
              <div
                key={permission.requestId}
                className="rounded-lg border border-border bg-background p-3 text-[13px] leading-5"
              >
                {permission.name === "ExitPlanMode" ? (
                  <>
                    <p className="font-medium">Ready to carry out this plan?</p>
                    {permission.detail && (
                      <div className="mt-2 max-h-96 overflow-y-auto rounded border border-border bg-card px-3 py-2 leading-6 break-words">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={markdownComponents}
                        >
                          {permission.detail}
                        </ReactMarkdown>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <p className="font-medium">
                      Allow Claude to use {permission.name}?
                    </p>
                    {permission.diff ? (
                      <DiffView diff={permission.diff} className="mt-2" />
                    ) : (
                      permission.detail && (
                        <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground">
                          {permission.detail}
                        </p>
                      )
                    )}
                  </>
                )}
                <div className="mt-3 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => void answer(permission, true)}
                    className={primaryButtonClass}
                  >
                    {permission.name === "ExitPlanMode"
                      ? "Approve plan"
                      : "Allow"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void answer(permission, false)}
                    className={secondaryButtonClass}
                  >
                    Deny
                  </button>
                  {permission.sessionRules?.length ? (
                    <button
                      type="button"
                      onClick={() => void answer(permission, "session")}
                      title={`Won't ask again this session for: ${permission.sessionRules.join(", ")}`}
                      className={secondaryButtonClass}
                    >
                      Allow for this session
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
        {!following && snapshot.messages.length > 0 && (
          <button
            type="button"
            onClick={scrollToLatest}
            aria-label="Jump to latest message"
            className="absolute bottom-3 left-1/2 z-20 grid size-7 -translate-x-1/2 place-items-center rounded-full border border-border bg-background text-muted-foreground shadow-md hover:text-foreground"
          >
            <ArrowDown className="size-3.5" />
          </button>
        )}
      </div>
      <form onSubmit={(event) => void send(event)} className="px-3 pt-1 pb-3">
        <div
          className={cn(
            "relative mx-auto max-w-3xl rounded-lg border border-border bg-background focus-within:border-ring",
            dropActive && "border-ring bg-foreground/5"
          )}
        >
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-2 pt-2">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="group/thumb relative">
                  <img
                    src={attachment.thumb}
                    alt="Attached image"
                    className="size-12 rounded border border-border object-cover"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((current) =>
                        current.filter((item) => item.id !== attachment.id)
                      )
                    }
                    aria-label="Remove image"
                    className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full border border-border bg-background text-muted-foreground opacity-0 group-hover/thumb:opacity-100 hover:text-foreground focus-visible:opacity-100"
                  >
                    <X className="size-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {mentionMenuOpen && (
            <div
              id={`claude-files-${chatId}`}
              role="listbox"
              aria-label="Project files"
              className="absolute inset-x-0 bottom-full z-30 mb-1 max-h-64 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
            >
              {mentionMatches.map((path, index) => {
                const slash = path.lastIndexOf("/")
                return (
                  <button
                    key={path}
                    ref={(el) => {
                      if (index === mentionIndex)
                        el?.scrollIntoView({ block: "nearest" })
                    }}
                    type="button"
                    role="option"
                    aria-selected={index === mentionIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setMentionIndex(index)}
                    onClick={() => pickMention(path)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-[13px]",
                      index === mentionIndex &&
                        "bg-accent text-accent-foreground"
                    )}
                  >
                    <FileIcon
                      name={path.slice(slash + 1)}
                      className="size-3.5 shrink-0"
                    />
                    <span className="shrink-0">{path.slice(slash + 1)}</span>
                    {slash > 0 && (
                      <span className="min-w-0 truncate text-xs text-muted-foreground">
                        {path.slice(0, slash)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
          {slashMenuOpen && (
            <div
              id={`claude-commands-${chatId}`}
              role="listbox"
              aria-label="Commands and skills"
              className="absolute inset-x-0 bottom-full z-30 mb-1 max-h-64 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
            >
              {slashMatches.map((command, index) => (
                <button
                  key={command.name}
                  ref={(el) => {
                    if (index === slashIndex)
                      el?.scrollIntoView({ block: "nearest" })
                  }}
                  type="button"
                  role="option"
                  aria-selected={index === slashIndex}
                  // Keep focus in the input while picking with the mouse.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setSlashIndex(index)}
                  onClick={() => pickCommand(command)}
                  className={cn(
                    "flex w-full items-baseline gap-2 rounded-sm px-2 py-1 text-left text-[13px]",
                    index === slashIndex && "bg-accent text-accent-foreground"
                  )}
                >
                  <span className="shrink-0 font-medium">/{command.name}</span>
                  {command.argumentHint && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {command.argumentHint}
                    </span>
                  )}
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {command.description}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-start">
            {command && (
              <span
                title={command.description}
                className="mt-2 ml-2 shrink-0 rounded bg-foreground/10 px-1.5 text-[13px] leading-6 font-semibold"
              >
                /{command.name}
              </span>
            )}
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => {
                setCaret(event.target.selectionStart)
                changeDraft(event.target.value)
              }}
              onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
              onPaste={(event) => {
                // Pasted images attach to the message; text pastes as usual.
                const images = imageFiles(event.clipboardData)
                if (images.length === 0) return
                event.preventDefault()
                void addImages(images)
              }}
              role="combobox"
              aria-expanded={slashMenuOpen}
              aria-controls={
                slashMenuOpen ? `claude-commands-${chatId}` : undefined
              }
              onKeyDown={(event) => {
                const el = event.currentTarget
                // Tab or → takes Claude Code's suggested next prompt, as in the CLI.
                if (
                  (event.key === "Tab" || event.key === "ArrowRight") &&
                  !event.shiftKey &&
                  !event.metaKey &&
                  !event.altKey &&
                  suggestion &&
                  !draft &&
                  !command &&
                  !slashMenuOpen
                ) {
                  event.preventDefault()
                  setDraft(suggestion)
                  setSuggestion(null)
                  return
                }
                // Up/Down step through this chat's sent messages, like the
                // Claude Code CLI, when the caret is on the first/last line.
                if (
                  (event.key === "ArrowUp" || event.key === "ArrowDown") &&
                  !slashMenuOpen &&
                  !mentionMenuOpen &&
                  !command &&
                  !event.shiftKey &&
                  !event.altKey &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  el.selectionStart === el.selectionEnd
                ) {
                  const before = el.value.slice(0, el.selectionStart)
                  const after = el.value.slice(el.selectionEnd)
                  const up = event.key === "ArrowUp"
                  if (up ? !before.includes("\n") : !after.includes("\n")) {
                    const sent = snapshot.messages
                      .filter((message) => message.role === "user")
                      .map((message) => message.text)
                    const current = historyIndex ?? sent.length
                    const next = up ? current - 1 : current + 1
                    if (up ? next >= 0 : historyIndex !== null) {
                      event.preventDefault()
                      if (historyIndex === null) savedDraftRef.current = draft
                      const value =
                        next >= sent.length ? savedDraftRef.current : sent[next]
                      setHistoryIndex(next >= sent.length ? null : next)
                      setDraft(value)
                      requestAnimationFrame(() =>
                        el.setSelectionRange(value.length, value.length)
                      )
                      return
                    }
                  }
                }
                // Backspace at the very start turns the chip back into text.
                if (
                  command &&
                  event.key === "Backspace" &&
                  el.selectionStart === 0 &&
                  el.selectionEnd === 0
                ) {
                  event.preventDefault()
                  setCommand(null)
                  setDraft(`/${command.name}${draft ? ` ${draft}` : ""}`)
                  requestAnimationFrame(() => {
                    const end = command.name.length + 1
                    el.setSelectionRange(end, end)
                  })
                  return
                }
                if (mentionMenuOpen) {
                  const count = mentionMatches.length
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault()
                    const step = event.key === "ArrowDown" ? 1 : -1
                    setMentionIndex((index) => (index + step + count) % count)
                    return
                  }
                  if (
                    (event.key === "Enter" && !event.shiftKey) ||
                    (event.key === "Tab" && !event.shiftKey)
                  ) {
                    event.preventDefault()
                    pickMention(
                      mentionMatches[mentionIndex] ?? mentionMatches[0]
                    )
                    return
                  }
                  if (event.key === "Escape") {
                    event.preventDefault()
                    setMentionDismissed(true)
                    return
                  }
                }
                if (slashMenuOpen) {
                  const count = slashMatches.length
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault()
                    const step = event.key === "ArrowDown" ? 1 : -1
                    setSlashIndex((index) => (index + step + count) % count)
                    return
                  }
                  if (
                    (event.key === "Enter" && !event.shiftKey) ||
                    (event.key === "Tab" && !event.shiftKey)
                  ) {
                    event.preventDefault()
                    pickCommand(slashMatches[slashIndex] ?? slashMatches[0])
                    return
                  }
                  if (event.key === "Escape") {
                    // Also keeps this Esc from counting toward Esc Esc stop.
                    event.preventDefault()
                    setSlashDismissed(true)
                    return
                  }
                }
                // Shift+Tab cycles permission modes, like the Claude Code CLI.
                if (event.key === "Tab" && event.shiftKey) {
                  event.preventDefault()
                  const index = cyclePermissionModes.indexOf(currentMode)
                  changePermissionMode(
                    cyclePermissionModes[
                      (index + 1) % cyclePermissionModes.length
                    ].value
                  )
                  return
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
              }}
              placeholder={
                command
                  ? command.argumentHint || "Add details (optional)"
                  : suggestion && !busy
                    ? `${suggestion}  ·  Tab or → to use`
                    : "Ask Claude about this project, or type / for commands…"
              }
              aria-label="Message Claude"
              rows={1}
              className={cn(
                "block [field-sizing:content] max-h-48 min-h-9 w-full min-w-0 flex-1 resize-none bg-transparent pt-2.5 pb-1 text-[13px] leading-5 outline-none placeholder:text-muted-foreground",
                command ? "pr-3 pl-1.5" : "px-3"
              )}
            />
          </div>
          <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
            <DropdownMenu open={modeMenuOpen} onOpenChange={setModeMenuOpen}>
              <DropdownMenuTrigger
                aria-label="Permission mode"
                title={
                  permissionMode === FULL_ACCESS
                    ? "Full access: commands and edits run without prompts"
                    : "Permission mode (Shift+Tab to cycle)"
                }
                className={cn(
                  chipClass,
                  permissionMode === FULL_ACCESS &&
                    "text-destructive hover:text-destructive"
                )}
              >
                {currentMode.label}
                <ChevronDown className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                className="w-72"
                onKeyDown={(event) => {
                  const mode = permissionModes[Number(event.key) - 1]
                  if (!mode) return
                  event.preventDefault()
                  changePermissionMode(mode.value)
                  setModeMenuOpen(false)
                }}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Mode</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={permissionMode}
                    onValueChange={(value) =>
                      changePermissionMode(value as ClaudeChatPermissionMode)
                    }
                  >
                    {permissionModes.map((mode, index) => (
                      <DropdownMenuRadioItem
                        key={mode.value}
                        value={mode.value}
                        closeOnClick
                        className="items-start py-1.5 pr-12 [&>[data-slot=dropdown-menu-radio-item-indicator]]:top-2 [&>[data-slot=dropdown-menu-radio-item-indicator]]:right-7"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span
                            className={cn(
                              "flex items-center gap-1.5",
                              mode.value === FULL_ACCESS && "text-destructive"
                            )}
                          >
                            {mode.label}
                            {mode.value === DEFAULT_PERMISSION_MODE && (
                              <span className="rounded bg-foreground/10 px-1.5 text-[10px] leading-4 text-muted-foreground">
                                Default
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {mode.description}
                          </span>
                        </span>
                        <span className="absolute top-1.5 right-2 text-xs text-muted-foreground">
                          {index + 1}
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Claude model"
                disabled={modelsLoading || modelsError}
                title={
                  modelsError
                    ? "Models unavailable; using Claude defaults."
                    : selectedModel?.description
                }
                className={chipClass}
              >
                {selectedModel
                  ? modelVersion(selectedModel).short
                  : modelsLoading
                    ? "Loading models…"
                    : "Default model"}
                <ChevronDown className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" className="w-80">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Model</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={snapshot.model || "default"}
                    onValueChange={(value: string) => {
                      const model = models.find(
                        (choice) => choice.value === value
                      )
                      const settings = {
                        model: value === "default" ? "" : value,
                        effort:
                          snapshot.effort &&
                          !model?.supportedEffortLevels?.includes(
                            snapshot.effort
                          )
                            ? ("" as const)
                            : snapshot.effort,
                      }
                      setSnapshot((current) => ({ ...current, ...settings }))
                      rememberSettings(settings)
                    }}
                  >
                    {models.map((model) => {
                      const version = modelVersion(model)
                      const isDefault = model.value === "default"
                      return (
                        <DropdownMenuRadioItem
                          key={model.value}
                          value={model.value}
                          closeOnClick
                          className="items-start py-1.5 [&>[data-slot=dropdown-menu-radio-item-indicator]]:top-2"
                        >
                          <span className="flex min-w-0 flex-col">
                            <span className="flex items-center gap-1.5">
                              {isDefault ? "Default" : version.name}
                              {isDefault && (
                                <span className="rounded bg-foreground/10 px-1.5 text-[10px] leading-4 text-muted-foreground">
                                  Recommended
                                </span>
                              )}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {isDefault
                                ? model.description || model.displayName
                                : version.tagline}
                            </span>
                          </span>
                        </DropdownMenuRadioItem>
                      )
                    })}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Claude effort level"
                disabled={modelsLoading || modelsError}
                title="Effort level"
                className={chipClass}
              >
                <Gauge className="size-3" />
                {snapshot.effort && !modelsError
                  ? (efforts
                      .find((effort) => effort.value === snapshot.effort)
                      ?.label.replace(/ effort$/, "") ?? "Default")
                  : "Default"}
                <ChevronDown className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" className="w-44">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Effort</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={snapshot.effort ?? ""}
                    onValueChange={(value: string) => {
                      const effort = value as ChatEffort
                      setSnapshot((current) => ({ ...current, effort }))
                      rememberSettings({ effort })
                    }}
                  >
                    {availableEfforts.map((effort) => (
                      <DropdownMenuRadioItem
                        key={effort.value}
                        value={effort.value}
                        closeOnClick
                      >
                        {effort.label.replace(/ effort$/, "")}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="ml-auto flex items-center gap-2">
              {escArmed && (
                <span className="text-[11px] text-muted-foreground">
                  Press Esc again to stop
                </span>
              )}
              {busy && !draft.trim() && !command && attachments.length === 0 ? (
                <button
                  type="button"
                  onClick={stop}
                  disabled={stopping}
                  aria-label={stopping ? "Stopping Claude" : "Stop Claude"}
                  title="Stop (Esc Esc)"
                  className="grid size-6 place-items-center rounded bg-foreground text-background disabled:opacity-50"
                >
                  <Square
                    className={cn(
                      "size-2.5 fill-current",
                      stopping && "animate-pulse"
                    )}
                  />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={
                    !draft.trim() && !command && attachments.length === 0
                  }
                  aria-label="Send message"
                  title={
                    busy
                      ? "Send to Claude while it works (Enter)"
                      : "Send (Enter)"
                  }
                  className="grid size-6 place-items-center rounded bg-foreground text-background disabled:opacity-30"
                >
                  <ArrowUp className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
