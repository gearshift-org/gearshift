import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
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
  Square,
  Sparkles,
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
import { store } from "@/lib/store"
import { cn } from "@/lib/utils"
import type {
  ClaudeChatModel,
  ClaudeChatPermissionMode,
  ClaudeChatPhase,
  ClaudeChatQuestion,
} from "../../../electron/claudeChat"
import type { TerminalAgentStatus } from "./types"

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  tools?: Array<{ name: string; detail: string; summary?: string }>
  error?: string
  /** The user stopped this reply. */
  stopped?: boolean
  /** When the message was sent (user) or the reply started (assistant). */
  createdAt?: number
  /** When Claude finished this reply. */
  finishedAt?: number
  /** Output tokens Claude produced for this reply. */
  outputTokens?: number
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
]

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
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
    >
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
      {children}
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

// Claude Code's model descriptions lead with the exact version, e.g.
// "Opus 5.5 with 1M context · Best for everyday, complex tasks", while the
// display name is only "Opus". Split it so the menu can show the version.
function modelVersion(model: ClaudeChatModel) {
  const [name, ...rest] = (model.description ?? "").split(" · ")
  const version = name?.trim() || model.displayName
  return {
    name: version,
    short: version.replace(/ with 1M context$/, " · 1M"),
    tagline: rest.join(" · "),
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

// One model lookup shared by every chat tab, reused for ten minutes. Each
// lookup starts a short-lived Claude Code process, so tabs mounting at once
// (e.g. after a reload) share it instead of each starting their own.
let modelsRequest: Promise<ClaudeChatModel[]> | null = null
let modelsRequestedAt = 0

function loadModels(cwd: string): Promise<ClaudeChatModel[]> {
  if (modelsRequest && Date.now() - modelsRequestedAt < MODELS_REFRESH_MS)
    return modelsRequest
  modelsRequestedAt = Date.now()
  const request = window.claudeChat.models(cwd).then((models) => {
    store.set(MODELS_CACHE_KEY, JSON.stringify(models))
    return models
  })
  request.catch(() => {
    if (modelsRequest === request) modelsRequest = null
  })
  modelsRequest = request
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

export function ClaudeChatView({
  chatId,
  cwd,
  isActive,
  onTitleChange,
  onAgentStatusChange,
}: {
  chatId: string
  cwd: string
  isActive: boolean
  onTitleChange?: (title: string) => void
  onAgentStatusChange?: (status: TerminalAgentStatus) => void
}) {
  const [snapshot, setSnapshot] = useState(() => readSnapshot(chatId))
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [models, setModels] = useState(readCachedModels)
  const [modelsLoading, setModelsLoading] = useState(() => models.length === 0)
  const [modelsError, setModelsError] = useState(false)
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [status, setStatus] = useState<ChatStatus | null>(null)
  // Latest token count, read when the turn ends (the event listener is
  // registered once, so it can't read `status` directly).
  const outputTokensRef = useRef(0)
  const [stopping, setStopping] = useState(false)
  const [escArmed, setEscArmed] = useState(false)
  const [question, setQuestion] = useState<{
    requestId: string
    questions: ClaudeChatQuestion[]
  } | null>(null)
  const [turnStartedAt, setTurnStartedAt] = useState(0)
  const [permission, setPermission] = useState<{
    requestId: string
    name: string
    detail: string
  } | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(
    () => store.onReady(() => setSnapshot(readSnapshot(chatId))),
    [chatId]
  )
  useEffect(() => {
    store.set(`gearshift.claudeChat.${chatId}`, JSON.stringify(snapshot))
  }, [chatId, snapshot])
  // Follow streamed output only while the user is at the bottom, so scrolling
  // up to read earlier messages isn't yanked back on every chunk.
  const followRef = useRef(true)
  const [following, setFollowing] = useState(true)
  const scrollToLatest = () => {
    followRef.current = true
    setFollowing(true)
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight })
  }
  const handleScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    followRef.current = atBottom
    setFollowing(atBottom)
  }
  useEffect(() => {
    if (!followRef.current) return
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight })
  }, [snapshot.messages, permission])
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
      const cached = readCachedModels()
      if (!disposed && cached.length > 0)
        setModels((current) => (current.length > 0 ? current : cached))
      if (cached.length > 0) setModelsLoading(false)
    })
    loadModels(cwd)
      .then((available) => {
        if (!disposed) apply(available)
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

  // Report working / waiting-on-you / done so the sidebar and tab bar show
  // the same indicators as agent terminals.
  const [unseenReply, setUnseenReply] = useState(false)
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive
  const onAgentStatusChangeRef = useRef(onAgentStatusChange)
  onAgentStatusChangeRef.current = onAgentStatusChange
  useEffect(() => {
    if (isActive) setUnseenReply(false)
  }, [isActive])
  const waitingOnUser = busy && (!!permission || !!question)
  useEffect(() => {
    onAgentStatusChangeRef.current?.({
      running: true,
      agentName: "claude",
      working: busy && !waitingOnUser,
      needsAttention: waitingOnUser,
      completed: !busy && unseenReply,
      ...(busy && turnStartedAt ? { workStartedAt: turnStartedAt } : {}),
    })
  }, [busy, waitingOnUser, unseenReply, turnStartedAt])

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

  useEffect(
    () =>
      window.claudeChat.onEvent((event) => {
        if (event.chatId !== chatId) return
        if (event.type === "permission") {
          setPermission(event)
          return
        }
        if (event.type === "question") {
          setQuestion({
            requestId: event.requestId,
            questions: event.questions,
          })
          return
        }
        if (event.type === "status") {
          outputTokensRef.current = event.outputTokens
          setStatus({ phase: event.phase, outputTokens: event.outputTokens })
          return
        }
        if (event.type === "finished") {
          // Finished while the user is elsewhere: flag it until they look.
          if (!isActiveRef.current) setUnseenReply(true)
          setBusy(false)
          setStopping(false)
          setPermission(null)
          setQuestion(null)
          setStatus(null)
          setSnapshot((current) => ({
            ...current,
            sessionId: event.sessionId ?? current.sessionId,
            messages: current.messages.map((message, index) =>
              index === current.messages.length - 1 &&
              message.role === "assistant"
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
          }))
          return
        }
        setSnapshot((current) => ({
          ...current,
          messages: current.messages.map((message, index) => {
            if (
              index !== current.messages.length - 1 ||
              message.role !== "assistant"
            )
              return message
            if (event.type === "text")
              return { ...message, text: message.text + event.text }
            return {
              ...message,
              tools: [
                ...(message.tools ?? []),
                {
                  name: event.name,
                  detail: event.detail,
                  summary: event.summary,
                },
              ],
            }
          }),
        }))
      }),
    [chatId]
  )

  const send = async (event?: FormEvent) => {
    event?.preventDefault()
    const prompt = draft.trim()
    if (!prompt || busy) return
    setDraft("")
    followRef.current = true
    setFollowing(true)
    setBusy(true)
    setTurnStartedAt(Date.now())
    outputTokensRef.current = 0
    setStatus({ phase: "thinking", outputTokens: 0 })
    setSnapshot((current) => ({
      ...current,
      messages: [
        ...current.messages,
        {
          id: crypto.randomUUID(),
          role: "user",
          text: prompt,
          createdAt: Date.now(),
        },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "",
          createdAt: Date.now(),
        },
      ],
    }))
    try {
      const result = await window.claudeChat.send({
        chatId,
        cwd,
        prompt,
        sessionId: snapshot.sessionId,
        model: modelsError ? undefined : snapshot.model || undefined,
        effort: modelsError ? undefined : snapshot.effort || undefined,
        permissionMode,
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

  // Applies to the next message, and to the running turn when there is one.
  const changePermissionMode = (
    mode: ClaudeChatPermissionMode,
    { remember = true } = {}
  ) => {
    setSnapshot((current) => ({ ...current, permissionMode: mode }))
    if (remember) rememberSettings({ permissionMode: mode })
    if (busy) void window.claudeChat.setPermissionMode(chatId, mode)
  }

  // Reflect the stop right away; the main process confirms with "finished".
  const stop = () => {
    if (!busy || stopping) return
    setStopping(true)
    setEscArmed(false)
    setPermission(null)
    setQuestion(null)
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

  const answerQuestion = async (answers: Record<string, string> | null) => {
    if (!question) return
    await window.claudeChat.answerQuestion(chatId, question.requestId, answers)
    setQuestion(null)
  }

  const answer = async (allow: boolean) => {
    if (!permission) return
    // Approving a plan leaves plan mode so Claude can carry it out.
    if (allow && permission.name === "ExitPlanMode")
      changePermissionMode(DEFAULT_PERMISSION_MODE, { remember: false })
    await window.claudeChat.answer(chatId, permission.requestId, allow)
    setPermission(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto px-4"
        >
          {/* Vertical padding lives inside the scroller so sticky user
            messages pin flush to its top edge. */}
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-4">
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
                  <div className="group/user sticky top-0 z-10 -mx-1 flex flex-col items-end bg-card px-1 pt-2 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-3 after:bg-gradient-to-b after:from-card after:to-transparent">
                    <div className="max-h-32 max-w-[85%] overflow-y-auto rounded-lg border border-border/60 bg-foreground/[0.06] px-3 py-1.5 text-[13px] leading-5 whitespace-pre-wrap">
                      {section.user.text}
                    </div>
                    {/* Revealed on hover: when it was sent, and copy. */}
                    <div className="flex h-6 items-center gap-0.5">
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
                  <div
                    key={message.id}
                    className="min-w-0 text-[13px] leading-6"
                  >
                    {message.tools?.map((tool, index) => (
                      <details
                        key={`${message.id}-${index}`}
                        className="group text-xs leading-6 text-muted-foreground"
                      >
                        <summary className="flex cursor-pointer list-none items-center gap-1 hover:text-foreground [&::-webkit-details-marker]:hidden">
                          <span className="min-w-0 truncate">
                            {tool.summary || tool.name}
                          </span>
                          <ChevronRight className="size-3 shrink-0 transition-transform group-open:rotate-90" />
                        </summary>
                        <div className="mt-0.5 mb-1.5 rounded border border-border bg-background px-2.5 py-1.5 font-mono text-[11px] leading-5">
                          <span className="font-semibold text-foreground">
                            {tool.name}
                          </span>
                          {tool.detail && (
                            <span className="ml-2 break-all">
                              {tool.detail}
                            </span>
                          )}
                        </div>
                      </details>
                    ))}
                    {message.text && (
                      <div
                        className={cn(
                          "min-w-0 break-words",
                          message.tools?.length && "mt-2"
                        )}
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={markdownComponents}
                        >
                          {message.text}
                        </ReactMarkdown>
                      </div>
                    )}
                    {busy &&
                      status &&
                      message.id === snapshot.messages.at(-1)?.id && (
                        <ActivityStatus
                          startedAt={turnStartedAt}
                          status={status}
                          stopping={stopping}
                        />
                      )}
                    {message.error && (
                      <p
                        role="alert"
                        className="mt-1.5 text-xs text-destructive"
                      >
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
                              dateTime={new Date(
                                message.finishedAt
                              ).toISOString()}
                              title={formatFullTime(message.finishedAt)}
                            >
                              {formatTime(message.finishedAt)}
                            </time>
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                ))}
              </section>
            ))}
            {question && (
              <QuestionCard
                key={question.requestId}
                questions={question.questions}
                onSubmit={(answers) => void answerQuestion(answers)}
                onDismiss={() => void answerQuestion(null)}
              />
            )}
            {permission && (
              <div className="rounded-lg border border-border bg-background p-3 text-[13px] leading-5">
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
                    {permission.detail && (
                      <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground">
                        {permission.detail}
                      </p>
                    )}
                  </>
                )}
                <div className="mt-3 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => void answer(true)}
                    className={primaryButtonClass}
                  >
                    {permission.name === "ExitPlanMode"
                      ? "Approve plan"
                      : "Allow"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void answer(false)}
                    className={secondaryButtonClass}
                  >
                    Deny
                  </button>
                </div>
              </div>
            )}
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
        <div className="mx-auto max-w-3xl rounded-lg border border-border bg-background focus-within:border-ring">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Shift+Tab cycles permission modes, like the Claude Code CLI.
              if (event.key === "Tab" && event.shiftKey) {
                event.preventDefault()
                const index = permissionModes.indexOf(currentMode)
                changePermissionMode(
                  permissionModes[(index + 1) % permissionModes.length].value
                )
                return
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            placeholder="Ask Claude about this project…"
            aria-label="Message Claude"
            rows={1}
            className="block [field-sizing:content] max-h-48 min-h-9 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-[13px] leading-5 outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
            <DropdownMenu open={modeMenuOpen} onOpenChange={setModeMenuOpen}>
              <DropdownMenuTrigger
                aria-label="Permission mode"
                title="Permission mode (Shift+Tab to cycle)"
                className={chipClass}
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
                          <span className="flex items-center gap-1.5">
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
              {busy ? (
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
                  disabled={!draft.trim()}
                  aria-label="Send message"
                  title="Send (Enter)"
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
