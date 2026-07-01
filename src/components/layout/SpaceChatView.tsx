import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Message, MessageContent, MessageFooter } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import {
  createSession,
  deleteSessionData,
  deriveSessionTitle,
  initSpaceSessions,
  loadSessionMessages,
  saveSessionMessages,
  saveSessions,
  setActiveSessionId as persistActiveSessionId,
  type SpaceChatMessage,
  type SpaceChatProject,
  type SpaceChatSession,
  type SpaceChatSettings,
} from "@/lib/spaceChat"
import { store } from "@/lib/store"
import { cn } from "@/lib/utils"

type Props = {
  space: { id: string; name: string }
  projects: SpaceChatProject[]
  headerLeading?: React.ReactNode
}

const REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"]
const chatScrollPositions = new Map<string, number>()

function scrollPositionKey(spaceId: string, sessionId: string): string {
  return `${spaceId}:${sessionId}`
}

function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value
}

const DEFAULT_SETTINGS: SpaceChatSettings = {
  authenticated: false,
  codexAvailable: false,
  model: "gpt-5.5",
  reasoningEffort: "low",
}

type SpaceChatModels = Awaited<ReturnType<typeof window.spaceChat.models>>

let cachedSpaceChatSettings: SpaceChatSettings | null = null
let pendingSpaceChatSettings: Promise<SpaceChatSettings> | null = null
let cachedSpaceChatModels: SpaceChatModels | null = null
let pendingSpaceChatModels: Promise<SpaceChatModels> | null = null

function loadSpaceChatSettings(): Promise<SpaceChatSettings> {
  if (cachedSpaceChatSettings) return Promise.resolve(cachedSpaceChatSettings)
  if (!pendingSpaceChatSettings) {
    pendingSpaceChatSettings = window.spaceChat.settings().then((settings) => {
      cachedSpaceChatSettings = settings
      return settings
    })
  }
  return pendingSpaceChatSettings
}

function loadSpaceChatModels(): Promise<SpaceChatModels> {
  if (cachedSpaceChatModels) return Promise.resolve(cachedSpaceChatModels)
  if (!pendingSpaceChatModels) {
    pendingSpaceChatModels = window.spaceChat.models().then((models) => {
      cachedSpaceChatModels = models
      return models
    })
  }
  return pendingSpaceChatModels
}

function messageTime(createdAt: number): string {
  return new Date(createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })
}

function markdownSource(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:markdown|md)\s*\r?\n([\s\S]*?)\r?\n```$/i)
  return match ? match[1].trim() : text
}

async function copyText(text: string): Promise<boolean> {
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

// Right-click on a message: offer Copy of the raw markdown via the app's native
// context menu.
async function handleMessageContextMenu(
  event: React.MouseEvent,
  fallback: string
): Promise<void> {
  event.preventDefault()
  const text = markdownSource(fallback)
  if (!text) return
  if (!window.menuApi) {
    await copyText(text)
    return
  }
  const action = await window.menuApi.showEditContext({
    canCut: false,
    canCopy: true,
    canPaste: false,
  })
  if (action === "copy") await copyText(text)
}

function handleMessageCopy(
  event: React.ClipboardEvent<HTMLElement>,
  fallback: string
): void {
  const selection = window.getSelection?.()
  if (!selection || selection.isCollapsed) return
  const anchor = selection.anchorNode
  const focus = selection.focusNode
  if (
    (anchor && !event.currentTarget.contains(anchor)) ||
    (focus && !event.currentTarget.contains(focus))
  ) {
    return
  }

  const text = markdownSource(fallback)
  if (!text) return
  event.preventDefault()
  event.clipboardData.setData("text/plain", text)
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false)
  const source = markdownSource(text)
  return (
    <button
      type="button"
      aria-label="Copy message"
      onClick={async () => {
        if (await copyText(source)) {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        }
      }}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground/70 transition-colors hover:text-foreground"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  )
}

// True when the user is already typing/pasting into some editable field, so we
// shouldn't hijack the keystroke/paste to the chat composer.
function isEditableTarget(el: Element | null): boolean {
  if (!el) return false
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    (el as HTMLElement).isContentEditable
  )
}

function createUserMessage(content: string): SpaceChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content,
    createdAt: Date.now(),
  }
}

function MarkdownBody({ children }: { children: string }) {
  const source = markdownSource(children)
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
        h1: ({ children }) => (
          <h1 className="mt-4 mb-2 text-base font-semibold first:mt-0">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="mt-4 mb-2 text-[0.9375rem] font-semibold first:mt-0">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0">
            {children}
          </h3>
        ),
        ul: ({ children }) => (
          <ul className="mb-3 list-disc space-y-1 pl-5 marker:text-muted-foreground last:mb-0">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-3 list-decimal space-y-1 pl-5 marker:text-muted-foreground last:mb-0">
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="pl-0.5">{children}</li>,
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary underline decoration-primary/40 underline-offset-2 transition-colors hover:decoration-primary"
          >
            {children}
          </a>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold">{children}</strong>
        ),
        blockquote: ({ children }) => (
          <blockquote className="mb-3 border-l-2 border-border pl-3 text-muted-foreground italic last:mb-0">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-4 border-border" />,
        code: ({ children }) => (
          <code className="rounded border border-border/60 bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground">
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre className="mb-3 overflow-x-auto rounded-lg border border-border/60 bg-muted p-4 font-mono text-sm leading-6 last:mb-0 [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-sm">
            {children}
          </pre>
        ),
      }}
    >
      {source}
    </ReactMarkdown>
  )
}

export function SpaceChatView({ space, projects, headerLeading }: Props) {
  const [ready, setReady] = React.useState(() => store.isReady())
  // The space whose data is loaded into state. Persist effects stay idle until
  // this matches the current space, so the initial empty state never clobbers
  // the on-disk snapshot (React StrictMode double-invokes effects on mount).
  const [hydratedSpaceId, setHydratedSpaceId] = React.useState<string | null>(
    null
  )
  const [sessions, setSessions] = React.useState<SpaceChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(
    null
  )
  const [messages, setMessages] = React.useState<SpaceChatMessage[]>([])
  const [settings, setSettings] = React.useState<SpaceChatSettings>(
    () => cachedSpaceChatSettings ?? DEFAULT_SETTINGS
  )
  const [settingsLoaded, setSettingsLoaded] = React.useState(
    () => cachedSpaceChatSettings !== null
  )
  const [models, setModels] = React.useState<SpaceChatModels>(
    () => cachedSpaceChatModels ?? []
  )
  const [input, setInput] = React.useState("")
  // Session awaiting delete confirmation (null = dialog closed).
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(
    null
  )
  // Whether the "clear all chats" confirmation dialog is open.
  const [confirmClearAll, setConfirmClearAll] = React.useState(false)
  const composerFormRef = React.useRef<HTMLFormElement>(null)
  const scrollerViewportRef = React.useRef<HTMLDivElement | null>(null)
  const restoredScrollKeyRef = React.useRef<string | null>(null)
  // Latest active session id, readable synchronously from async stream
  // callbacks so background streams never write into the on-screen session.
  const activeIdRef = React.useRef<string | null>(activeSessionId)
  // Per-session working copy of messages while a turn streams in.
  const streamStateRef = React.useRef<Map<string, SpaceChatMessage[]>>(
    new Map()
  )
  // Renderer-side FCFS queues. A queued user message is shown immediately, but
  // its assistant "Thinking…" placeholder is only added when that turn starts.
  const sessionQueuesRef = React.useRef<Map<string, Promise<void>>>(new Map())
  const deletedSessionIdsRef = React.useRef<Set<string>>(new Set())

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null
  const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  const activeScrollKey = activeSessionId
    ? scrollPositionKey(space.id, activeSessionId)
    : null

  const activeModel = models.find((m) => m.model === settings.model) ?? null
  const modelLabel = activeModel?.displayName ?? settings.model
  const effortOptions = (
    activeModel && activeModel.supportedReasoningEfforts.length > 0
      ? activeModel.supportedReasoningEfforts
      : REASONING_EFFORTS
  ).filter((effort) => REASONING_EFFORTS.includes(effort))

  // Type-to-focus: when the user starts typing and no editable field is
  // focused, move focus to the composer so the keystroke lands there.
  React.useEffect(() => {
    const composerTextarea = () =>
      composerFormRef.current?.querySelector("textarea") ?? null

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.length !== 1) return
      if (isEditableTarget(document.activeElement)) return
      const textarea = composerTextarea()
      if (!textarea || textarea.disabled) return
      textarea.focus()
    }

    // Paste-to-focus: pasting while no field is focused drops the text into
    // the composer instead of being lost.
    const onPaste = (event: ClipboardEvent) => {
      if (isEditableTarget(document.activeElement)) return
      const textarea = composerTextarea()
      if (!textarea || textarea.disabled) return
      const text = event.clipboardData?.getData("text") ?? ""
      if (!text) return
      event.preventDefault()
      textarea.focus()
      setInput((prev) => prev + text)
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
  }, [])

  // Focus the composer when the chat page opens (mount) or the space changes.
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => {
      composerFormRef.current?.querySelector("textarea")?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [space.id])

  React.useEffect(() => {
    return store.onReady(() => setReady(true))
  }, [])

  // Load (and migrate) sessions whenever the store is ready or the space
  // changes, then hydrate the active session's messages.
  React.useEffect(() => {
    if (!ready) return
    const { sessions: initial, activeId } = initSpaceSessions(space.id)
    setSessions(initial)
    activeIdRef.current = activeId
    setActiveSessionId(activeId)
    setMessages(loadSessionMessages(space.id, activeId))
    setHydratedSpaceId(space.id)
  }, [ready, space.id])

  const hydrated = hydratedSpaceId === space.id

  React.useEffect(() => {
    if (!hydrated || !activeSessionId) return
    saveSessionMessages(space.id, activeSessionId, messages)
  }, [hydrated, messages, activeSessionId, space.id])

  React.useEffect(() => {
    if (!hydrated) return
    saveSessions(space.id, sessions)
  }, [hydrated, sessions, space.id])

  React.useEffect(() => {
    if (!hydrated || !activeSessionId) return
    persistActiveSessionId(space.id, activeSessionId)
  }, [hydrated, activeSessionId, space.id])

  React.useLayoutEffect(() => {
    if (!activeScrollKey || messages.length === 0) return
    if (restoredScrollKeyRef.current === activeScrollKey) return
    const viewport = scrollerViewportRef.current
    const stored = chatScrollPositions.get(activeScrollKey)
    if (!viewport || stored === undefined) return

    const frame = requestAnimationFrame(() => {
      viewport.scrollTop = Math.min(
        stored,
        Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      )
      restoredScrollKeyRef.current = activeScrollKey
    })
    return () => cancelAnimationFrame(frame)
  }, [activeScrollKey, messages.length])

  React.useEffect(() => {
    return () => {
      if (!activeScrollKey || !scrollerViewportRef.current) return
      chatScrollPositions.set(
        activeScrollKey,
        scrollerViewportRef.current.scrollTop
      )
    }
  }, [activeScrollKey])

  React.useEffect(() => {
    let cancelled = false
    void loadSpaceChatSettings().then((next) => {
      if (cancelled) return
      setSettings(next)
      setSettingsLoaded(true)
    })
    void loadSpaceChatModels().then((next) => {
      if (cancelled) return
      setModels(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const applySettings = (patch: {
    model?: string
    reasoningEffort?: string
  }) => {
    // Optimistically reflect the choice, then persist through main.
    setSettings((current) => {
      const next = { ...current, ...patch }
      cachedSpaceChatSettings = next
      return next
    })
    void window.spaceChat.saveSettings(patch).then((next) => {
      cachedSpaceChatSettings = next
      setSettings(next)
      setSettingsLoaded(true)
    })
  }

  // Apply a message-list update to a specific session: it's the source of
  // truth in the stream ref, persisted to the store, and mirrored into the
  // visible `messages` state only if that session is currently on screen.
  const applyToSession = (
    sessionId: string,
    updater: (prev: SpaceChatMessage[]) => SpaceChatMessage[]
  ) => {
    if (deletedSessionIdsRef.current.has(sessionId)) return
    const prev =
      streamStateRef.current.get(sessionId) ??
      loadSessionMessages(space.id, sessionId)
    const next = updater(prev)
    streamStateRef.current.set(sessionId, next)
    saveSessionMessages(space.id, sessionId, next)
    if (activeIdRef.current === sessionId) setMessages(next)
  }

  const queueSessionTurn = (sessionId: string, run: () => Promise<void>) => {
    const previous =
      sessionQueuesRef.current.get(sessionId) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        if (deletedSessionIdsRef.current.has(sessionId)) return
        try {
          await run()
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "Space chat failed"
          )
        }
      })
    sessionQueuesRef.current.set(sessionId, next)
    void next.finally(() => {
      if (sessionQueuesRef.current.get(sessionId) === next) {
        sessionQueuesRef.current.delete(sessionId)
      }
    })
  }

  const sendMessage = async () => {
    const content = input.trim()
    const sessionId = activeSessionId
    if (!content || !sessionId) return
    if (!settings.authenticated) {
      toast.error(settings.error || "Run `codex login` before chatting")
      return
    }

    const userMessage = createUserMessage(content)
    const baseMessages = streamStateRef.current.get(sessionId) ?? messages
    const isFirstMessage = baseMessages.length === 0

    // Show the queued user message immediately. The assistant placeholder is
    // added later by the queue runner, so only one turn shows Thinking….
    applyToSession(sessionId, (current) => [...current, userMessage])
    // Bump the session's recency, and title it from the first message.
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              updatedAt: Date.now(),
              title: isFirstMessage
                ? deriveSessionTitle(content)
                : session.title,
            }
          : session
      )
    )
    setInput("")

    queueSessionTurn(sessionId, async () => {
      const assistantId = crypto.randomUUID()
      const streamId = crypto.randomUUID()
      const currentMessages =
        streamStateRef.current.get(sessionId) ??
        loadSessionMessages(space.id, sessionId)
      const userIndex = currentMessages.findIndex(
        (message) => message.id === userMessage.id
      )
      if (userIndex === -1) return
      const requestMessages = currentMessages
        .slice(0, userIndex + 1)
        .filter((message) => message.role === "user" || message.content.trim())

      // Keep the active turn indicator at the bottom of the conversation,
      // even when later user messages are already queued above it.
      applyToSession(sessionId, (current) => {
        if (!current.some((message) => message.id === userMessage.id)) {
          return current
        }
        return [
          ...current,
          {
            id: assistantId,
            role: "assistant",
            content: "",
            createdAt: Date.now(),
          },
        ]
      })

      let streamed = ""
      const unsubscribe = window.spaceChat.onDelta(
        ({ streamId: sid, delta }) => {
          if (sid !== streamId) return
          streamed += delta
          applyToSession(sessionId, (current) =>
            current.map((message) =>
              message.id === assistantId
                ? { ...message, content: streamed }
                : message
            )
          )
        }
      )

      const result = await window.spaceChat.send({
        space,
        projects,
        messages: requestMessages,
        streamId,
        sessionId,
        activeTurnId: assistantId,
      })
      unsubscribe()

      if (!result.ok) {
        // Drop the placeholder and surface the error.
        applyToSession(sessionId, (current) =>
          current.filter((message) => message.id !== assistantId)
        )
        toast.error(result.error)
        return
      }
      // Finalize with the authoritative response text.
      applyToSession(sessionId, (current) =>
        current.map((message) =>
          message.id === assistantId
            ? { ...message, content: result.message.content }
            : message
        )
      )
    })
  }

  const handleNewSession = React.useCallback(() => {
    const session = createSession()
    deletedSessionIdsRef.current.delete(session.id)
    setSessions((current) => [session, ...current])
    activeIdRef.current = session.id
    setActiveSessionId(session.id)
    setMessages([])
    setInput("")
    // Focus the composer after the new (empty) chat renders.
    requestAnimationFrame(() => {
      composerFormRef.current?.querySelector("textarea")?.focus()
    })
  }, [])

  // ⌘N / Ctrl+N starts a new chat.
  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        (event.key === "n" || event.key === "N")
      ) {
        event.preventDefault()
        handleNewSession()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [handleNewSession])

  const handleSwitchSession = (id: string) => {
    if (id === activeSessionId) return
    if (activeScrollKey && scrollerViewportRef.current) {
      chatScrollPositions.set(
        activeScrollKey,
        scrollerViewportRef.current.scrollTop
      )
    }
    activeIdRef.current = id
    setActiveSessionId(id)
    setMessages(loadSessionMessages(space.id, id))
  }

  const handleDeleteSession = (id: string) => {
    deletedSessionIdsRef.current.add(id)
    deleteSessionData(space.id, id)
    chatScrollPositions.delete(scrollPositionKey(space.id, id))
    streamStateRef.current.delete(id)
    sessionQueuesRef.current.delete(id)
    const remaining = sessions.filter((session) => session.id !== id)
    if (remaining.length === 0) {
      const fresh = createSession()
      setSessions([fresh])
      activeIdRef.current = fresh.id
      setActiveSessionId(fresh.id)
      setMessages([])
      return
    }
    setSessions(remaining)
    if (id === activeSessionId) {
      const next = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt)[0]
      activeIdRef.current = next.id
      setActiveSessionId(next.id)
      setMessages(loadSessionMessages(space.id, next.id))
    }
  }

  const handleClearAllSessions = () => {
    for (const session of sessions) {
      deletedSessionIdsRef.current.add(session.id)
      deleteSessionData(space.id, session.id)
      chatScrollPositions.delete(scrollPositionKey(space.id, session.id))
      streamStateRef.current.delete(session.id)
      sessionQueuesRef.current.delete(session.id)
    }
    const fresh = createSession()
    setSessions([fresh])
    activeIdRef.current = fresh.id
    setActiveSessionId(fresh.id)
    setMessages([])
  }

  // After a reload, re-attach sessions left mid-turn (a trailing empty
  // assistant placeholder) to the turn the main process still owns, instead of
  // hanging forever on "Thinking…". Polls until the turn resolves.
  React.useEffect(() => {
    if (!hydrated) return
    let cancelled = false
    const delay = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms))

    const recover = async (sessionId: string, assistantId: string) => {
      for (;;) {
        if (cancelled) return
        const turn = await window.spaceChat.activeTurn(assistantId)
        if (cancelled) return
        if (!turn || turn.status === "error") {
          // Lost or failed — drop the stuck placeholder to unstick the UI.
          applyToSession(sessionId, (current) =>
            current.filter((message) => message.id !== assistantId)
          )
          return
        }
        if (turn.status === "completed") {
          applyToSession(sessionId, (current) =>
            current.map((message) =>
              message.id === assistantId
                ? { ...message, content: turn.content || turn.text }
                : message
            )
          )
          return
        }
        // Still running: show partial text and poll.
        if (turn.text) {
          applyToSession(sessionId, (current) =>
            current.map((message) =>
              message.id === assistantId
                ? { ...message, content: turn.text }
                : message
            )
          )
        }
        await delay(400)
      }
    }

    for (const session of sessions) {
      const stored = loadSessionMessages(space.id, session.id)
      for (const message of stored) {
        if (message.role === "assistant" && message.content === "") {
          void recover(session.id, message.id)
        }
      }
    }

    return () => {
      cancelled = true
    }
    // Runs once per space hydration; deliberately not re-run on every state
    // change so recovery isn't restarted mid-poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, space.id])

  const composer = (
    <form
      ref={composerFormRef}
      onSubmit={(event) => {
        event.preventDefault()
        void sendMessage()
      }}
      className="mx-auto flex w-full max-w-3xl flex-col gap-2"
    >
      {settingsLoaded && !settings.authenticated && (
        <div className="px-1 text-xs text-muted-foreground">
          {settings.error || "Run codex login"}
        </div>
      )}
      <InputGroup className="items-stretch rounded-2xl border border-border/60 bg-white shadow-[0_1px_2px_rgb(0_0_0/0.04),0_3px_10px_-6px_rgb(0_0_0/0.08)] transition-shadow focus-within:shadow-[0_1px_3px_rgb(0_0_0/0.05),0_5px_14px_-6px_rgb(0_0_0/0.10)] has-disabled:bg-white! has-disabled:opacity-100! has-[[data-slot=input-group-control]:focus-visible]:border-border/60! has-[[data-slot=input-group-control]:focus-visible]:ring-0! dark:border-white/10 dark:bg-secondary dark:has-disabled:bg-secondary! dark:has-[[data-slot=input-group-control]:focus-visible]:border-white/10! dark:has-[[data-slot=input-group-control]:focus-visible]:ring-0!">
        <InputGroupTextarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              void sendMessage()
            }
          }}
          placeholder={`Ask about ${space.name}`}
          className="max-h-40 min-h-16 px-5 pt-4 text-base md:text-sm"
        />
        <InputGroupAddon
          align="block-end"
          className="flex items-center justify-between gap-2 px-5 pb-3.5"
        >
          <div className="flex min-w-0 items-center gap-2">
            <InputGroupText className="truncate text-xs">
              {projects.length} project{projects.length === 1 ? "" : "s"}
            </InputGroupText>
          </div>
          <div className="flex min-w-0 items-center gap-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className="flex max-w-40 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  />
                }
              >
                <span className="truncate">{modelLabel}</span>
                <ChevronDown className="size-3 shrink-0 opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="max-h-72 w-56 overflow-y-auto"
              >
                {models.length === 0 ? (
                  <DropdownMenuItem disabled>
                    No models available
                  </DropdownMenuItem>
                ) : (
                  models.map((model) => (
                    <DropdownMenuItem
                      key={model.model}
                      onClick={() => applySettings({ model: model.model })}
                    >
                      <Check
                        className={cn(
                          model.model === settings.model
                            ? "opacity-100"
                            : "opacity-0"
                        )}
                      />
                      <span className="flex-1 truncate">
                        {model.displayName}
                      </span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  />
                }
              >
                <span>{titleCase(settings.reasoningEffort)}</span>
                <ChevronDown className="size-3 shrink-0 opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {effortOptions.map((effort) => (
                  <DropdownMenuItem
                    key={effort}
                    onClick={() => applySettings({ reasoningEffort: effort })}
                  >
                    <Check
                      className={cn(
                        effort === settings.reasoningEffort
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                    <span className="flex-1">{titleCase(effort)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <InputGroupButton
              type="submit"
              variant="default"
              size="icon-sm"
              className="rounded-full"
              disabled={!input.trim()}
            >
              <ArrowUp />
              <span className="sr-only">Send</span>
            </InputGroupButton>
          </div>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )

  // Memoized so the markdown-heavy message list only re-renders when messages
  // change — not on every composer keystroke/paste (which would feel laggy).
  const renderedMessages = React.useMemo(
    () =>
      messages.map((message, index) => {
        const isUser = message.role === "user"
        const scrollAnchor = index === messages.length - 1
        if (isUser) {
          return (
            <MessageScrollerItem key={message.id} scrollAnchor={scrollAnchor}>
              <Message align="end">
                <MessageContent>
                  <Bubble
                    align="end"
                    variant="secondary"
                    className="max-w-[85%]"
                  >
                    <BubbleContent
                      className="rounded-lg px-3.5 py-2.5"
                      onCopy={(event) =>
                        handleMessageCopy(event, message.content)
                      }
                      onContextMenu={(event) =>
                        void handleMessageContextMenu(event, message.content)
                      }
                    >
                      <MarkdownBody>{message.content}</MarkdownBody>
                    </BubbleContent>
                  </Bubble>
                  <MessageFooter className="gap-2 text-muted-foreground/70 opacity-0 transition-opacity group-hover/message:opacity-100">
                    <CopyButton text={message.content} />
                    <span>{messageTime(message.createdAt)}</span>
                  </MessageFooter>
                </MessageContent>
              </Message>
            </MessageScrollerItem>
          )
        }
        return (
          <MessageScrollerItem key={message.id} scrollAnchor={scrollAnchor}>
            <div className="group/message flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Sparkles className="size-3.5 text-primary" />
                GearShift
              </div>
              <div
                className="text-[0.9375rem] leading-relaxed text-foreground"
                onCopy={(event) => handleMessageCopy(event, message.content)}
                onContextMenu={(event) =>
                  void handleMessageContextMenu(event, message.content)
                }
              >
                {message.content ? (
                  <MarkdownBody>{message.content}</MarkdownBody>
                ) : (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span className="animate-pulse">Thinking…</span>
                  </div>
                )}
              </div>
              {message.content && (
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground/70 opacity-0 transition-opacity group-hover/message:opacity-100">
                  <CopyButton text={message.content} />
                  <span>{messageTime(message.createdAt)}</span>
                </div>
              )}
            </div>
          </MessageScrollerItem>
        )
      }),
    [messages]
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border/60 px-2 [-webkit-app-region:drag]">
        {headerLeading}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="h-8 max-w-[70%] gap-1.5 px-2 font-medium [-webkit-app-region:no-drag]"
              />
            }
          >
            <span className="truncate">{activeSession?.title ?? "Chat"}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuItem onClick={handleNewSession}>
              <Plus />
              New chat
            </DropdownMenuItem>
            {sortedSessions.length > 0 && <DropdownMenuSeparator />}
            {sortedSessions.map((session) => (
              <DropdownMenuItem
                key={session.id}
                onClick={() => handleSwitchSession(session.id)}
                className="pr-1"
              >
                <Check
                  className={cn(
                    session.id === activeSessionId ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="flex-1 truncate">{session.title}</span>
                <button
                  type="button"
                  aria-label="Delete chat"
                  onClick={(event) => {
                    event.stopPropagation()
                    event.preventDefault()
                    setPendingDeleteId(session.id)
                  }}
                  className="rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity group-hover/dropdown-menu-item:opacity-100 hover:text-destructive focus-visible:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </DropdownMenuItem>
            ))}
            {sortedSessions.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setConfirmClearAll(true)}
                >
                  <Trash2 />
                  Clear all chats
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="ml-auto flex items-center gap-0.5 [-webkit-app-region:no-drag]">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New chat"
            title="New chat (⌘N)"
            className="size-8 text-muted-foreground hover:text-foreground"
            onClick={handleNewSession}
          >
            <Plus className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete chat"
            title="Delete chat"
            className="size-8 text-muted-foreground hover:text-destructive"
            disabled={!activeSessionId}
            onClick={() => {
              if (activeSessionId) setPendingDeleteId(activeSessionId)
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      {messages.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-7 px-4 pb-20">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="text-3xl font-medium tracking-normal text-foreground">
              How can I help?
            </div>
            <p className="max-w-md text-sm text-muted-foreground">
              Ask about your projects in {space.name} — recent work, history,
              and what you&apos;ve been building.
            </p>
          </div>
          {composer}
        </div>
      ) : (
        <>
          <MessageScrollerProvider>
            <MessageScroller className="min-h-0 flex-1">
              <MessageScrollerViewport
                ref={scrollerViewportRef}
                onScroll={(event) => {
                  if (!activeScrollKey) return
                  chatScrollPositions.set(
                    activeScrollKey,
                    event.currentTarget.scrollTop
                  )
                }}
              >
                <MessageScrollerContent className="mx-auto w-full max-w-3xl px-4 py-8">
                  {renderedMessages}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
          <div className="shrink-0 bg-background px-4 pt-2 pb-5">
            {composer}
          </div>
        </>
      )}

      <Dialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete chat?</DialogTitle>
            <DialogDescription>
              {(() => {
                const title = sessions.find(
                  (session) => session.id === pendingDeleteId
                )?.title
                return title
                  ? `"${title}" and its messages will be permanently deleted. This can't be undone.`
                  : "This chat and its messages will be permanently deleted. This can't be undone."
              })()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingDeleteId(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (pendingDeleteId) handleDeleteSession(pendingDeleteId)
                setPendingDeleteId(null)
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmClearAll} onOpenChange={setConfirmClearAll}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Clear all chats?</DialogTitle>
            <DialogDescription>
              All chats and their messages in this space will be permanently
              deleted. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmClearAll(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                handleClearAllSessions()
                setConfirmClearAll(false)
              }}
            >
              Clear all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
