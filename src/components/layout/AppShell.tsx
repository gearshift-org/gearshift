import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams, useRouter } from "@tanstack/react-router"
import {
  acceleratorLabel,
  matchesAccelerator,
} from "@/lib/keybindings/registry"
import { useKeybindings } from "@/lib/keybindings/useKeybindings"
import { toast } from "sonner"
import { PanelLeft, PanelRight, Search, X } from "lucide-react"
import { ProjectAvatar } from "./ProjectAvatar"
import { AutoHideTitleBar } from "./AutoHideTitleBar"
import { TitleBar } from "./TitleBar"

import { ProjectGitStatusBadge } from "./ProjectGitStatusBadge"
import {
  summarizeHistoryToAgent,
  writeAgentPrompt,
  type HistoryRange,
} from "@/lib/historySummary"
import { ProjectSidebar } from "./ProjectSidebar"
import { ProjectSwitcher } from "./ProjectSwitcher"
import { THEME_FAMILIES, useTheme } from "@/components/theme-provider"
import { WorkspaceTabBar } from "./WorkspaceTabBar"
import { WorkspaceSplit } from "./WorkspaceSplit"
import { SpaceChatView } from "./SpaceChatView"
import { CommandPalette } from "./CommandPalette"
import logoGrayUrl from "@/assets/logo-gray.svg?url"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { paneDisplayName, tabDisplayName } from "./terminalName"
import { requestTerminalClipboardPaste } from "./terminalSignals"
import {
  ensureLayout,
  insertBeside,
  moveLeafBeside,
  orderedPaneIds,
  removeLeaf,
  splitLeaf,
  swapLeaves,
} from "./terminalLayout"
import agentCompleteSoundUrl from "@/assets/sounds/agent-complete.wav?url"
import {
  isLaunchableAgentName,
  type DropZone,
  type FileReveal,
  type Project,
  type SplitDirection,
  type TerminalAgentName,
  type TerminalAgentStatus,
  type TerminalLayout,
  type WorkspaceTab,
} from "./types"
import {
  DEFAULT_SPACE_ID,
  loadActiveProjectId,
  loadActiveSpaceId,
  loadLastLocation,
  loadAutoHideTitleBar,
  loadOpenFilesInOwnTab,
  loadLastAgentTerminals,
  loadPaletteRecents,
  loadFocusedProjectIds,
  loadProjects,
  loadProjectSidebarOpen,
  loadProjectSidebarChatEnabled,
  loadProjectSidebarWidth,
  loadRecentProjects,
  loadSpaces,
  loadRightSidebarTab,
  loadSidebarOpen,
  pushRecentPaletteFile,
  pushRecentPaletteProject,
  pushRecentPaletteTab,
  pushRecentProject,
  saveActiveProjectId,
  saveActiveSpaceId,
  saveAutoHideTitleBar,
  saveLastAgentTerminals,
  saveFocusedProjectIds,
  saveProjectSidebarOpen,
  saveProjectSidebarWidth,
  saveProjects,
  saveRecentProjects,
  saveRightSidebarTab,
  saveSidebarOpen,
  saveSpaces,
  stableProjectId,
  AUTO_HIDE_TITLE_BAR_EVENT,
  OPEN_FILES_IN_OWN_TAB_EVENT,
  PROJECT_SIDEBAR_CHAT_EVENT,
  toStoredAgentStatus,
  type LastAgentTerminal,
  type LastAgentTerminalsByProject,
  type PaletteRecents,
  type RecentProject,
  type RightSidebarTab,
  type StoredProject,
  type StoredSpace,
  type StoredTab,
} from "@/lib/projects"
import { parseSettingsSection } from "@/routes/settings/settingsSections"
import { gitQueryKey } from "@/lib/gitStatusQuery"
import {
  AGENT_TERMINAL_LABELS,
  getAgentTerminalOptions,
} from "@/lib/agentTerminalOptions"
import { store } from "@/lib/store"
import { cn } from "@/lib/utils"

type ProjectIdMigration = { from: string; to: string }

function projectSpaceId(
  spaceId: string | undefined,
  spaces: StoredSpace[]
): string {
  return spaceId && spaces.some((space) => space.id === spaceId)
    ? spaceId
    : DEFAULT_SPACE_ID
}

function hydrateProjectSnapshot(spaces = loadSpaces()): {
  projects: Project[]
  migrations: ProjectIdMigration[]
} {
  const migrations: ProjectIdMigration[] = []
  const seen = new Set<string>()
  const projects = loadProjects().flatMap((p: StoredProject) => {
    const id = stableProjectId(p.path)
    if (seen.has(id)) return []
    seen.add(id)
    if (p.id !== id) migrations.push({ from: p.id, to: id })
    return [
      {
        id,
        name: p.name,
        path: p.path,
        spaceId: projectSpaceId(p.spaceId, spaces),
        ...(typeof p.updatedAt === "number" ? { updatedAt: p.updatedAt } : {}),
        tabs: (p.tabs ?? []).flatMap((t): WorkspaceTab[] => {
          // Preview tabs restore from their descriptor.
          if (t.kind === "file") {
            if (!t.path) return []
            return [
              {
                kind: "file" as const,
                id: t.id,
                name: t.name,
                path: t.path,
                ...(t.preview ? { preview: true } : {}),
              },
            ]
          }
          if (t.kind === "diff") {
            if (!t.path) return []
            return [
              {
                kind: "diff" as const,
                id: t.id,
                name: t.name,
                path: t.path,
                staged: !!t.staged,
                ...(t.preview ? { preview: true } : {}),
              },
            ]
          }
          if (t.kind === "commit") {
            if (!t.hash) return []
            return [
              {
                kind: "commit" as const,
                id: t.id,
                name: t.name,
                hash: t.hash,
                shortHash: t.shortHash ?? t.hash.slice(0, 7),
                ...(t.preview ? { preview: true } : {}),
              },
            ]
          }
          if (t.kind === "devPreview") {
            if (!t.url) return []
            return [
              {
                kind: "devPreview" as const,
                id: t.id,
                name: t.name,
                url: t.url,
              },
            ]
          }
          const storedPanes =
            t.panes && t.panes.length > 0 ? t.panes : [{ id: t.id }]
          const panes = storedPanes.map((sp) => ({
            id: sp.id,
            pendingStart: true,
            ...(sp.sessionId ? { pendingSessionId: sp.sessionId } : {}),
            ...(sp.autoTitle ? { autoTitle: sp.autoTitle } : {}),
            ...(sp.customName ? { customName: sp.customName } : {}),
            ...(sp.agentName ? { agentName: sp.agentName } : {}),
            ...(sp.agentSessionId ? { agentSessionId: sp.agentSessionId } : {}),
            ...(sp.agentSessionTitle
              ? { agentSessionTitle: sp.agentSessionTitle }
              : {}),
            // Restore the persisted status markers. running/working start false
            // and are re-detected from the live PTY once the pane attaches.
            ...(sp.agentStatus
              ? {
                  agentStatus: {
                    running: false,
                    working: false,
                    ...sp.agentStatus,
                  },
                }
              : {}),
          }))
          const activePaneId =
            (t.activePaneId && panes.some((pp) => pp.id === t.activePaneId)
              ? t.activePaneId
              : panes[0]?.id) ?? t.id
          return [
            {
              kind: "terminal" as const,
              id: t.id,
              name: t.name,
              customName: t.customName,
              panes,
              activePaneId,
              ...(t.layout ? { layout: t.layout } : {}),
            },
          ]
        }),
        activeTabId: p.activeTabId ?? p.tabs?.[0]?.id ?? "",
        ...(p.agentDone === true ? { agentDone: true } : {}),
      },
    ]
  })
  return { projects, migrations }
}

function resolveMigratedProjectId(
  id: string | null,
  projects: Project[],
  migrations: ProjectIdMigration[]
): string | null {
  if (!id) return null
  if (projects.some((p) => p.id === id)) return id
  return migrations.find((migration) => migration.from === id)?.to ?? null
}

function makeId() {
  return crypto.randomUUID()
}

// Default width of ProjectSidebar; the user can resize it via the drag handle.
const PROJECT_SIDEBAR_DEFAULT_PX = 248
const PROJECT_SIDEBAR_MIN_PX = 180
const PROJECT_SIDEBAR_MAX_PX = 480
function clampProjectSidebarWidth(n: number): number {
  return Math.min(PROJECT_SIDEBAR_MAX_PX, Math.max(PROJECT_SIDEBAR_MIN_PX, n))
}
const WINDOW_RESIZE_SETTLE_MS = 180
const AGENT_TERMINAL_COMMANDS: Record<TerminalAgentName, string> = {
  claude: "claude",
  codex: "codex",
  opencode: "opencode",
  pi: "pi",
}
const APP_TITLE = "GearShift"

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function agentTerminalCommand(
  agentName: TerminalAgentName,
  options: string,
  agentSessionId?: string
): string {
  const base = options
    ? `${AGENT_TERMINAL_COMMANDS[agentName]} ${options}`
    : AGENT_TERMINAL_COMMANDS[agentName]
  if (!agentSessionId) return base
  const quotedSessionId = shellQuote(agentSessionId)
  switch (agentName) {
    case "claude":
      return `${base} --resume ${quotedSessionId}`
    case "codex":
      return `${base} resume ${quotedSessionId}`
    case "opencode":
      return `${base} --session ${quotedSessionId}`
    case "pi":
      return `${base} --session ${quotedSessionId}`
  }
}

function lastAgentTerminalFromPane(
  project: Project,
  tabId: string,
  paneId: string,
  remembered?: LastAgentTerminal | null
): LastAgentTerminal | null {
  const tab = project.tabs.find((t) => t.kind === "terminal" && t.id === tabId)
  if (!tab || tab.kind !== "terminal") return null
  const pane = tab.panes.find((pp) => pp.id === paneId)
  if (!pane) return null
  const sessionId = pane.sessionId ?? pane.pendingSessionId
  return {
    projectId: project.id,
    projectPath: project.path,
    tabId,
    paneId,
    ...((sessionId ?? remembered?.sessionId)
      ? { sessionId: sessionId ?? remembered?.sessionId }
      : {}),
    updatedAt: remembered?.updatedAt ?? Date.now(),
  }
}

function agentStatusesEqual(
  a: TerminalAgentStatus | undefined,
  b: TerminalAgentStatus | undefined
): boolean {
  return (
    a?.running === b?.running &&
    a?.working === b?.working &&
    a?.agentName === b?.agentName &&
    a?.workStartedAt === b?.workStartedAt &&
    a?.completedAt === b?.completedAt &&
    a?.completed === b?.completed &&
    a?.needsAttention === b?.needsAttention &&
    a?.agentSessionId === b?.agentSessionId &&
    a?.agentSessionTitle === b?.agentSessionTitle
  )
}

function basename(p: string) {
  return p.replace(/\/+$/, "").split("/").pop() || p
}

function devPreviewName(url: string): string {
  try {
    const parsed = new URL(url)
    return `Dev Preview · ${parsed.host || parsed.hostname}`
  } catch {
    return "Dev Preview"
  }
}

function killAllPanes(tab: WorkspaceTab) {
  if (tab.kind !== "terminal") return
  for (const pane of tab.panes) {
    if (pane.pendingStart) continue
    // Daemon keys sessions by sessionId; pane.id is the stable DOM key and
    // may not match. Using pane.id here would orphan the PTY until the 24h
    // idle sweep.
    const sid = pane.sessionId
    if (!sid) continue
    try {
      window.term.kill(sid)
    } catch {
      // ignore
    }
  }
}

// Count terminal panes that have a coding agent open (running) — covers an
// agent that is actively working, idle, or waiting on the user. Used to gate
// close protection before closing one or more terminal panes.
function countAgentTerminalPanes(tabs: WorkspaceTab[]): number {
  let count = 0
  for (const tab of tabs) {
    if (tab.kind !== "terminal") continue
    for (const pane of tab.panes) {
      if (pane.agentStatus?.running) count += 1
    }
  }
  return count
}

function serializeProjects(projects: Project[]): StoredProject[] {
  return projects.map((p) => {
    const tabs: StoredTab[] = p.tabs.map((t) => {
      if (t.kind === "file") {
        return {
          kind: "file",
          id: t.id,
          name: t.name,
          path: t.path,
          ...(t.preview ? { preview: true } : {}),
        }
      }
      if (t.kind === "diff") {
        return {
          kind: "diff",
          id: t.id,
          name: t.name,
          path: t.path,
          staged: t.staged,
          ...(t.preview ? { preview: true } : {}),
        }
      }
      if (t.kind === "commit") {
        return {
          kind: "commit",
          id: t.id,
          name: t.name,
          hash: t.hash,
          shortHash: t.shortHash,
          ...(t.preview ? { preview: true } : {}),
        }
      }
      if (t.kind === "devPreview") {
        return {
          kind: "devPreview",
          id: t.id,
          name: t.name,
          url: t.url,
        }
      }
      return {
        kind: "terminal",
        id: t.id,
        name: t.name,
        ...(t.customName ? { customName: t.customName } : {}),
        ...(t.layout ? { layout: t.layout } : {}),
        activePaneId: t.activePaneId,
        panes: t.panes.map((pp) => {
          // Persist the live sessionId for running panes, and keep the
          // pending one for panes the user hasn't activated yet — that way
          // a relaunch can still try to adopt them.
          const sid = pp.sessionId ?? pp.pendingSessionId
          const agentStatus = toStoredAgentStatus(pp.agentStatus)
          return {
            id: pp.id,
            ...(sid ? { sessionId: sid } : {}),
            ...(pp.autoTitle ? { autoTitle: pp.autoTitle } : {}),
            ...(pp.customName ? { customName: pp.customName } : {}),
            ...(pp.agentName ? { agentName: pp.agentName } : {}),
            ...(pp.agentSessionId ? { agentSessionId: pp.agentSessionId } : {}),
            ...(pp.agentSessionTitle
              ? { agentSessionTitle: pp.agentSessionTitle }
              : {}),
            ...(agentStatus ? { agentStatus } : {}),
          }
        }),
      }
    })
    const activeTab = p.tabs.find((t) => t.id === p.activeTabId)
    return {
      id: p.id,
      name: p.name,
      path: p.path,
      spaceId: p.spaceId || DEFAULT_SPACE_ID,
      ...(typeof p.updatedAt === "number" ? { updatedAt: p.updatedAt } : {}),
      // Persist whatever tab is active — preview tabs included — so reload
      // returns to it.
      activeTabId: activeTab?.id ?? tabs[0]?.id ?? "",
      tabs,
      // Completed sidebar markers survive a restart. Needs-input is live-only:
      // it must be re-proven by an attached PTY/hook/snapshot on relaunch.
      ...(p.agentDone ? { agentDone: true } : {}),
    }
  })
}

function agentDoneToastId(projectId: string, tabId: string, paneId: string) {
  return `agent-done:${projectId}:${tabId}:${paneId}`
}

function agentAttentionToastId(
  projectId: string,
  tabId: string,
  paneId: string
) {
  return `agent-attention:${projectId}:${tabId}:${paneId}`
}

function isAppVisibleAndFocused() {
  return document.visibilityState === "visible" && document.hasFocus()
}

function latestPromptBody(
  rows: Array<{ body: string; agent: string | null; createdAt: number }>
): string | null {
  const newest = rows.reduce<(typeof rows)[number] | null>(
    (latest, row) =>
      !latest || row.createdAt > latest.createdAt ? row : latest,
    null
  )
  if (!newest) return null

  // Older app versions stored pasted multi-line prompts as one row per line.
  // Recombine the newest burst so notifications still describe the prompt,
  // not only the last pasted command line.
  const burstWindowMs = 1500
  const prompt = rows
    .filter(
      (row) =>
        row.agent === newest.agent &&
        newest.createdAt - row.createdAt >= 0 &&
        newest.createdAt - row.createdAt <= burstWindowMs
    )
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((row) => row.body)
    .join("\n")
    .trim()
  return prompt || newest.body.trim() || null
}

function promptPreview(body: string | null): string | null {
  if (!body) return null
  const collapsed = body.replace(/\s+/g, " ").trim()
  if (!collapsed) return null
  return collapsed.length > 120 ? `${collapsed.slice(0, 119)}…` : collapsed
}

function playAgentCompleteSound() {
  const audio = new Audio(agentCompleteSoundUrl)
  audio.volume = 0.5
  void audio.play().catch(() => {
    // Sound playback can be blocked until the user has interacted with the app.
  })
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(1, Math.round(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function buildDocumentTitle(activeProject: Project | undefined): string {
  if (!activeProject) return APP_TITLE
  return `${APP_TITLE} - ${activeProject.name}`
}

// Shared in-app agent notification card. Both the "finished" and "needs input"
// toasts render through this so they share an identical size and layout: a
// project-name header, a muted status line, and an optional message preview.
function agentToastCard(opts: {
  id: string | number
  projectName: string
  projectPath: string
  statusLabel: string
  statusMeta?: string | null
  bodyPreview?: string | null
  onOpen: () => void
}) {
  return (
    <div className="relative flex w-[320px] rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lg">
      <button
        type="button"
        onClick={opts.onOpen}
        className="flex min-w-0 flex-1 items-start gap-2 text-left"
      >
        <ProjectAvatar
          name={opts.projectName}
          path={opts.projectPath}
          className="mt-0.5 size-8 shrink-0 rounded-md text-xs"
        />
        <span className="flex min-w-0 flex-col gap-0.5 pr-5">
          <span className="truncate text-sm font-semibold">
            {opts.projectName}
          </span>
          <span className="flex min-w-0 items-baseline gap-1 text-[11px] text-muted-foreground">
            <span className="shrink-0">{opts.statusLabel}</span>
            {opts.statusMeta ? (
              <>
                <span className="shrink-0">·</span>
                <span className="min-w-0 truncate">{opts.statusMeta}</span>
              </>
            ) : null}
          </span>
          {opts.bodyPreview ? (
            <span className="line-clamp-2 pt-0.5 text-[11px] leading-snug text-foreground/80">
              {opts.bodyPreview}
            </span>
          ) : null}
        </span>
      </button>
      <button
        type="button"
        aria-label="Close notification"
        onClick={() => toast.dismiss(opts.id)}
        className="absolute top-1 right-1 rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

// True when the keystroke target is a real text field (input, textarea,
// contenteditable) where Cmd+Shift+Arrow should keep its native
// extend-selection behavior instead of navigating. The terminal is excluded:
// xterm focuses a hidden textarea, but Cmd+Shift+Arrow isn't used there, so we
// let navigation flow through.
function isTextEditingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  if (el.closest(".xterm")) return false
  const tag = el.tagName
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable ||
    !!el.closest('[contenteditable="true"]')
  )
}

export function AppShell() {
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { resolvedTheme, themeFamily, setThemeFamily } = useTheme()
  const params = useParams({ strict: false }) as {
    projectId?: string
    tabId?: string
    spaceId?: string
  }
  const routeProjectId = params.projectId ?? null
  const routeTabId = params.tabId ?? null
  const routeSpaceChatId = params.spaceId ?? null
  const initialSpaces = useMemo(() => loadSpaces(), [])
  const initialProjectSnapshot = useMemo(
    () => hydrateProjectSnapshot(initialSpaces),
    [initialSpaces]
  )

  const [projects, setProjects] = useState<Project[]>(
    () => initialProjectSnapshot.projects
  )
  const [spaces, setSpaces] = useState<StoredSpace[]>(() => initialSpaces)
  const [activeSpaceId, setActiveSpaceId] = useState(() =>
    loadActiveSpaceId(initialSpaces)
  )
  const [recents, setRecents] = useState<RecentProject[]>(() =>
    loadRecentProjects()
  )
  const [paletteRecents, setPaletteRecents] = useState<PaletteRecents>(() =>
    loadPaletteRecents()
  )
  const [sidebarOpen, setSidebarOpen] = useState(() => loadSidebarOpen())
  const [autoHideTitleBar, setAutoHideTitleBar] = useState(() =>
    loadAutoHideTitleBar()
  )
  const [openFilesInOwnTab, setOpenFilesInOwnTab] = useState(() =>
    loadOpenFilesInOwnTab()
  )
  const [projectSidebarChatEnabled, setProjectSidebarChatEnabled] = useState(
    () => loadProjectSidebarChatEnabled()
  )
  const [projectSidebarOpen, setProjectSidebarOpen] = useState(() =>
    loadProjectSidebarOpen()
  )
  const [projectSidebarWidth, setProjectSidebarWidth] = useState(() => {
    const stored = loadProjectSidebarWidth()
    return stored
      ? clampProjectSidebarWidth(stored)
      : PROJECT_SIDEBAR_DEFAULT_PX
  })
  const projectSidebarPanelRef = useRef<HTMLDivElement>(null)
  const workspaceMainRef = useRef<HTMLDivElement>(null)
  const projectSidebarDragRef = useRef<{
    startX: number
    startWidth: number
  } | null>(null)
  const projectSidebarDragWidthRef = useRef(projectSidebarWidth)
  const projectSidebarDragFrameRef = useRef<number | null>(null)
  const [projectSidebarDragging, setProjectSidebarDragging] = useState(false)
  const [focusedProjectIds, setFocusedProjectIds] = useState<string[]>(() =>
    loadFocusedProjectIds()
  )
  const [rightSidebarTab, setRightSidebarTab] = useState<RightSidebarTab>(() =>
    loadRightSidebarTab()
  )
  const [terminalFocusRequest, setTerminalFocusRequest] = useState<{
    tabId: string
    paneId: string
    nonce: number
  } | null>(null)
  // Persisted so it survives reloads, but only written (via rememberAgentTerminal)
  // — nothing reads the value now that "Commit with AI" is gone.
  const [, setLastAgentTerminals] = useState<LastAgentTerminalsByProject>(() =>
    loadLastAgentTerminals()
  )
  const [stateRestored, setStateRestored] = useState(() => store.isReady())
  const [restoredActiveProjectId, setRestoredActiveProjectId] = useState<
    string | null
  >(() => {
    return resolveMigratedProjectId(
      loadActiveProjectId(),
      initialProjectSnapshot.projects,
      initialProjectSnapshot.migrations
    )
  })
  const [openingTerminalTabId, setOpeningTerminalTabId] = useState<
    string | null
  >(null)
  const [pendingNavigation, setPendingNavigation] = useState<{
    projectId: string | null
    tabId?: string
  } | null>(null)

  useEffect(() => {
    if (initialProjectSnapshot.migrations.length === 0) return
    void window.term.history.migrateProjectIds(
      initialProjectSnapshot.migrations
    )
  }, [initialProjectSnapshot.migrations])

  // Disk snapshot arrives async — re-sync once it lands so the UI can paint
  // immediately with empty state and then fill in. Also restores the last
  // active project (router boots at "/" since hydration isn't sync anymore).
  useEffect(
    () =>
      store.onReady(() => {
        const storedSpaces = loadSpaces()
        const snapshot = hydrateProjectSnapshot(storedSpaces)
        const hydrated = snapshot.projects
        if (snapshot.migrations.length > 0) {
          saveProjects(serializeProjects(hydrated))
          void window.term.history.migrateProjectIds(snapshot.migrations)
        }
        setProjects(hydrated)
        setSpaces(storedSpaces)
        setActiveSpaceId(loadActiveSpaceId(storedSpaces))
        setRecents(loadRecentProjects())
        setPaletteRecents(loadPaletteRecents())
        setSidebarOpen(loadSidebarOpen())
        setAutoHideTitleBar(loadAutoHideTitleBar())
        setOpenFilesInOwnTab(loadOpenFilesInOwnTab())
        setProjectSidebarChatEnabled(loadProjectSidebarChatEnabled())
        setProjectSidebarOpen(loadProjectSidebarOpen())
        const storedWidth = loadProjectSidebarWidth()
        if (storedWidth)
          setProjectSidebarWidth(clampProjectSidebarWidth(storedWidth))
        setFocusedProjectIds(loadFocusedProjectIds())
        setRightSidebarTab(loadRightSidebarTab())
        setLastAgentTerminals(loadLastAgentTerminals())
        const storedActiveId = resolveMigratedProjectId(
          loadActiveProjectId(),
          hydrated,
          snapshot.migrations
        )
        const validStoredActiveId =
          storedActiveId && hydrated.some((p) => p.id === storedActiveId)
            ? storedActiveId
            : null
        setRestoredActiveProjectId(validStoredActiveId)
        setStateRestored(true)
        // Memory history boots at "/", so restore the last route the user was
        // on. Settings wins when it was the last location; otherwise fall back
        // to the stored active project below.
        const lastLocation = loadLastLocation()
        const lastSpaceChatId =
          lastLocation?.pathname.match(/^\/spaces\/([^/]+)\/chat$/)?.[1] ?? null
        if (
          lastSpaceChatId &&
          loadProjectSidebarChatEnabled() &&
          storedSpaces.some((space) => space.id === lastSpaceChatId) &&
          !params.projectId
        ) {
          void navigate({
            to: "/spaces/$spaceId/chat",
            params: { spaceId: lastSpaceChatId },
            replace: true,
          })
        } else if (
          lastLocation?.pathname === "/settings" &&
          !params.projectId
        ) {
          void navigate({
            to: "/settings",
            search: {
              section: parseSettingsSection(lastLocation.search.section),
            },
            replace: true,
          })
        } else if (validStoredActiveId && !params.projectId) {
          const proj = hydrated.find((p) => p.id === validStoredActiveId)!
          if (proj.activeTabId) {
            void navigate({
              to: "/projects/$projectId/tabs/$tabId",
              params: { projectId: proj.id, tabId: proj.activeTabId },
              replace: true,
            })
          } else {
            void navigate({
              to: "/projects/$projectId",
              params: { projectId: proj.id },
              replace: true,
            })
          }
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  // Forward reference: closePane (defined below) calls closeTab when the last
  // pane is being closed. Wired via effect once both are defined.
  const closeTabRef = useRef<(id: string) => void>(() => undefined)
  const projectsRef = useRef(projects)
  const lastTerminalByProjectRef = useRef<Record<string, string>>({})
  const agentDoneToastsByProjectRef = useRef<Map<string, Set<string>>>(
    new Map()
  )
  const terminalAgentStatusRef = useRef(new Map<string, TerminalAgentStatus>())
  const terminalFocusRequestNonceRef = useRef(0)
  // The terminal pane currently visible (active tab is a terminal). Null when
  // the active tab is a preview/non-terminal tab or there is no terminal. Read
  // by the global key/paste handlers to redirect stray typing into the terminal.
  const visibleTerminalRef = useRef<{
    tabId: string
    paneId: string
    sessionId: string
  } | null>(null)
  const windowFocusedRef = useRef(
    typeof document !== "undefined" ? document.hasFocus() : true
  )
  useEffect(() => {
    projectsRef.current = projects
  }, [projects])

  useEffect(() => {
    saveSidebarOpen(sidebarOpen)
  }, [sidebarOpen])
  useEffect(() => {
    saveSpaces(spaces)
  }, [spaces])
  useEffect(() => {
    saveActiveSpaceId(activeSpaceId)
  }, [activeSpaceId])
  // Native window drags can dispatch dozens of layout resizes per second.
  // Mark that short window so decorative CSS animations pause (index.css).
  // Terminals intentionally keep fitting live during window resizes so the
  // visible pane tracks the window edge like VS Code; only the expensive
  // column reflow defers to the settle fit inside TerminalView.
  useEffect(() => {
    let resizeTimer: number | null = null
    const onResize = () => {
      document.body.classList.add("gs-window-resizing")
      if (resizeTimer !== null) window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null
        document.body.classList.remove("gs-window-resizing")
      }, WINDOW_RESIZE_SETTLE_MS)
    }
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      if (resizeTimer !== null) window.clearTimeout(resizeTimer)
      document.body.classList.remove("gs-window-resizing")
    }
  }, [])
  useEffect(() => {
    saveProjectSidebarOpen(projectSidebarOpen)
  }, [projectSidebarOpen])
  // No fit suppression on toggle: the workspace snaps to its final size in one
  // layout pass at click time, and that single terminal reflow is intentional —
  // it lands under the compositor slide instead of as a post-animation hitch.
  // gs-sidebar-resizing is only for width drags (see startProjectSidebarDrag).
  // Persist the resized width once it settles (debounced).
  useEffect(() => {
    const id = window.setTimeout(
      () => saveProjectSidebarWidth(projectSidebarWidth),
      250
    )
    return () => window.clearTimeout(id)
  }, [projectSidebarWidth])
  useEffect(() => {
    projectSidebarDragWidthRef.current = projectSidebarWidth
  }, [projectSidebarWidth])
  // Drag-to-resize: mirror WorkspaceSplit's right sidebar, but the handle is on
  // the panel's right edge so dragging right widens it (dx is reversed in sign).
  useEffect(() => {
    const applyDragWidth = () => {
      projectSidebarDragFrameRef.current = null
      const width = `${projectSidebarDragWidthRef.current}px`
      if (projectSidebarPanelRef.current)
        projectSidebarPanelRef.current.style.width = width
      if (workspaceMainRef.current)
        workspaceMainRef.current.style.paddingLeft = width
    }
    const onMove = (e: MouseEvent) => {
      const d = projectSidebarDragRef.current
      if (!d) return
      e.preventDefault()
      const dx = e.clientX - d.startX
      projectSidebarDragWidthRef.current = clampProjectSidebarWidth(
        d.startWidth + dx
      )
      if (projectSidebarDragFrameRef.current === null) {
        projectSidebarDragFrameRef.current =
          window.requestAnimationFrame(applyDragWidth)
      }
    }
    const onUp = () => {
      if (!projectSidebarDragRef.current) return
      projectSidebarDragRef.current = null
      if (projectSidebarDragFrameRef.current !== null) {
        window.cancelAnimationFrame(projectSidebarDragFrameRef.current)
        projectSidebarDragFrameRef.current = null
      }
      const width = projectSidebarDragWidthRef.current
      if (projectSidebarPanelRef.current) {
        projectSidebarPanelRef.current.style.width = `${width}px`
        projectSidebarPanelRef.current.style.transition = ""
      }
      if (workspaceMainRef.current)
        workspaceMainRef.current.style.paddingLeft = `${width}px`
      setProjectSidebarWidth(width)
      setProjectSidebarDragging(false)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.body.classList.remove("gs-sidebar-resizing")
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      if (projectSidebarDragFrameRef.current !== null) {
        window.cancelAnimationFrame(projectSidebarDragFrameRef.current)
      }
    }
  }, [])
  const startProjectSidebarDrag = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      projectSidebarDragRef.current = {
        startX: e.clientX,
        startWidth: projectSidebarWidth,
      }
      projectSidebarDragWidthRef.current = projectSidebarWidth
      if (projectSidebarPanelRef.current)
        projectSidebarPanelRef.current.style.transition = "none"
      setProjectSidebarDragging(true)
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
      document.body.classList.add("gs-sidebar-resizing")
    },
    [projectSidebarWidth]
  )
  const focusedProjectIdsRef = useRef(focusedProjectIds)
  useEffect(() => {
    focusedProjectIdsRef.current = focusedProjectIds
    saveFocusedProjectIds(focusedProjectIds)
  }, [focusedProjectIds])
  useEffect(() => {
    const onAutoHideTitleBarChange = (event: Event) => {
      setAutoHideTitleBar((event as CustomEvent<boolean>).detail)
    }
    window.addEventListener(AUTO_HIDE_TITLE_BAR_EVENT, onAutoHideTitleBarChange)
    return () => {
      window.removeEventListener(
        AUTO_HIDE_TITLE_BAR_EVENT,
        onAutoHideTitleBarChange
      )
    }
  }, [])
  useEffect(() => {
    const onOpenFilesInOwnTabChange = (event: Event) => {
      setOpenFilesInOwnTab((event as CustomEvent<boolean>).detail)
    }
    window.addEventListener(
      OPEN_FILES_IN_OWN_TAB_EVENT,
      onOpenFilesInOwnTabChange
    )
    return () => {
      window.removeEventListener(
        OPEN_FILES_IN_OWN_TAB_EVENT,
        onOpenFilesInOwnTabChange
      )
    }
  }, [])
  useEffect(() => {
    const onProjectSidebarChatChange = (event: Event) => {
      setProjectSidebarChatEnabled((event as CustomEvent<boolean>).detail)
    }
    window.addEventListener(
      PROJECT_SIDEBAR_CHAT_EVENT,
      onProjectSidebarChatChange
    )
    return () => {
      window.removeEventListener(
        PROJECT_SIDEBAR_CHAT_EVENT,
        onProjectSidebarChatChange
      )
    }
  }, [])
  useEffect(() => {
    saveRightSidebarTab(rightSidebarTab)
  }, [rightSidebarTab])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [activeTreeFilePath, setActiveTreeFilePath] = useState("")
  // Pending "reveal this line" request from a content search hit. `seq` is a
  // nonce so re-selecting the same file/line still re-triggers the scroll.
  const [fileReveal, setFileReveal] = useState<FileReveal | null>(null)

  const restoredProjectId =
    restoredActiveProjectId &&
    projects.some((p) => p.id === restoredActiveProjectId)
      ? restoredActiveProjectId
      : null
  const routedProject = routeProjectId
    ? projects.find((p) => p.id === routeProjectId)
    : undefined
  const routedChatSpace = routeSpaceChatId
    ? spaces.find((space) => space.id === routeSpaceChatId)
    : undefined
  const isSpaceChatRoute = !!routedChatSpace
  const pendingProject = pendingNavigation?.projectId
    ? projects.find((p) => p.id === pendingNavigation.projectId)
    : undefined
  const hasPendingNavigation = pendingNavigation !== null
  const visibleSpaceId =
    routedChatSpace?.id ??
    pendingProject?.spaceId ??
    (hasPendingNavigation && pendingNavigation.projectId === null
      ? activeSpaceId
      : (routedProject?.spaceId ?? activeSpaceId))
  const activeSpaceProjects = useMemo(
    () => projects.filter((p) => p.spaceId === visibleSpaceId),
    [projects, visibleSpaceId]
  )
  const activeProjectId =
    (isSpaceChatRoute
      ? ""
      : pendingProject
        ? pendingProject.id
        : hasPendingNavigation && pendingNavigation.projectId === null
          ? ""
          : routedProject
            ? routedProject.id
            : restoredProjectId &&
                activeSpaceProjects.some((p) => p.id === restoredProjectId)
              ? restoredProjectId
              : activeSpaceProjects[0]?.id) ?? ""
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const activeProjectPath = activeProject?.path

  const openRightSidebar = useCallback(() => {
    setSidebarOpen(true)
  }, [])

  const toggleRightSidebar = useCallback(() => {
    setSidebarOpen((v) => !v)
  }, [])

  const toggleProjectSidebar = useCallback(() => {
    setProjectSidebarOpen((v) => !v)
  }, [])

  const confirmCloseAgentTerminals = async (count: number) => {
    if (count === 0) return true
    return window.dialogApi.confirmTerminalClose({ count })
  }

  const confirmCloseTabsWithAgents = (tabs: WorkspaceTab[]) =>
    confirmCloseAgentTerminals(countAgentTerminalPanes(tabs))

  useEffect(() => {
    const onFocus = () => {
      windowFocusedRef.current = true
    }
    const onBlur = () => {
      windowFocusedRef.current = false
    }
    window.addEventListener("focus", onFocus)
    window.addEventListener("blur", onBlur)
    const offNativeFocus = window.appWindow?.onFocus?.(onFocus)
    const offNativeBlur = window.appWindow?.onBlur?.(onBlur)
    return () => {
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("blur", onBlur)
      offNativeFocus?.()
      offNativeBlur?.()
    }
  }, [])

  const activeTabId = (() => {
    if (!activeProject) return ""
    if (
      pendingProject &&
      pendingNavigation?.tabId &&
      activeProject.tabs.some((t) => t.id === pendingNavigation.tabId)
    ) {
      return pendingNavigation.tabId
    }
    if (routeTabId && activeProject.tabs.some((t) => t.id === routeTabId)) {
      return routeTabId
    }
    if (
      activeProject.activeTabId &&
      activeProject.tabs.some((t) => t.id === activeProject.activeTabId)
    ) {
      return activeProject.activeTabId
    }
    return activeProject.tabs[0]?.id ?? ""
  })()
  const documentTitle = buildDocumentTitle(activeProject)

  useEffect(() => {
    document.title = documentTitle
  }, [documentTitle])

  const navigateToProject = useCallback(
    (id: string | null, tabId?: string) => {
      if (stateRestored) saveActiveProjectId(id ?? "")
      setPendingNavigation({ projectId: id, tabId })
      // Mark the switch as a non-urgent transition so React renders the new
      // workspace tree (all the kept-alive terminals re-evaluating isActive)
      // without blocking the main thread. Keeps sidebar animations like the
      // agent spinner ticking smoothly mid-switch.
      startTransition(() => {
        if (!id) {
          void navigate({ to: "/" })
          return
        }
        if (tabId) {
          void navigate({
            to: "/projects/$projectId/tabs/$tabId",
            params: { projectId: id, tabId },
          })
        } else {
          void navigate({
            to: "/projects/$projectId",
            params: { projectId: id },
          })
        }
      })
    },
    [navigate, stateRestored]
  )

  const navigateToSpaceChat = useCallback(
    (spaceId: string) => {
      if (!spaces.some((space) => space.id === spaceId)) return
      setActiveSpaceId(spaceId)
      setPendingNavigation(null)
      void navigate({
        to: "/spaces/$spaceId/chat",
        params: { spaceId },
      })
    },
    [navigate, spaces]
  )

  useEffect(() => {
    if (!pendingNavigation) return
    const currentProjectId = routeProjectId ?? null
    if (currentProjectId !== pendingNavigation.projectId) return
    if (
      pendingNavigation.projectId &&
      pendingNavigation.tabId &&
      routeTabId !== pendingNavigation.tabId
    ) {
      return
    }
    setPendingNavigation(null)
  }, [pendingNavigation, routeProjectId, routeTabId])

  const navigateToTab = useCallback(
    (tabId: string) => {
      if (!activeProjectId || !tabId) return
      void navigate({
        to: "/projects/$projectId/tabs/$tabId",
        params: { projectId: activeProjectId, tabId },
      })
    },
    [navigate, activeProjectId]
  )

  const goToLastTerminal = useCallback(() => {
    if (!activeProject) return
    const lastTerminalId = lastTerminalByProjectRef.current[activeProject.id]
    const terminal =
      activeProject.tabs.find(
        (t) => t.kind === "terminal" && t.id === lastTerminalId
      ) ?? activeProject.tabs.find((t) => t.kind === "terminal")
    if (terminal) navigateToTab(terminal.id)
  }, [activeProject, navigateToTab])

  const getTerminalPasteTarget = useCallback(() => {
    const visible = visibleTerminalRef.current
    if (visible) return visible
    if (!activeProject) return null

    const lastTerminalId = lastTerminalByProjectRef.current[activeProject.id]
    const terminal =
      activeProject.tabs.find(
        (t) => t.kind === "terminal" && t.id === lastTerminalId
      ) ?? activeProject.tabs.find((t) => t.kind === "terminal")
    if (!terminal || terminal.kind !== "terminal") return null

    const activePane = terminal.panes.find(
      (pane) => pane.id === terminal.activePaneId && pane.sessionId
    )
    const pane = activePane ?? terminal.panes.find((p) => p.sessionId)
    if (!pane?.sessionId) return null

    return {
      tabId: terminal.id,
      paneId: pane.id,
      sessionId: pane.sessionId,
    }
  }, [activeProject])

  const focusTerminalPasteTarget = useCallback(
    (target: { tabId: string; paneId: string }) => {
      if (!activeProjectId) return
      lastTerminalByProjectRef.current[activeProjectId] = target.tabId
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProjectId
            ? {
                ...p,
                tabs: p.tabs.map((t) =>
                  t.id === target.tabId && t.kind === "terminal"
                    ? { ...t, activePaneId: target.paneId }
                    : t
                ),
              }
            : p
        )
      )
      navigateToTab(target.tabId)
      terminalFocusRequestNonceRef.current += 1
      setTerminalFocusRequest({
        tabId: target.tabId,
        paneId: target.paneId,
        nonce: terminalFocusRequestNonceRef.current,
      })
    },
    [activeProjectId, navigateToTab]
  )

  const rememberAgentTerminal = useCallback(
    (projectId: string, tabId: string, paneId: string) => {
      const project = projectsRef.current.find((p) => p.id === projectId)
      if (!project) return
      const target = lastAgentTerminalFromPane(project, tabId, paneId)
      if (!target) return
      setLastAgentTerminals((prev) => {
        const next = { ...prev, [project.id]: target }
        saveLastAgentTerminals(next)
        return next
      })
    },
    []
  )

  const markProjectUpdated = useCallback((projectId: string) => {
    const updatedAt = Date.now()
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, updatedAt } : p))
    )
  }, [])

  // History tab "Summarize": send the user's last prompts to a terminal
  // running the chosen agent and ask it for a recap. Unlike Commit with AI
  // (which reuses the remembered last agent terminal), this targets the
  // picked agent — spinning up a fresh terminal for it when none is running.
  const summarizeHistory = useCallback(
    (agent: string) => {
      const project = projectsRef.current.find((p) => p.id === activeProjectId)
      if (!project) return
      void window.git.log(project.path, 10).then(async (res) => {
        if (!res.ok || res.commits.length === 0) {
          toast.error("No commits to summarize")
          return
        }
        markProjectUpdated(project.id)
        // Commits are newest-first; recap reads better oldest-first. Keep the
        // prompt single-line — raw newlines written to the PTY would submit
        // each line separately in agent TUIs.
        const ordered = [...res.commits].reverse()
        const list = ordered
          .map(
            (c, i) =>
              `${i + 1}) ${c.subject.replace(/\s+/g, " ").trim()} (${c.relativeDate})`
          )
          .join(" ")
        const prompt = `Recap what was worked on in this project based on the last ${ordered.length} git commits (listed oldest first below). Write it for a human catching up: group related commits into themes instead of listing them one-by-one, use plain conversational language, lead with the main things accomplished, and keep it brief (a short intro plus a handful of grouped bullets). Do not make any code changes. The commits: ${list}`

        window.focus()
        void window.appWindow?.focus?.()

        // Target a terminal already running the picked agent.
        for (const tab of project.tabs) {
          if (tab.kind !== "terminal") continue
          const pane = tab.panes.find(
            (pp) =>
              pp.agentStatus?.running &&
              pp.agentStatus.agentName === agent &&
              pp.sessionId
          )
          if (pane?.sessionId) {
            const sessionId = pane.sessionId
            setProjects((prev) =>
              prev.map((p) =>
                p.id === project.id
                  ? {
                      ...p,
                      activeTabId: tab.id,
                      tabs: p.tabs.map((t) =>
                        t.id === tab.id && t.kind === "terminal"
                          ? { ...t, activePaneId: pane.id }
                          : t
                      ),
                    }
                  : p
              )
            )
            navigateToProject(project.id, tab.id)
            terminalFocusRequestNonceRef.current += 1
            setTerminalFocusRequest({
              tabId: tab.id,
              paneId: pane.id,
              nonce: terminalFocusRequestNonceRef.current,
            })
            window.setTimeout(() => writeAgentPrompt(sessionId, prompt), 120)
            return
          }
        }

        toast.error(
          `Start a ${agent} terminal in this project first to summarize`
        )
      })
    },
    [activeProjectId, markProjectUpdated, navigateToProject]
  )

  // History tab "Summary": route a recap prompt to the terminal the user is
  // currently on (it must have a running agent). The prompt tells the agent to
  // fetch the project's recent chat history from the local history HTTP API and
  // summarize it.
  const summarizeChat = useCallback(
    async (range: HistoryRange) => {
      const project = projectsRef.current.find((p) => p.id === activeProjectId)
      if (!project) return

      // Target the terminal the user is currently on (active tab's active pane).
      // It must have a running agent — otherwise there's nothing to summarize to.
      const activeTab = project.tabs.find(
        (t) => t.kind === "terminal" && t.id === project.activeTabId
      )
      const activePane =
        activeTab?.kind === "terminal"
          ? activeTab.panes.find((p) => p.id === activeTab.activePaneId)
          : undefined
      if (!activePane?.agentStatus?.running || !activePane.sessionId) {
        toast.error("This terminal needs a running agent to summarize")
        return
      }
      markProjectUpdated(project.id)
      const { id: tabId } = activeTab!
      const { id: paneId, sessionId } = activePane

      window.focus()
      void window.appWindow?.focus?.()

      setProjects((prev) =>
        prev.map((p) =>
          p.id === project.id
            ? {
                ...p,
                activeTabId: tabId,
                tabs: p.tabs.map((t) =>
                  t.id === tabId && t.kind === "terminal"
                    ? { ...t, activePaneId: paneId }
                    : t
                ),
              }
            : p
        )
      )
      navigateToProject(project.id, tabId)
      terminalFocusRequestNonceRef.current += 1
      setTerminalFocusRequest({
        tabId,
        paneId,
        nonce: terminalFocusRequestNonceRef.current,
      })
      // Summarize the project's history (sidebar scope) into the focused agent.
      window.setTimeout(
        () =>
          void summarizeHistoryToAgent({
            sessionId,
            scope: { projectId: project.id },
            range,
          }),
        120
      )
    },
    [activeProjectId, markProjectUpdated, navigateToProject]
  )

  // History tab: clicking a message focuses the terminal whose session
  // submitted it (the per-pane GEARSHIFT_SESSION_ID stored on the message).
  const focusSession = useCallback(
    (sessionId: string) => {
      if (!sessionId) return
      for (const project of projectsRef.current) {
        for (const tab of project.tabs) {
          if (tab.kind !== "terminal") continue
          const pane = tab.panes.find(
            (pp) =>
              pp.sessionId === sessionId || pp.pendingSessionId === sessionId
          )
          if (!pane) continue
          setProjects((prev) =>
            prev.map((p) =>
              p.id === project.id
                ? {
                    ...p,
                    activeTabId: tab.id,
                    tabs: p.tabs.map((t) =>
                      t.id === tab.id && t.kind === "terminal"
                        ? { ...t, activePaneId: pane.id }
                        : t
                    ),
                  }
                : p
            )
          )
          navigateToProject(project.id, tab.id)
          terminalFocusRequestNonceRef.current += 1
          setTerminalFocusRequest({
            tabId: tab.id,
            paneId: pane.id,
            nonce: terminalFocusRequestNonceRef.current,
          })
          window.focus()
          void window.appWindow?.focus?.()
          return
        }
      }
      toast.error("That terminal is no longer open")
    },
    [navigateToProject]
  )

  useEffect(() => {
    if (!stateRestored) return
    if (isSpaceChatRoute) return
    saveActiveProjectId(activeProjectId)
    if (activeProjectPath)
      setPaletteRecents(pushRecentPaletteProject(activeProjectPath))
  }, [activeProjectId, activeProjectPath, isSpaceChatRoute, stateRestored])

  const dismissViewedTerminalNotifications = useCallback(
    (projectId: string, tabId: string, paneId: string) => {
      const set = agentDoneToastsByProjectRef.current.get(projectId)
      const doneToastId = agentDoneToastId(projectId, tabId, paneId)
      const attentionToastId = agentAttentionToastId(projectId, tabId, paneId)
      if (set) {
        for (const id of [doneToastId, attentionToastId]) {
          if (!set.has(id)) continue
          toast.dismiss(id)
          set.delete(id)
        }
        if (set.size === 0)
          agentDoneToastsByProjectRef.current.delete(projectId)
      }

      const hasRemainingProjectNotifications =
        (agentDoneToastsByProjectRef.current.get(projectId)?.size ?? 0) > 0

      // Important: this callback is used by effects that depend on activeProject.
      // Returning new project/tab objects when nothing changed creates a render
      // loop that makes terminal-heavy UI interactions feel laggy.
      setProjects((prev) => {
        let changed = false
        const next = prev.map((p) => {
          if (p.id !== projectId) return p

          const shouldClearProjectFlags =
            !hasRemainingProjectNotifications &&
            (p.agentDone || p.agentNeedsAttention)
          let tabChanged = false
          const tabs = p.tabs.map((t) => {
            if (t.id !== tabId || t.kind !== "terminal") return t

            let paneChanged = false
            const panes = t.panes.map((pane) => {
              const status = pane.id === paneId ? pane.agentStatus : undefined
              const clearCompleted = !!status?.completed
              const clearAttention = !!status?.needsAttention
              if (!clearCompleted && !clearAttention) return pane
              paneChanged = true
              return {
                ...pane,
                agentStatus: {
                  ...status,
                  completed: clearCompleted ? false : status?.completed,
                  completedAt: clearCompleted ? undefined : status?.completedAt,
                  needsAttention: clearAttention
                    ? false
                    : status?.needsAttention,
                },
              }
            })

            if (!paneChanged) return t
            tabChanged = true
            return { ...t, panes }
          })

          if (!shouldClearProjectFlags && !tabChanged) return p
          changed = true
          return {
            ...p,
            agentDone: hasRemainingProjectNotifications ? p.agentDone : false,
            agentNeedsAttention: hasRemainingProjectNotifications
              ? p.agentNeedsAttention
              : false,
            tabs: tabChanged ? tabs : p.tabs,
          }
        })

        return changed ? next : prev
      })
    },
    []
  )

  // Mirror unviewed agent completions as a red count badge on the dock icon,
  // driven by the same per-pane completed markers as the in-app indicators.
  // Viewing a flagged pane clears its marker, which shrinks/clears the badge.
  const completedAgentCount = useMemo(() => {
    let count = 0
    for (const p of projects) {
      for (const t of p.tabs) {
        if (t.kind !== "terminal") continue
        for (const pane of t.panes) {
          if (pane.agentStatus?.completed === true) count++
        }
      }
    }
    return count
  }, [projects])
  useEffect(() => {
    window.appWindow?.setBadgeCount(completedAgentCount).catch(() => null)
  }, [completedAgentCount])

  // The focus-change handler below only fires when the terminal gains focus,
  // so a completion that lands while the user is already viewing the pane (or
  // a tab switch without clicking into the terminal) would leave the done/
  // attention indicator stuck. Clear it whenever the flagged pane is the one
  // being viewed with the app focused.
  useEffect(() => {
    const clearIfViewing = () => {
      if (!isAppVisibleAndFocused()) return
      if (!activeProject || !activeTabId) return
      const tab = activeProject.tabs.find((t) => t.id === activeTabId)
      if (tab?.kind !== "terminal") return
      const pane = tab.panes.find((pp) => pp.id === tab.activePaneId)
      if (!pane) return
      if (pane.agentStatus?.completed || pane.agentStatus?.needsAttention) {
        dismissViewedTerminalNotifications(activeProject.id, tab.id, pane.id)
      }
    }
    clearIfViewing()
    window.addEventListener("focus", clearIfViewing)
    return () => window.removeEventListener("focus", clearIfViewing)
  }, [activeProject, activeTabId, dismissViewedTerminalNotifications])

  const handleTerminalFocusChange = useCallback(
    (tabId: string, paneId: string, focused: boolean) => {
      if (!focused) return
      const project = projectsRef.current.find((p) =>
        p.tabs.some((t) => t.id === tabId)
      )
      if (!project) return
      dismissViewedTerminalNotifications(project.id, tabId, paneId)
    },
    [dismissViewedTerminalNotifications]
  )

  useEffect(() => {
    if (!activeProjectId || !activeProjectPath || !activeTabId) return
    pushRecentPaletteTab(activeProjectPath, activeTabId)
  }, [activeProjectId, activeProjectPath, activeTabId])

  useEffect(() => {
    if (!activeProjectId || !activeTabId) return
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProjectId && p.activeTabId !== activeTabId
          ? { ...p, activeTabId }
          : p
      )
    )
  }, [activeProjectId, activeTabId])

  useEffect(() => {
    const activeTab = activeProject?.tabs.find((t) => t.id === activeTabId)
    if (!activeProject || !activeTabId || activeTab?.kind !== "terminal") {
      visibleTerminalRef.current = null
      return
    }
    lastTerminalByProjectRef.current[activeProject.id] = activeTab.id
    const activePane = activeTab.panes.find(
      (pp) => pp.id === activeTab.activePaneId
    )
    visibleTerminalRef.current =
      activePane?.sessionId != null
        ? {
            tabId: activeTab.id,
            paneId: activePane.id,
            sessionId: activePane.sessionId,
          }
        : null
    if (activePane?.agentStatus?.agentName || activePane?.agentSessionId) {
      rememberAgentTerminal(activeProject.id, activeTab.id, activePane.id)
    }
  }, [activeProject, activeTabId, rememberAgentTerminal])

  useEffect(() => {
    if (routeProjectId && !projects.some((p) => p.id === routeProjectId)) {
      navigateToProject(activeProjectId || null)
    }
  }, [routeProjectId, projects, activeProjectId, navigateToProject])

  useEffect(() => {
    if (!routeSpaceChatId) return
    if (spaces.some((space) => space.id === routeSpaceChatId)) return
    if (projectSidebarChatEnabled) {
      navigateToSpaceChat(activeSpaceId)
      return
    }
    const fallback =
      restoredProjectId &&
      projects.some(
        (project) =>
          project.id === restoredProjectId &&
          project.spaceId === activeSpaceId
      )
        ? restoredProjectId
        : (projects.find((project) => project.spaceId === activeSpaceId)?.id ??
          null)
    navigateToProject(fallback)
  }, [
    activeSpaceId,
    navigateToProject,
    navigateToSpaceChat,
    projectSidebarChatEnabled,
    projects,
    restoredProjectId,
    routeSpaceChatId,
    spaces,
  ])

  useEffect(() => {
    if (!stateRestored) return
    if (projectSidebarChatEnabled) return
    if (!isSpaceChatRoute) return
    const fallback =
      restoredProjectId &&
      activeSpaceProjects.some((project) => project.id === restoredProjectId)
        ? restoredProjectId
        : (activeSpaceProjects[0]?.id ?? null)
    navigateToProject(fallback)
  }, [
    activeSpaceProjects,
    isSpaceChatRoute,
    navigateToProject,
    projectSidebarChatEnabled,
    restoredProjectId,
    stateRestored,
  ])

  useEffect(() => {
    let next = recents
    for (const p of projects) {
      if (!next.some((r) => r.path === p.path)) {
        next = pushRecentProject({ name: p.name, path: p.path })
      }
    }
    if (next !== recents) setRecents(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    saveProjects(serializeProjects(projects))
  }, [projects])

  const openProjectByPath = useCallback(
    async (path: string, name?: string) => {
      const existing = projectsRef.current.find((p) => p.path === path)
      if (existing) {
        setActiveSpaceId(existing.spaceId)
        if (focusedProjectIdsRef.current.length > 0)
          setFocusedProjectIds((ids) =>
            ids.includes(existing.id) ? ids : [...ids, existing.id]
          )
        navigateToProject(existing.id, existing.activeTabId || undefined)
        return
      }
      const id = stableProjectId(path)
      const tabId = makeId()
      const paneId = makeId()
      const resolvedName = name || basename(path)
      setProjects((prev) => [
        ...prev,
        {
          id,
          name: resolvedName,
          path,
          spaceId: visibleSpaceId,
          updatedAt: Date.now(),
          tabs: [
            {
              kind: "terminal" as const,
              id: tabId,
              name: "Terminal 1",
              panes: [{ id: paneId, sessionId: paneId }],
              activePaneId: paneId,
            },
          ],
          activeTabId: tabId,
        },
      ])
      if (focusedProjectIdsRef.current.length > 0)
        setFocusedProjectIds((ids) => [...ids, id])
      navigateToProject(id, tabId)
      setRecents(pushRecentProject({ name: resolvedName, path }))

      await window.term.create({
        cwd: path,
        theme: resolvedTheme,
        projectId: id,
        sessionId: paneId,
      })
    },
    [navigateToProject, resolvedTheme, visibleSpaceId]
  )

  useEffect(() => {
    if (!stateRestored) return
    const openPaths = (paths: string[]) => {
      for (const path of paths) void openProjectByPath(path)
    }
    void window.appApi.takeOpenProjects().then(openPaths)
    const off = window.appApi.onOpenProjects(openPaths)
    return () => {
      off()
    }
  }, [openProjectByPath, stateRestored])

  const addProject = async () => {
    const path = await window.dialogApi.openProject()
    if (!path) return
    void openProjectByPath(path)
  }

  const pickRecent = (recent: RecentProject) => {
    void openProjectByPath(recent.path, recent.name)
  }

  const removeRecent = (recent: RecentProject) => {
    setRecents((current) => {
      const next = current.filter((r) => r.path !== recent.path)
      saveRecentProjects(next)
      return next
    })
  }

  const dropProjectFolders = async (paths: string[]) => {
    let skipped = 0
    for (const path of paths) {
      const stat = await window.fsApi.stat(path)
      if (!stat.ok || !stat.isDir) {
        skipped += 1
        continue
      }
      await openProjectByPath(path)
    }
    if (skipped > 0) {
      toast.info("Only folders can be added as projects")
    }
  }

  const selectProject = (id: string) => {
    const p = projects.find((x) => x.id === id)
    if (p?.spaceId) setActiveSpaceId(p.spaceId)
    navigateToProject(id, p?.activeTabId || undefined)
  }

  const createSpace = useCallback(
    (name?: string): string | null => {
      const trimmed =
        name === undefined
          ? (() => {
              const existingNames = new Set(
                spaces.map((space) => space.name.toLowerCase())
              )
              const base = "New Space"
              if (!existingNames.has(base.toLowerCase())) return base
              let index = 2
              while (existingNames.has(`${base} ${index}`.toLowerCase())) {
                index += 1
              }
              return `${base} ${index}`
            })()
          : name.trim()
      if (!trimmed) return null
      const existing = spaces.find(
        (space) => space.name.toLowerCase() === trimmed.toLowerCase()
      )
      if (existing) {
        setActiveSpaceId(existing.id)
        const nextProject = projects.find((p) => p.spaceId === existing.id)
        navigateToProject(nextProject?.id ?? null, nextProject?.activeTabId)
        toast.info(`Switched to ${existing.name}`)
        return existing.id
      }
      const id = `space-${makeId()}`
      const space: StoredSpace = {
        id,
        name: trimmed,
        createdAt: Date.now(),
      }
      setSpaces((prev) => [...prev, space])
      setActiveSpaceId(id)
      navigateToProject(null)
      return id
    },
    [navigateToProject, projects, spaces]
  )

  const renameSpace = useCallback(
    (id: string, name: string): boolean => {
      const trimmed = name.trim()
      if (!trimmed) return false
      const current = spaces.find((space) => space.id === id)
      if (!current) return false
      if (current.name === trimmed) return true
      const duplicate = spaces.some(
        (space) =>
          space.id !== id && space.name.toLowerCase() === trimmed.toLowerCase()
      )
      if (duplicate) {
        toast.error("A space with that name already exists")
        return false
      }
      setSpaces((prev) =>
        prev.map((space) =>
          space.id === id ? { ...space, name: trimmed } : space
        )
      )
      return true
    },
    [spaces]
  )

  const deleteSpace = useCallback(
    (id: string): boolean => {
      const space = spaces.find((candidate) => candidate.id === id)
      if (!space) return false
      if (id === DEFAULT_SPACE_ID) {
        toast.error("The default space cannot be deleted")
        return false
      }

      const nextProjects = projects.map((project) =>
        project.spaceId === id
          ? { ...project, spaceId: DEFAULT_SPACE_ID }
          : project
      )
      const nextProject =
        nextProjects.find(
          (project) =>
            project.id === activeProjectId &&
            project.spaceId === DEFAULT_SPACE_ID
        ) ??
        nextProjects.find((project) => project.spaceId === DEFAULT_SPACE_ID) ??
        null

      setProjects(nextProjects)
      setSpaces((prev) => prev.filter((candidate) => candidate.id !== id))
      setActiveSpaceId(DEFAULT_SPACE_ID)
      navigateToProject(nextProject?.id ?? null, nextProject?.activeTabId)
      toast.success(`Deleted ${space.name}`)
      return true
    },
    [activeProjectId, navigateToProject, projects, spaces]
  )

  const selectSpace = useCallback(
    (id: string) => {
      if (!spaces.some((space) => space.id === id)) return
      setActiveSpaceId(id)
      if (isSpaceChatRoute && projectSidebarChatEnabled) {
        navigateToSpaceChat(id)
        return
      }
      if (activeProject?.spaceId === id) return
      const nextProject = projects.find((p) => p.spaceId === id)
      navigateToProject(nextProject?.id ?? null, nextProject?.activeTabId)
    },
    [
      activeProject?.spaceId,
      isSpaceChatRoute,
      navigateToProject,
      navigateToSpaceChat,
      projectSidebarChatEnabled,
      projects,
      spaces,
    ]
  )

  const cycleSpace = useCallback(() => {
    if (spaces.length < 2) return
    const currentIndex = spaces.findIndex(
      (space) => space.id === visibleSpaceId
    )
    const nextSpace =
      spaces[((currentIndex >= 0 ? currentIndex : 0) + 1) % spaces.length]
    if (!nextSpace) return
    setActiveSpaceId(nextSpace.id)
    const nextProject = projects.find((p) => p.spaceId === nextSpace.id)
    navigateToProject(nextProject?.id ?? null, nextProject?.activeTabId)
  }, [navigateToProject, projects, spaces, visibleSpaceId])

  const moveProjectToSpace = useCallback(
    (projectId: string, spaceId: string) => {
      if (!spaces.some((space) => space.id === spaceId)) return
      const movedProject = projects.find((p) => p.id === projectId)
      if (!movedProject || movedProject.spaceId === spaceId) return
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, spaceId } : p))
      )
      if (projectId === activeProjectId) {
        setActiveSpaceId(spaceId)
        navigateToProject(projectId, movedProject.activeTabId)
      }
    },
    [activeProjectId, navigateToProject, projects, spaces]
  )

  const closeProject = async (id: string) => {
    const target = projects.find((p) => p.id === id)
    if (!target || !(await confirmCloseTabsWithAgents(target.tabs))) return
    setProjects((prev) => {
      const target = prev.find((p) => p.id === id)
      if (target) for (const t of target.tabs) killAllPanes(t)
      const next = prev.filter((p) => p.id !== id)
      if (id === activeProjectId) {
        const nextActive = next.find((p) => p.spaceId === visibleSpaceId)
        if (nextActive) {
          navigateToProject(nextActive.id, nextActive.activeTabId || undefined)
        } else {
          navigateToProject(null)
        }
      }
      return next
    })
  }

  const closeAllProjectTerminals = async (id: string) => {
    const project = projects.find((p) => p.id === id)
    const terminalTabs =
      project?.tabs.filter((t) => t.kind === "terminal") ?? []
    if (
      terminalTabs.length === 0 ||
      !(await confirmCloseTabsWithAgents(terminalTabs))
    ) {
      return
    }
    const terminalTabIds = new Set(terminalTabs.map((t) => t.id))
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p
        for (const t of p.tabs) {
          if (terminalTabIds.has(t.id)) killAllPanes(t)
        }
        const tabs = p.tabs.filter((t) => !terminalTabIds.has(t.id))
        const activeTabId = tabs.some((t) => t.id === p.activeTabId)
          ? p.activeTabId
          : (tabs[0]?.id ?? "")
        return {
          ...p,
          tabs,
          activeTabId,
          agentDone: false,
          agentNeedsAttention: false,
        }
      })
    )
    if (id === activeProjectId) {
      const project = projects.find((p) => p.id === id)
      const activeTab = project?.tabs.find((t) => t.id === project.activeTabId)
      if (activeTab?.kind !== "terminal") return
      const next = project?.tabs.find((t) => t.kind !== "terminal")?.id
      if (next) navigateToTab(next)
      else navigateToProject(id)
    }
  }

  const closeProjectsToRight = async (id: string) => {
    const scopedProjects = projects.filter((p) => p.spaceId === visibleSpaceId)
    const idx = scopedProjects.findIndex((p) => p.id === id)
    if (idx < 0) return
    const toClose = scopedProjects.slice(idx + 1)
    if (
      toClose.length === 0 ||
      !(await confirmCloseTabsWithAgents(toClose.flatMap((p) => p.tabs)))
    ) {
      return
    }
    const closedIds = new Set(toClose.map((p) => p.id))
    setProjects((prev) => {
      for (const p of prev) {
        if (!closedIds.has(p.id)) continue
        for (const t of p.tabs) killAllPanes(t)
      }
      const next = prev.filter((p) => !closedIds.has(p.id))
      if (closedIds.has(activeProjectId)) {
        const keep = next.find((p) => p.id === id)
        navigateToProject(id, keep?.activeTabId || undefined)
      }
      return next
    })
  }

  const openProjectInVSCode = (id: string) => {
    const target = projects.find((p) => p.id === id)
    if (!target) return
    void window.shellApi.openInVSCode(target.path)
  }

  const revealProjectInFinder = (id: string) => {
    const target = projects.find((p) => p.id === id)
    if (!target) return
    void window.shellApi.revealInFinder(target.path)
  }

  const reorderProjects = (fromId: string, toId: string) => {
    if (fromId === toId) return
    setProjects((prev) => {
      const from = prev.findIndex((p) => p.id === fromId)
      const to = prev.findIndex((p) => p.id === toId)
      if (from < 0 || to < 0) return prev
      const next = prev.slice()
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  const reorderTabs = (fromId: string, toId: string) => {
    if (fromId === toId || !activeProject) return
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== activeProjectId) return p
        const from = p.tabs.findIndex((t) => t.id === fromId)
        const to = p.tabs.findIndex((t) => t.id === toId)
        if (from < 0 || to < 0) return p
        const tabs = p.tabs.slice()
        const [moved] = tabs.splice(from, 1)
        tabs.splice(to, 0, moved)
        return { ...p, tabs }
      })
    )
  }

  const renamePane = (tabId: string, paneId: string, name: string) => {
    if (!activeProjectId) return
    const trimmed = name.trim()
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== activeProjectId) return p
        return {
          ...p,
          tabs: p.tabs.map((t) => {
            if (t.id !== tabId || t.kind !== "terminal") return t
            return {
              ...t,
              panes: t.panes.map((pp) => {
                if (pp.id !== paneId) return pp
                if (!trimmed) {
                  const next = { ...pp }
                  delete next.customName
                  return next
                }
                return { ...pp, customName: trimmed }
              }),
            }
          }),
        }
      })
    )
  }

  const dropPane = (
    tabId: string,
    movingPaneId: string,
    targetPaneId: string,
    zone: DropZone
  ) => {
    if (movingPaneId === targetPaneId || !activeProjectId) return
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== activeProjectId) return p
        return {
          ...p,
          tabs: p.tabs.map((t) => {
            if (t.id !== tabId || t.kind !== "terminal") return t
            const base = ensureLayout(
              t.layout,
              t.panes.map((pp) => pp.id)
            )
            // Center swaps the two panes; an edge moves the dragged pane into a
            // new split on that side of the target.
            const layout =
              zone === "center"
                ? swapLeaves(base, movingPaneId, targetPaneId)
                : moveLeafBeside(
                    base,
                    movingPaneId,
                    targetPaneId,
                    zone === "left" || zone === "right"
                      ? "horizontal"
                      : "vertical",
                    zone === "left" || zone === "top"
                  )
            return { ...t, layout }
          }),
        }
      })
    )
  }

  const extractPaneToTab = (tabId: string, paneId: string) => {
    if (!activeProjectId) return
    const source = activeProject?.tabs.find((t) => t.id === tabId)
    if (!source || source.kind !== "terminal" || source.panes.length <= 1)
      return
    if (!source.panes.some((pane) => pane.id === paneId)) return
    const newTabId = makeId()
    setOpeningTerminalTabId(newTabId)
    window.setTimeout(() => setOpeningTerminalTabId(null), 300)
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== activeProjectId) return p
        const sourceTab = p.tabs.find((t) => t.id === tabId)
        if (!sourceTab || sourceTab.kind !== "terminal") return p
        if (sourceTab.panes.length <= 1) return p
        const paneIndex = sourceTab.panes.findIndex(
          (pane) => pane.id === paneId
        )
        const pane = sourceTab.panes[paneIndex]
        if (!pane) return p

        const remainingPanes = sourceTab.panes.filter(
          (pane) => pane.id !== paneId
        )
        const sourceLayout = ensureLayout(
          sourceTab.layout,
          sourceTab.panes.map((pane) => pane.id)
        )
        const nextSourceLayout = removeLeaf(sourceLayout, paneId)
        const nextActivePaneId =
          sourceTab.activePaneId === paneId
            ? ((remainingPanes[paneIndex] ?? remainingPanes[paneIndex - 1])
                ?.id ??
              remainingPanes[0]?.id ??
              "")
            : sourceTab.activePaneId
        const terminalCount = p.tabs.filter((t) => t.kind === "terminal").length
        return {
          ...p,
          activeTabId: newTabId,
          tabs: [
            ...p.tabs.map((t) => {
              if (t.id !== tabId || t.kind !== "terminal") return t
              return {
                ...t,
                panes: remainingPanes,
                activePaneId: nextActivePaneId,
                ...(nextSourceLayout ? { layout: nextSourceLayout } : {}),
              }
            }),
            {
              kind: "terminal" as const,
              id: newTabId,
              name: paneDisplayName(pane, terminalCount),
              panes: [pane],
              activePaneId: pane.id,
            },
          ],
        }
      })
    )
    navigateToTab(newTabId)
  }

  const closeOtherProjects = async (keepId: string) => {
    const toClose = projects.filter(
      (p) => p.spaceId === visibleSpaceId && p.id !== keepId
    )
    if (!(await confirmCloseTabsWithAgents(toClose.flatMap((p) => p.tabs)))) {
      return
    }
    const closedIds = new Set(toClose.map((p) => p.id))
    setProjects((prev) => {
      for (const p of prev) {
        if (!closedIds.has(p.id)) continue
        for (const t of p.tabs) killAllPanes(t)
      }
      const next = prev.filter((p) => !closedIds.has(p.id))
      const keep = next.find((p) => p.id === keepId)
      navigateToProject(keepId, keep?.activeTabId || undefined)
      return next
    })
  }

  const addTerminal = async (
    agentName?: TerminalAgentName
  ): Promise<string | null> => {
    if (!activeProject) return null
    const project = activeProject
    const tabId = makeId()
    const paneId = makeId()
    setOpeningTerminalTabId(tabId)
    window.setTimeout(() => setOpeningTerminalTabId(null), 300)
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== project.id) return p
        const terminalCount = p.tabs.filter((t) => t.kind === "terminal").length
        const name = agentName
          ? AGENT_TERMINAL_LABELS[agentName]
          : `Terminal ${terminalCount + 1}`
        return {
          ...p,
          tabs: [
            ...p.tabs,
            {
              kind: "terminal" as const,
              id: tabId,
              name,
              panes: [
                {
                  id: paneId,
                  sessionId: paneId,
                  ...(agentName ? { agentName } : {}),
                },
              ],
              activePaneId: paneId,
            },
          ],
          activeTabId: tabId,
        }
      })
    )
    navigateToTab(tabId)

    await window.term.create({
      cwd: project.path,
      theme: resolvedTheme,
      projectId: project.id,
      sessionId: paneId,
    })
    if (agentName) {
      const command = agentTerminalCommand(
        agentName,
        getAgentTerminalOptions(agentName)
      )
      window.term.write(paneId, `${command}\r`)
    }
    return paneId
  }

  const expandedTerminalPaneByTabRef = useRef<Record<string, string | null>>({})
  const handleTerminalExpandedPaneChange = useCallback(
    (tabId: string, paneId: string | null) => {
      if (paneId) {
        expandedTerminalPaneByTabRef.current[tabId] = paneId
      } else {
        delete expandedTerminalPaneByTabRef.current[tabId]
      }
    },
    []
  )

  /** Add a new terminal pane to an existing terminal tab (Cmd+D / split). */
  const splitTerminalPane = useCallback(
    async (tabId: string, direction: SplitDirection = "horizontal") => {
      if (expandedTerminalPaneByTabRef.current[tabId]) return
      const project = projectsRef.current.find((p) => p.id === activeProjectId)
      const tab = project?.tabs.find((t) => t.id === tabId)
      if (!project || !tab || tab.kind !== "terminal") return
      // Show the split immediately with a locally generated session id and
      // spawn the PTY afterwards (same pattern as addTerminal) — awaiting the
      // daemon round-trip first makes Cmd+D feel laggy, especially while
      // agents keep the daemon busy.
      const paneId = makeId()
      setProjects((prev) =>
        prev.map((p) =>
          p.id === project.id
            ? {
                ...p,
                tabs: p.tabs.map((t) => {
                  if (t.id !== tabId || t.kind !== "terminal") return t
                  // Split the focused leaf in place (Ghostty-style nesting),
                  // so the new pane appears next to where the user was.
                  const base = ensureLayout(
                    t.layout,
                    t.panes.map((pp) => pp.id)
                  )
                  return {
                    ...t,
                    panes: [...t.panes, { id: paneId, sessionId: paneId }],
                    activePaneId: paneId,
                    layout: splitLeaf(base, t.activePaneId, paneId, direction),
                  }
                }),
              }
            : p
        )
      )
      await window.term.create({
        cwd: project.path,
        theme: resolvedTheme,
        projectId: project.id,
        sessionId: paneId,
      })
    },
    [activeProjectId, resolvedTheme]
  )

  /**
   * Quick split: spawn a fresh terminal beside a specific pane on the clicked
   * side. Used by the hold-modifiers-and-click split zones (terminal.quickSplitHold).
   */
  const quickSplitPane = useCallback(
    async (tabId: string, targetPaneId: string, zone: DropZone) => {
      if (zone === "center") return
      if (expandedTerminalPaneByTabRef.current[tabId]) return
      const project = projectsRef.current.find((p) => p.id === activeProjectId)
      const tab = project?.tabs.find((t) => t.id === tabId)
      if (!project || !tab || tab.kind !== "terminal") return
      // Same as splitTerminalPane: render the pane first, spawn the PTY after.
      const paneId = makeId()
      setProjects((prev) =>
        prev.map((p) =>
          p.id === project.id
            ? {
                ...p,
                tabs: p.tabs.map((t) => {
                  if (t.id !== tabId || t.kind !== "terminal") return t
                  const base = ensureLayout(
                    t.layout,
                    t.panes.map((pp) => pp.id)
                  )
                  return {
                    ...t,
                    panes: [...t.panes, { id: paneId, sessionId: paneId }],
                    activePaneId: paneId,
                    layout: insertBeside(
                      base,
                      targetPaneId,
                      paneId,
                      zone === "left" || zone === "right"
                        ? "horizontal"
                        : "vertical",
                      zone === "left" || zone === "top"
                    ),
                  }
                }),
              }
            : p
        )
      )
      await window.term.create({
        cwd: project.path,
        theme: resolvedTheme,
        projectId: project.id,
        sessionId: paneId,
      })
    },
    [activeProjectId, resolvedTheme]
  )

  /** Close a single pane within a terminal tab. Closes the tab if it was the last. */
  const closePane = useCallback(
    async (tabId: string, paneId: string) => {
      const tab = activeProject?.tabs.find((t) => t.id === tabId)
      if (!tab || tab.kind !== "terminal") return
      const pane = tab.panes.find((pp) => pp.id === paneId)
      if (!pane) return
      if (tab.panes.length <= 1) {
        // Last pane -> close the tab entirely; closeTab owns confirmation.
        closeTabRef.current?.(tabId)
        return
      }
      if (pane.agentStatus?.running && !(await confirmCloseAgentTerminals(1))) {
        return
      }
      if (!pane.pendingStart) {
        const sid = pane.sessionId
        try {
          if (sid) window.term.kill(sid)
        } catch {
          // ignore
        }
      }
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id !== activeProjectId) return p
          return {
            ...p,
            tabs: p.tabs.map((t) => {
              if (t.id !== tabId || t.kind !== "terminal") return t
              const panes = t.panes.filter((pp) => pp.id !== paneId)
              const base = ensureLayout(
                t.layout,
                t.panes.map((pp) => pp.id)
              )
              const layout = removeLeaf(base, paneId) ?? undefined
              const remaining = layout ? orderedPaneIds(layout) : []
              const nextActive =
                t.activePaneId === paneId
                  ? (remaining[remaining.length - 1] ?? "")
                  : t.activePaneId
              return { ...t, panes, activePaneId: nextActive, layout }
            }),
          }
        })
      )
    },
    [activeProject, activeProjectId]
  )

  const setActivePane = useCallback(
    (tabId: string, paneId: string) => {
      const project = projectsRef.current.find((p) => p.id === activeProjectId)
      const tab = project?.tabs.find(
        (t) => t.kind === "terminal" && t.id === tabId
      )
      const pane =
        tab?.kind === "terminal"
          ? tab.panes.find((pp) => pp.id === paneId)
          : undefined
      if (project && (pane?.agentStatus?.agentName || pane?.agentSessionId)) {
        rememberAgentTerminal(project.id, tabId, paneId)
      }
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProjectId
            ? {
                ...p,
                tabs: p.tabs.map((t) =>
                  t.id === tabId && t.kind === "terminal"
                    ? { ...t, activePaneId: paneId }
                    : t
                ),
              }
            : p
        )
      )
    },
    [activeProjectId, rememberAgentTerminal]
  )

  const setTerminalLayout = useCallback(
    (tabId: string, layout: TerminalLayout) => {
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProjectId
            ? {
                ...p,
                tabs: p.tabs.map((t) =>
                  t.id === tabId && t.kind === "terminal" ? { ...t, layout } : t
                ),
              }
            : p
        )
      )
    },
    [activeProjectId]
  )

  const openAgentDoneTarget = useCallback(
    (
      projectId: string,
      tabId: string,
      paneId: string,
      toastId?: string | number
    ) => {
      if (toastId !== undefined) toast.dismiss(toastId)
      window.focus()
      void window.appWindow?.focus?.()
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? {
                ...p,
                agentDone: false,
                agentNeedsAttention: false,
                activeTabId: tabId,
                tabs: p.tabs.map((t) =>
                  t.id === tabId && t.kind === "terminal"
                    ? { ...t, activePaneId: paneId }
                    : t
                ),
              }
            : p
        )
      )
      navigateToProject(projectId, tabId)
      terminalFocusRequestNonceRef.current += 1
      setTerminalFocusRequest({
        tabId,
        paneId,
        nonce: terminalFocusRequestNonceRef.current,
      })
    },
    [navigateToProject]
  )

  const openDiffTab = useCallback(
    (path: string, staged: boolean) => {
      if (!activeProject) return
      // Already open (pinned or preview) for the exact same path/staged — focus.
      const exact = activeProject.tabs.find(
        (t) => t.kind === "diff" && t.path === path && t.staged === staged
      )
      if (exact) {
        navigateToTab(exact.id)
        return
      }
      // Diff opens always reuse one shared preview tab so browsing changes does
      // not keep adding tabs.
      const preview = activeProject.tabs.find(
        (t) => t.kind === "diff" && t.preview
      )
      if (preview) {
        setProjects((prev) =>
          prev.map((p) =>
            p.id === activeProject.id
              ? {
                  ...p,
                  tabs: p.tabs.map((t) =>
                    t.id === preview.id && t.kind === "diff"
                      ? { ...t, path, staged, name: basename(path) }
                      : t
                  ),
                  activeTabId: preview.id,
                }
              : p
          )
        )
        navigateToTab(preview.id)
        return
      }
      const id = makeId()
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProject.id
            ? {
                ...p,
                tabs: [
                  ...p.tabs,
                  {
                    kind: "diff" as const,
                    id,
                    name: basename(path),
                    path,
                    staged,
                    preview: true,
                  },
                ],
                activeTabId: id,
              }
            : p
        )
      )
      navigateToTab(id)
    },
    [activeProject, navigateToTab]
  )

  const openFileTab = useCallback(
    (path: string, line?: number) => {
      if (!activeProject) return
      setActiveTreeFilePath(path)
      setPaletteRecents(pushRecentPaletteFile(activeProject.path, path))
      if (line != null) {
        setFileReveal((prev) => ({ path, line, seq: (prev?.seq ?? 0) + 1 }))
      }
      const exact = activeProject.tabs.find(
        (t) => t.kind === "file" && t.path === path
      )
      if (exact) {
        navigateToTab(exact.id)
        return
      }
      // File opens always reuse one shared preview tab so switching through the
      // file tree does not keep adding tabs.
      const preview = activeProject.tabs.find(
        (t) => t.kind === "file" && t.preview
      )
      if (preview) {
        setProjects((prev) =>
          prev.map((p) =>
            p.id === activeProject.id
              ? {
                  ...p,
                  tabs: p.tabs.map((t) =>
                    t.id === preview.id && t.kind === "file"
                      ? { ...t, path, name: basename(path) }
                      : t
                  ),
                  activeTabId: preview.id,
                }
              : p
          )
        )
        navigateToTab(preview.id)
        return
      }
      const id = makeId()
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProject.id
            ? {
                ...p,
                tabs: [
                  ...p.tabs,
                  {
                    kind: "file" as const,
                    id,
                    name: basename(path),
                    path,
                    preview: true,
                  },
                ],
                activeTabId: id,
              }
            : p
        )
      )
      navigateToTab(id)
    },
    [activeProject, navigateToTab]
  )

  const openDevPreviewTab = useCallback(
    (url: string) => {
      if (!activeProject) return
      const name = devPreviewName(url)
      const preview = activeProject.tabs.find((t) => t.kind === "devPreview")
      if (preview) {
        setProjects((prev) =>
          prev.map((p) =>
            p.id === activeProject.id
              ? {
                  ...p,
                  tabs: p.tabs.map((t) =>
                    t.id === preview.id && t.kind === "devPreview"
                      ? { ...t, url, name }
                      : t
                  ),
                  activeTabId: preview.id,
                }
              : p
          )
        )
        navigateToTab(preview.id)
        return
      }
      const id = makeId()
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProject.id
            ? {
                ...p,
                tabs: [
                  ...p.tabs,
                  {
                    kind: "devPreview" as const,
                    id,
                    name,
                    url,
                  },
                ],
                activeTabId: id,
              }
            : p
        )
      )
      navigateToTab(id)
    },
    [activeProject, navigateToTab]
  )

  const openCommitTab = useCallback(
    (commit: { hash: string; shortHash: string; subject: string }) => {
      if (!activeProject) return
      const exact = activeProject.tabs.find(
        (t) => t.kind === "commit" && t.hash === commit.hash
      )
      if (exact) {
        navigateToTab(exact.id)
        return
      }
      // Reuse the existing preview commit tab if any — unless the user opted
      // into a dedicated tab per diff/commit.
      const preview = openFilesInOwnTab
        ? undefined
        : activeProject.tabs.find((t) => t.kind === "commit" && t.preview)
      if (preview) {
        setProjects((prev) =>
          prev.map((p) =>
            p.id === activeProject.id
              ? {
                  ...p,
                  tabs: p.tabs.map((t) =>
                    t.id === preview.id && t.kind === "commit"
                      ? {
                          ...t,
                          hash: commit.hash,
                          shortHash: commit.shortHash,
                          name: commit.subject,
                        }
                      : t
                  ),
                  activeTabId: preview.id,
                }
              : p
          )
        )
        navigateToTab(preview.id)
        return
      }
      const id = makeId()
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProject.id
            ? {
                ...p,
                tabs: [
                  ...p.tabs,
                  {
                    kind: "commit" as const,
                    id,
                    name: commit.subject,
                    hash: commit.hash,
                    shortHash: commit.shortHash,
                    preview: !openFilesInOwnTab,
                  },
                ],
                activeTabId: id,
              }
            : p
        )
      )
      navigateToTab(id)
    },
    [activeProject, navigateToTab, openFilesInOwnTab]
  )

  /** Pin a preview tab so subsequent file clicks don't replace it. */
  const pinTab = (id: string) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProjectId
          ? {
              ...p,
              tabs: p.tabs.map((t) =>
                t.id === id &&
                (t.kind === "diff" || t.kind === "file" || t.kind === "commit")
                  ? { ...t, preview: false }
                  : t
              ),
            }
          : p
      )
    )
  }

  const startingTerminalsRef = useRef(new Set<string>())

  const startTerminalPane = useCallback(
    async (
      projectId: string,
      tabId: string,
      paneId: string,
      allowCreateFallback = true
    ) => {
      const project = projects.find((p) => p.id === projectId)
      const tab = project?.tabs.find((t) => t.id === tabId)
      if (!project || !tab || tab.kind !== "terminal") return
      const pane = tab.panes.find((pp) => pp.id === paneId)
      if (!pane || !pane.pendingStart) return

      const startKey = `${projectId}:${tabId}:${paneId}`
      if (startingTerminalsRef.current.has(startKey)) return
      startingTerminalsRef.current.add(startKey)

      try {
        // Try adoption first if we have a stored sessionId for this pane.
        // If the daemon was lost during an app/dev restart, create a replacement
        // so the terminal layout comes back instead of looking idle-stopped.
        let sessionId: string | null = null
        if (pane.pendingSessionId) {
          try {
            const res = await window.term.adopt(
              pane.pendingSessionId,
              project.id
            )
            if (res.ok) sessionId = pane.pendingSessionId
          } catch {
            // fall through to create only when user-initiated
          }
        }
        const runtimeAgent = pane.agentName ?? pane.agentStatus?.agentName
        const launchAgent = isLaunchableAgentName(runtimeAgent)
          ? runtimeAgent
          : undefined
        if (!sessionId) {
          if (!allowCreateFallback) return
          const { id } = await window.term.create({
            cwd: project.path,
            theme: resolvedTheme,
            projectId: project.id,
          })
          sessionId = id
          if (launchAgent) {
            const command = agentTerminalCommand(
              launchAgent,
              getAgentTerminalOptions(launchAgent),
              pane.agentSessionId
            )
            window.term.write(id, `${command}\r`)
          }
        }
        const newId = sessionId
        setProjects((prev) =>
          prev.map((p) => {
            if (p.id !== projectId) return p
            return {
              ...p,
              tabs: p.tabs.map((t) => {
                if (t.id !== tabId || t.kind !== "terminal") return t
                return {
                  ...t,
                  panes: t.panes.map((pp) =>
                    pp.id === paneId
                      ? {
                          ...pp,
                          // Keep pp.id (stable DOM key per types.ts); only
                          // assign the new daemon sessionId.
                          sessionId: newId,
                          pendingSessionId: undefined,
                          pendingStart: false,
                          ...(launchAgent ? { agentName: launchAgent } : {}),
                        }
                      : pp
                  ),
                  activePaneId: t.activePaneId,
                }
              }),
            }
          })
        )
      } finally {
        startingTerminalsRef.current.delete(startKey)
      }
    },
    [projects, resolvedTheme]
  )

  // Subscribe to onExit for every running pane so that when the daemon
  // force-stops a session (24 h idle sweep) or the user types `exit`, the
  // tab entry stays but the pane flips back to pendingStart and can be
  // restarted with the "Start terminal" button.
  useEffect(() => {
    const offs: Array<() => void> = []
    for (const project of projects) {
      for (const tab of project.tabs) {
        if (tab.kind !== "terminal") continue
        for (const pane of tab.panes) {
          if (!pane.sessionId || pane.pendingStart) continue
          const sid = pane.sessionId
          const off = window.term.onExit(sid, () => {
            setProjects((prev) =>
              prev.map((p) => {
                if (p.id !== project.id) return p
                return {
                  ...p,
                  tabs: p.tabs.map((t) => {
                    if (t.id !== tab.id || t.kind !== "terminal") return t
                    return {
                      ...t,
                      panes: t.panes.map((pp) =>
                        pp.sessionId === sid
                          ? {
                              ...pp,
                              sessionId: undefined,
                              pendingSessionId: undefined,
                              pendingStart: true,
                              agentStatus: pp.agentStatus
                                ? {
                                    ...pp.agentStatus,
                                    running: false,
                                    working: false,
                                    needsAttention: false,
                                    completed: false,
                                  }
                                : pp.agentStatus,
                            }
                          : pp
                      ),
                    }
                  }),
                }
              })
            )
          })
          offs.push(off)
        }
      }
    }
    return () => {
      for (const off of offs) off()
    }
  }, [projects])

  useEffect(() => {
    if (!activeProject || !activeTabId) return
    const activeTab = activeProject.tabs.find((t) => t.id === activeTabId)
    if (activeTab?.kind !== "terminal") return
    for (const pane of activeTab.panes) {
      if (pane.pendingStart && pane.pendingSessionId) {
        void startTerminalPane(activeProject.id, activeTab.id, pane.id)
      }
    }
  }, [activeProject, activeTabId, startTerminalPane])

  const selectTab = (id: string) => navigateToTab(id)

  const openFileFromCommandPalette = useCallback(
    (path: string, line?: number) => {
      openRightSidebar()
      setRightSidebarTab("files")
      setActiveTreeFilePath(path)
      openFileTab(path, line)
    },
    [openFileTab, openRightSidebar]
  )

  // Projects sorted most-recently-used first, for the compact project
  // switcher dropdown only. The tabs/sidebar keep their manual drag order.
  const switcherProjects = useMemo(() => {
    const order = new Map(paletteRecents.projects.map((path, i) => [path, i]))
    return [...activeSpaceProjects].sort(
      (a, b) =>
        (order.get(a.path) ?? Infinity) - (order.get(b.path) ?? Infinity)
    )
  }, [activeSpaceProjects, paletteRecents.projects])

  const commandPaletteRecents = useMemo<PaletteRecents>(() => {
    const projectsRecent = activeProjectPath
      ? [
          activeProjectPath,
          ...paletteRecents.projects.filter((p) => p !== activeProjectPath),
        ]
      : paletteRecents.projects
    const tabsByProject = { ...paletteRecents.tabsByProject }
    if (activeProjectPath && activeTabId) {
      tabsByProject[activeProjectPath] = [
        activeTabId,
        ...(tabsByProject[activeProjectPath] ?? []).filter(
          (id) => id !== activeTabId
        ),
      ]
    }
    return {
      ...paletteRecents,
      projects: projectsRecent,
      tabsByProject,
    }
  }, [activeProjectPath, activeTabId, paletteRecents])

  const setTerminalTitle = (tabId: string, paneId: string, title: string) => {
    setProjects((prev) => {
      // Bail without touching state when nothing changed — title events can
      // arrive at TUI repaint rate, and each state update here re-renders the
      // whole shell and rewrites the persisted snapshot.
      const tab = prev.flatMap((p) => p.tabs).find((t) => t.id === tabId)
      if (tab?.kind !== "terminal") return prev
      const pane = tab.panes.find((pp) => pp.id === paneId)
      if (!pane || pane.autoTitle === title) return prev
      const next = prev.map((p) =>
        p.tabs.some((t) => t.id === tabId)
          ? {
              ...p,
              tabs: p.tabs.map((t) =>
                t.id === tabId && t.kind === "terminal"
                  ? {
                      ...t,
                      panes: t.panes.map((pp) =>
                        pp.id === paneId ? { ...pp, autoTitle: title } : pp
                      ),
                    }
                  : t
              ),
            }
          : p
      )
      saveProjects(serializeProjects(next))
      return next
    })
  }

  const setTerminalAgentStatus = (
    tabId: string,
    paneId: string,
    status: TerminalAgentStatus
  ) => {
    const key = `${tabId}:${paneId}`
    const previousStatus = terminalAgentStatusRef.current.get(key)

    const targetProject = projects.find((p) =>
      p.tabs.some((t) => t.id === tabId)
    )
    const targetTab = targetProject?.tabs.find((t) => t.id === tabId)
    const fallbackPane =
      targetTab?.kind === "terminal"
        ? targetTab.panes.find((pp) => pp.id === paneId)
        : undefined
    const currentStatus = previousStatus ?? fallbackPane?.agentStatus
    if (agentStatusesEqual(currentStatus, status)) return

    terminalAgentStatusRef.current.set(key, status)
    const wasWorking = currentStatus?.working ?? false
    const finishedWork =
      wasWorking && !status.working && status.completed === true
    const wasNeedsAttention = currentStatus?.needsAttention ?? false
    const becameNeedsAttention =
      !wasNeedsAttention && status.needsAttention === true
    const appVisibleAndFocused = isAppVisibleAndFocused()
    const targetTerminalIsActive =
      !!targetProject &&
      targetProject.id === activeProjectId &&
      activeTabId === tabId &&
      targetTab?.kind === "terminal" &&
      targetTab.activePaneId === paneId &&
      appVisibleAndFocused
    const finishedAwayFromAttention =
      finishedWork && !!targetProject && !targetTerminalIsActive
    const needsAttentionAway =
      becameNeedsAttention && !!targetProject && !targetTerminalIsActive

    if (isLaunchableAgentName(status.agentName) && targetProject) {
      rememberAgentTerminal(targetProject.id, tabId, paneId)
    }

    setProjects((prev) =>
      prev.map((p) => {
        if (!p.tabs.some((t) => t.id === tabId)) return p

        const tabs = p.tabs.map((t) => {
          if (t.id !== tabId || t.kind !== "terminal") return t
          return {
            ...t,
            panes: t.panes.map((pp) =>
              pp.id === paneId
                ? {
                    ...pp,
                    agentStatus: status,
                    // Sticky: only overwrite when a hook actually reported an
                    // agent/id/title, so we never clobber a persisted value with
                    // undefined during status churn. Grok is runtime-only.
                    agentName: isLaunchableAgentName(status.agentName)
                      ? status.agentName
                      : pp.agentName,
                    agentSessionId: status.agentSessionId ?? pp.agentSessionId,
                    agentSessionTitle:
                      status.agentSessionTitle ?? pp.agentSessionTitle,
                  }
                : pp
            ),
          }
        })

        return {
          ...p,
          tabs,
          agentDone: status.working
            ? false
            : finishedAwayFromAttention
              ? true
              : p.agentDone,
          agentNeedsAttention: status.working
            ? false
            : needsAttentionAway
              ? true
              : p.agentNeedsAttention,
        }
      })
    )

    if (finishedWork && targetProject && targetTab?.kind === "terminal") {
      void queryClient.refetchQueries({
        queryKey: gitQueryKey(targetProject.path),
      })
      playAgentCompleteSound()
    }

    if (
      finishedAwayFromAttention &&
      targetProject &&
      targetTab?.kind === "terminal"
    ) {
      const elapsedTime =
        status.workStartedAt && status.completedAt
          ? formatDuration(status.completedAt - status.workStartedAt)
          : null
      const toastId = agentDoneToastId(targetProject.id, tabId, paneId)
      const toastsForProject =
        agentDoneToastsByProjectRef.current.get(targetProject.id) ?? new Set()
      toastsForProject.add(toastId)
      agentDoneToastsByProjectRef.current.set(
        targetProject.id,
        toastsForProject
      )
      const showCompletionNotification = (latestPrompt: string | null) => {
        console.info("Agent complete: showing in-app toast")
        toast.custom(
          (id) =>
            agentToastCard({
              id,
              projectName: targetProject.name,
              projectPath: targetProject.path,
              statusLabel: "Agent finished",
              statusMeta: elapsedTime ? `Completed in ${elapsedTime}` : null,
              bodyPreview: latestPrompt,
              onOpen: () =>
                openAgentDoneTarget(targetProject.id, tabId, paneId, id),
            }),
          {
            id: toastId,
            duration: Infinity,
            onDismiss: () => {
              const set = agentDoneToastsByProjectRef.current.get(
                targetProject.id
              )
              set?.delete(toastId)
              if (set && set.size === 0) {
                agentDoneToastsByProjectRef.current.delete(targetProject.id)
              }
            },
            onAutoClose: () => {
              const set = agentDoneToastsByProjectRef.current.get(
                targetProject.id
              )
              set?.delete(toastId)
              if (set && set.size === 0) {
                agentDoneToastsByProjectRef.current.delete(targetProject.id)
              }
            },
          }
        )

        if (!appVisibleAndFocused) {
          console.info("Agent complete: also showing desktop notification")
          // Keep bouncing the dock until the user returns to the app.
          window.appWindow?.bounceDock("critical").catch(() => null)
          if (typeof Notification !== "undefined") {
            try {
              const notification = new Notification(
                targetProject.name || "GearShift",
                {
                  // Title: project name. Body: last chat message only.
                  body: latestPrompt || undefined,
                  silent: true,
                }
              )
              notification.onclick = () => {
                openAgentDoneTarget(targetProject.id, tabId, paneId)
              }
            } catch (err) {
              console.warn("Desktop notification failed", err)
            }
          }
        }
      }

      const historySessionId = fallbackPane?.sessionId ?? paneId
      void window.term.history
        .list(historySessionId)
        .then((rows) => promptPreview(latestPromptBody(rows)))
        .catch(() => null)
        .then(showCompletionNotification)
    }

    if (needsAttentionAway && targetProject && targetTab?.kind === "terminal") {
      playAgentCompleteSound()

      const terminalName = tabDisplayName(targetTab)
      const toastId = agentAttentionToastId(targetProject.id, tabId, paneId)
      const toastsForProject =
        agentDoneToastsByProjectRef.current.get(targetProject.id) ?? new Set()
      toastsForProject.add(toastId)
      agentDoneToastsByProjectRef.current.set(
        targetProject.id,
        toastsForProject
      )
      console.info("Agent needs attention: showing in-app toast")
      const cleanupToast = () => {
        const set = agentDoneToastsByProjectRef.current.get(targetProject.id)
        set?.delete(toastId)
        if (set && set.size === 0) {
          agentDoneToastsByProjectRef.current.delete(targetProject.id)
        }
      }
      const showNeedsInputNotification = (latestPrompt: string | null) => {
        toast.custom(
          (id) =>
            agentToastCard({
              id,
              projectName: targetProject.name,
              projectPath: targetProject.path,
              statusLabel: "Agent needs input",
              statusMeta: terminalName,
              bodyPreview: latestPrompt,
              onOpen: () =>
                openAgentDoneTarget(targetProject.id, tabId, paneId, id),
            }),
          {
            id: toastId,
            duration: Infinity,
            onDismiss: cleanupToast,
            onAutoClose: cleanupToast,
          }
        )
      }
      const historySessionId = fallbackPane?.sessionId ?? paneId
      void window.term.history
        .list(historySessionId)
        .then((rows) => promptPreview(latestPromptBody(rows)))
        .catch(() => null)
        .then(showNeedsInputNotification)

      if (!appVisibleAndFocused) {
        // Keep bouncing the dock until the user returns — input is required.
        window.appWindow?.bounceDock("critical").catch(() => null)
      }

      if (!appVisibleAndFocused && typeof Notification !== "undefined") {
        try {
          const notification = new Notification(
            targetProject.name || "GearShift",
            {
              body: `Agent needs input in ${terminalName}`,
              silent: true,
            }
          )
          notification.onclick = () => {
            openAgentDoneTarget(targetProject.id, tabId, paneId)
          }
        } catch (err) {
          console.warn("Desktop notification failed", err)
        }
      }
    }
  }

  const renameTab = (tabId: string, name: string) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProjectId
          ? {
              ...p,
              tabs: p.tabs.map((t) =>
                t.id === tabId && t.kind === "terminal"
                  ? { ...t, customName: name || undefined }
                  : t
              ),
            }
          : p
      )
    )
  }

  const closeTab = async (id: string) => {
    const tab = activeProject?.tabs.find((t) => t.id === id)
    if (tab && !(await confirmCloseTabsWithAgents([tab]))) {
      return
    }
    if (tab) killAllPanes(tab)
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== activeProjectId) return p
        const closingIdx = p.tabs.findIndex((t) => t.id === id)
        const tabs = p.tabs.filter((t) => t.id !== id)
        let nextActive = p.activeTabId
        if (p.activeTabId === id) {
          const nextIdx = Math.max(0, closingIdx - 1)
          nextActive = tabs[nextIdx]?.id ?? ""
        }
        return { ...p, tabs, activeTabId: nextActive }
      })
    )
    if (id === activeTabId) {
      const closingIdx = activeProject?.tabs.findIndex((t) => t.id === id) ?? -1
      const remaining = activeProject?.tabs.filter((t) => t.id !== id) ?? []
      const nextIdx = Math.max(0, closingIdx - 1)
      const next = remaining[nextIdx]?.id
      if (next) navigateToTab(next)
      else if (activeProjectId) navigateToProject(activeProjectId)
    }
  }

  const closeTabsToRight = async (id: string) => {
    if (!activeProject) return
    const idx = activeProject.tabs.findIndex((t) => t.id === id)
    if (idx < 0) return
    const toClose = activeProject.tabs.slice(idx + 1)
    if (toClose.length === 0) return
    if (!(await confirmCloseTabsWithAgents(toClose))) return
    for (const t of toClose) killAllPanes(t)
    const closedIds = new Set(toClose.map((t) => t.id))
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== activeProjectId) return p
        const tabs = p.tabs.filter((t) => !closedIds.has(t.id))
        const nextActive = closedIds.has(p.activeTabId)
          ? (tabs[tabs.length - 1]?.id ?? "")
          : p.activeTabId
        return { ...p, tabs, activeTabId: nextActive }
      })
    )
    if (closedIds.has(activeTabId)) navigateToTab(id)
  }

  const closeOtherTabs = async (keepId: string) => {
    if (!activeProject) return
    const toClose = activeProject.tabs.filter((t) => t.id !== keepId)
    if (toClose.length === 0) return
    if (!(await confirmCloseTabsWithAgents(toClose))) return
    const closedIds = new Set(toClose.map((t) => t.id))
    for (const t of toClose) killAllPanes(t)
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== activeProjectId) return p
        const tabs = p.tabs.filter((t) => !closedIds.has(t.id))
        return {
          ...p,
          tabs,
          activeTabId: tabs.some((t) => t.id === keepId)
            ? keepId
            : (tabs[0]?.id ?? ""),
        }
      })
    )
    if (activeTabId !== keepId) navigateToTab(keepId)
  }

  const closeAllTabs = async () => {
    if (!activeProject) return
    if (!(await confirmCloseTabsWithAgents(activeProject.tabs))) return
    const closedIds = new Set(activeProject.tabs.map((t) => t.id))
    for (const t of activeProject.tabs) killAllPanes(t)
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== activeProjectId) return p
        const tabs = p.tabs.filter((t) => !closedIds.has(t.id))
        const activeTabId = tabs.some((t) => t.id === p.activeTabId)
          ? p.activeTabId
          : (tabs[0]?.id ?? "")
        return { ...p, tabs, activeTabId }
      })
    )
    navigateToProject(activeProjectId)
  }
  const addTerminalRef = useRef<
    (agentName?: TerminalAgentName) => Promise<string | null>
  >(async () => null)
  const closeActiveTabRef = useRef<() => void>(() => undefined)
  const splitActiveTerminalRef = useRef<
    (direction?: "horizontal" | "vertical") => void
  >(() => undefined)
  const goToLastTerminalRef = useRef<() => void>(() => undefined)
  const copyActiveTerminalPathRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    addTerminalRef.current = addTerminal
    goToLastTerminalRef.current = goToLastTerminal
    closeActiveTabRef.current = () => {
      if (!activeTabId) return
      const active = activeProject?.tabs.find((t) => t.id === activeTabId)
      if (
        active?.kind === "terminal" &&
        active.panes.length > 1 &&
        active.activePaneId
      ) {
        closePane(activeTabId, active.activePaneId)
        return
      }
      closeTab(activeTabId)
    }
    splitActiveTerminalRef.current = (direction = "horizontal") => {
      if (!activeProject) return
      const hasTerminal = activeProject.tabs.some((t) => t.kind === "terminal")
      if (!hasTerminal) {
        addTerminalRef.current()
        return
      }
      if (!activeTabId) return
      const active = activeProject.tabs.find((t) => t.id === activeTabId)
      if (active?.kind === "terminal") {
        void splitTerminalPane(activeTabId, direction)
      }
    }
    copyActiveTerminalPathRef.current = () => {
      const active = activeProject?.tabs.find((t) => t.id === activeTabId)
      if (active?.kind !== "terminal") return
      const pane =
        active.panes.find((pp) => pp.id === active.activePaneId) ??
        active.panes[0]
      if (!pane?.sessionId) return
      void window.term.getCwd(pane.sessionId).then(async (cwd) => {
        if (!cwd) {
          toast.error("Couldn't read the terminal's current path")
          return
        }
        await navigator.clipboard.writeText(cwd)
        toast.success("Path copied to clipboard")
      })
    }
    closeTabRef.current = closeTab
  })

  useEffect(() => {
    const offNew = window.appApi.onNewTerminal(() => addTerminalRef.current())
    const offClose = window.appApi.onCloseTerminal(() =>
      closeActiveTabRef.current()
    )
    return () => {
      offNew()
      offClose()
    }
  }, [])

  const { bindings, findActionForEvent } = useKeybindings()
  const projectSidebarShortcut = acceleratorLabel(
    bindings["projectSidebar.toggle"]?.[0] ?? ""
  )
  const rightSidebarShortcut = acceleratorLabel(
    bindings["sidebar.toggle"]?.[0] ?? ""
  )
  const paletteShortcut = acceleratorLabel(bindings["palette.open"]?.[0] ?? "")
  useEffect(() => {
    // True when focus already lives somewhere that consumes typing — a real
    // input/editor or the terminal itself — so we must not hijack the keystroke.
    const focusConsumesTyping = (target: HTMLElement | null) =>
      isTextEditingTarget(target) || !!target?.closest(".xterm")

    // Move focus to the visible terminal pane (if any) via the focus-request
    // nonce. Returns its sessionId so the caller can also forward the keystroke.
    const focusVisibleTerminal = () => {
      const visible = visibleTerminalRef.current
      if (!visible) return null
      terminalFocusRequestNonceRef.current += 1
      setTerminalFocusRequest({
        tabId: visible.tabId,
        paneId: visible.paneId,
        nonce: terminalFocusRequestNonceRef.current,
      })
      return visible.sessionId
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null
      if (target?.dataset?.keycapture === "true") return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.shiftKey && !e.altKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault()
        openRightSidebar()
        setRightSidebarTab("files")
        window.requestAnimationFrame(() => {
          window.dispatchEvent(new Event("gearshift:file-search"))
        })
        return
      }
      if (
        e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === "z" || e.key === "Z") &&
        !isTextEditingTarget(target)
      ) {
        e.preventDefault()
        return
      }
      // Let focused controls/editors handle their own shortcuts first. For
      // example, CodeMirror's Mod+S save binding calls preventDefault(), so the
      // sidebar shortcut should not also run while the editor handles saving.
      if (e.defaultPrevented) return
      const action = findActionForEvent(e)
      if (!action) {
        // No shortcut matched. If the user just typed a plain printable
        // character while focus is idle (not an input/editor/terminal),
        // redirect it into the visible terminal so typing "just works".
        if (
          e.key.length === 1 &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey &&
          !focusConsumesTyping(target)
        ) {
          const sessionId = focusVisibleTerminal()
          if (sessionId) {
            e.preventDefault()
            window.term.write(sessionId, e.key)
          }
        }
        return
      }
      switch (action) {
        case "sidebar.toggle":
          e.preventDefault()
          toggleRightSidebar()
          break
        case "projectSidebar.toggle":
          e.preventDefault()
          toggleProjectSidebar()
          break
        case "palette.open":
          e.preventDefault()
          setPaletteOpen((v) => !v)
          break
        case "terminal.new":
          if (matchesAccelerator(bindings["terminal.new"][0] ?? "", e)) return
          e.preventDefault()
          addTerminalRef.current()
          break
        case "terminal.close":
          if (matchesAccelerator(bindings["terminal.close"][0] ?? "", e)) return
          e.preventDefault()
          closeActiveTabRef.current()
          break
        case "terminal.split":
          e.preventDefault()
          splitActiveTerminalRef.current("horizontal")
          break
        case "terminal.splitVertical":
          e.preventDefault()
          splitActiveTerminalRef.current("vertical")
          break
        case "terminal.last":
          e.preventDefault()
          goToLastTerminalRef.current()
          break
        case "terminal.copyPath":
          e.preventDefault()
          copyActiveTerminalPathRef.current()
          break
        case "nav.back":
          // Skip in real text fields so Cmd+Shift+Arrow keeps extending the
          // selection there; the terminal is allowed to navigate.
          if (isTextEditingTarget(target)) return
          e.preventDefault()
          router.history.back()
          break
        case "nav.forward":
          if (isTextEditingTarget(target)) return
          e.preventDefault()
          router.history.forward()
          break
        case "spaces.cycle":
          e.preventDefault()
          cycleSpace()
          break
        case "settings.open":
          e.preventDefault()
          void navigate({ to: "/settings" })
          break
        case "titlebar.togglePin":
          e.preventDefault()
          saveAutoHideTitleBar(!autoHideTitleBar)
          break
        case "theme.cycle": {
          e.preventDefault()
          // Cycle to the next theme family. Because setThemeFamily keeps the
          // current mode (light/dark), this effectively cycles through the
          // themes of whichever appearance is active.
          const current = THEME_FAMILIES.findIndex((f) => f.id === themeFamily)
          const next = THEME_FAMILIES[(current + 1) % THEME_FAMILIES.length]
          setThemeFamily(next.id)
          break
        }
        default:
          break
      }
    }
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented) return
      const target = e.target instanceof HTMLElement ? e.target : null
      const activeElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      if (target?.dataset?.keycapture === "true") return
      if (
        focusConsumesTyping(target) ||
        (activeElement !== target && focusConsumesTyping(activeElement))
      ) {
        return
      }

      const terminalTarget = getTerminalPasteTarget()
      if (!terminalTarget) return

      e.preventDefault()
      focusTerminalPasteTarget(terminalTarget)
      requestTerminalClipboardPaste(
        terminalTarget.sessionId,
        e.clipboardData?.getData("text/plain") || undefined
      )
    }

    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("paste", onPaste)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("paste", onPaste)
    }
  }, [
    bindings,
    findActionForEvent,
    navigate,
    router,
    autoHideTitleBar,
    openRightSidebar,
    toggleRightSidebar,
    toggleProjectSidebar,
    cycleSpace,
    themeFamily,
    setThemeFamily,
    getTerminalPasteTarget,
    focusTerminalPasteTarget,
  ])

  const sidebarTopActions = useMemo(
    () => (
      <div className="flex items-center pr-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={toggleRightSidebar}
                aria-pressed={sidebarOpen}
                aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                className="grid size-5 place-items-center rounded-sm text-foreground transition-colors hover:bg-foreground/15"
              >
                <PanelRight className="size-3.5" />
              </button>
            }
          />
          <TooltipContent>
            {(sidebarOpen ? "Hide sidebar" : "Show sidebar") +
              (rightSidebarShortcut ? ` (${rightSidebarShortcut})` : "")}
          </TooltipContent>
        </Tooltip>
      </div>
    ),
    [sidebarOpen, toggleRightSidebar, rightSidebarShortcut]
  )

  return (
    <div className="relative flex h-svh flex-row bg-background text-foreground">
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        projects={projects}
        activeProject={activeProject}
        paletteRecents={commandPaletteRecents}
        onSelectProject={selectProject}
        onSelectTab={selectTab}
        onOpenFile={openFileFromCommandPalette}
      />
      {/* The sidebar is an absolutely-positioned overlay that slides with a
          compositor-only transform, while the workspace reserves its space via
          a paddingLeft that SNAPS (no transition). Animating layout (the old
          margin-left slide) relayouts the whole workspace every frame and the
          terminal reflow at the end lands as a visible hitch; with a transform
          slide the main-thread reflow happens under a still-smooth animation. */}
      <div
        ref={projectSidebarPanelRef}
        aria-hidden={!projectSidebarOpen}
        style={{
          width: projectSidebarWidth,
          transform: projectSidebarOpen ? "translateX(0)" : "translateX(-100%)",
        }}
        className={cn(
          "absolute inset-y-0 left-0 z-20 bg-background [-webkit-app-region:no-drag]",
          !projectSidebarDragging &&
            "transition-transform duration-200 ease-in-out",
          !projectSidebarOpen && "pointer-events-none"
        )}
      >
        {/* Drag handle on the right edge — dragging right widens the sidebar. */}
        <div
          onMouseDown={projectSidebarOpen ? startProjectSidebarDrag : undefined}
          onDoubleClick={
            projectSidebarOpen
              ? () => setProjectSidebarWidth(PROJECT_SIDEBAR_DEFAULT_PX)
              : undefined
          }
          role="separator"
          aria-orientation="vertical"
          aria-hidden={!projectSidebarOpen}
          className={cn(
            "group absolute inset-y-0 right-0 z-20 w-2 translate-x-1/2 cursor-col-resize touch-none",
            !projectSidebarOpen && "pointer-events-none"
          )}
        >
          <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-foreground/30 group-active:bg-foreground/40" />
        </div>
        <ProjectSidebar
          projects={activeSpaceProjects}
          activeId={activeProjectId}
          spaces={spaces}
          activeSpaceId={visibleSpaceId}
          chatActive={isSpaceChatRoute}
          recents={recents.filter((r) =>
            // In focus mode, open-but-unfocused projects stay listed so they
            // can be re-added to the focus list.
            focusedProjectIds.length > 0
              ? !projects.some(
                  (p) => p.path === r.path && focusedProjectIds.includes(p.id)
                )
              : !projects.some((p) => p.path === r.path)
          )}
          onSelect={selectProject}
          onSelectSpace={selectSpace}
          onOpenSpaceChat={
            projectSidebarChatEnabled
              ? () => navigateToSpaceChat(visibleSpaceId)
              : undefined
          }
          onCreateSpace={createSpace}
          onRenameSpace={renameSpace}
          onDeleteSpace={deleteSpace}
          onMoveProjectToSpace={moveProjectToSpace}
          onAdd={addProject}
          onDropFolders={(paths) => void dropProjectFolders(paths)}
          onPickRecent={pickRecent}
          onRemoveRecent={removeRecent}
          onClose={closeProject}
          onCloseAllTerminals={closeAllProjectTerminals}
          onCloseOthers={closeOtherProjects}
          onCloseToRight={closeProjectsToRight}
          onOpenInVSCode={openProjectInVSCode}
          onRevealInFinder={revealProjectInFinder}
          onReorder={reorderProjects}
          onCollapse={() => setProjectSidebarOpen(false)}
          onOpenCommandPalette={() => setPaletteOpen(true)}
          onOpenSettings={() => void navigate({ to: "/settings" })}
          focusedProjectIds={focusedProjectIds}
          onFocusProject={(id) => {
            setFocusedProjectIds([id])
            selectProject(id)
          }}
          onRemoveFromFocus={(id) =>
            setFocusedProjectIds((ids) => ids.filter((x) => x !== id))
          }
          onExitFocus={() => setFocusedProjectIds([])}
        />
      </div>
      <div
        ref={workspaceMainRef}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
        style={{ paddingLeft: projectSidebarOpen ? projectSidebarWidth : 0 }}
      >
        {(() => {
          const toggleSidebar = () => {
            toggleRightSidebar()
          }
          const openChanges = () => {
            setRightSidebarTab("git")
            openRightSidebar()
          }
          // Vertical layout with the project sidebar collapsed: show an expand
          // control (and reclaim the traffic-light gap) in the top bar.
          const projectSidebarCollapsed = !projectSidebarOpen
          const expandProjectSidebarButton = projectSidebarCollapsed ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => setProjectSidebarOpen(true)}
                    aria-label="Expand sidebar"
                    className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors [-webkit-app-region:no-drag] hover:bg-foreground/15 hover:text-foreground"
                  >
                    <PanelLeft className="size-3.5" />
                  </button>
                }
              />
              <TooltipContent>
                {"Expand sidebar" +
                  (projectSidebarShortcut
                    ? ` (${projectSidebarShortcut})`
                    : "")}
              </TooltipContent>
            </Tooltip>
          ) : null
          // When the project sidebar is collapsed its search control is hidden
          // too, so surface it next to the expand button in the top bar.
          const collapsedSearchButton = projectSidebarCollapsed ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => setPaletteOpen(true)}
                    aria-label="Search"
                    className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors [-webkit-app-region:no-drag] hover:bg-foreground/15 hover:text-foreground"
                  >
                    <Search className="size-3.5" />
                  </button>
                }
              />
              <TooltipContent>
                {"Search" + (paletteShortcut ? ` (${paletteShortcut})` : "")}
              </TooltipContent>
            </Tooltip>
          ) : null
          const titleBar = (
            <AutoHideTitleBar enabled={autoHideTitleBar && !!activeProject}>
              <TitleBar
                projects={projects}
                activeProjectId={activeProjectId}
                sidebarOpen={sidebarOpen}
                onToggleSidebar={toggleSidebar}
                onOpenChanges={openChanges}
                showRightControls={!sidebarOpen || !activeProject}
                showTrafficLightSpacer={projectSidebarCollapsed}
                leading={
                  expandProjectSidebarButton ? (
                    <div className="flex items-center gap-0.5 pr-2 [-webkit-app-region:no-drag]">
                      {expandProjectSidebarButton}
                      {collapsedSearchButton}
                    </div>
                  ) : undefined
                }
              />
            </AutoHideTitleBar>
          )
          // In the vertical project layout the workspace tab bar doubles as the
          // top bar, so the window controls (changes badge + sidebar toggle) live
          // inline at its right edge. Mirror the title bar's gate: hide them when
          // the right sidebar is open (it carries its own controls then).
          const showTopBarControls = !sidebarOpen || !activeProject
          const topBarTrailing = showTopBarControls ? (
            <div className="flex items-center pr-4 [-webkit-app-region:no-drag]">
              <ProjectGitStatusBadge
                cwd={activeProject?.path ?? null}
                onOpenChanges={openChanges}
              />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={toggleSidebar}
                      aria-pressed={sidebarOpen}
                      aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                      className="grid size-5 place-items-center rounded-sm text-foreground transition-colors hover:bg-foreground/15"
                    >
                      <PanelRight className="size-3.5" />
                    </button>
                  }
                />
                <TooltipContent>
                  {(sidebarOpen ? "Hide sidebar" : "Show sidebar") +
                    (rightSidebarShortcut ? ` (${rightSidebarShortcut})` : "")}
                </TooltipContent>
              </Tooltip>
            </div>
          ) : null
          // When the project sidebar is collapsed the workspace meets the window's
          // left edge, so the top bar reclaims the traffic-light gap and hosts the
          // expand control.
          const topBarLeading = (
            <>
              {projectSidebarCollapsed && (
                <>
                  <div className="w-[84px] shrink-0 self-stretch" />
                  {expandProjectSidebarButton}
                  {collapsedSearchButton}
                </>
              )}
              {activeProject && projectSidebarCollapsed && (
                <div className="flex min-w-0 items-center pl-1.5">
                  <ProjectSwitcher
                    projects={switcherProjects}
                    activeProjectId={activeProjectId}
                    onSelect={selectProject}
                    onAdd={addProject}
                  />
                </div>
              )}
            </>
          )
          const chatHeaderLeading = projectSidebarCollapsed ? (
            <div className="flex items-center gap-0.5 pr-2 [-webkit-app-region:no-drag]">
              <div className="w-[84px] shrink-0 self-stretch" />
              {expandProjectSidebarButton}
              {collapsedSearchButton}
            </div>
          ) : undefined
          const visibleSpace =
            spaces.find((space) => space.id === visibleSpaceId) ?? spaces[0]
          if (isSpaceChatRoute && projectSidebarChatEnabled && visibleSpace) {
            return (
              <SpaceChatView
                key={visibleSpace.id}
                space={{ id: visibleSpace.id, name: visibleSpace.name }}
                projects={activeSpaceProjects.map((project) => ({
                  id: project.id,
                  name: project.name,
                  path: project.path,
                }))}
                headerLeading={chatHeaderLeading}
              />
            )
          }
          if (!activeProject) {
            return (
              <>
                {titleBar}
                <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
                  <img
                    src={logoGrayUrl}
                    alt=""
                    aria-hidden="true"
                    className="mb-1 h-20 w-auto opacity-80"
                  />
                  <p>No project selected</p>
                  <button
                    type="button"
                    onClick={addProject}
                    className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
                  >
                    Select a Project
                  </button>
                </div>
              </>
            )
          }
          return (
            <WorkspaceSplit
              projects={projects}
              activeProjectId={activeProjectId}
              activeTabId={activeTabId}
              sidebarOpen={sidebarOpen}
              titleBar={titleBar}
              hideTitleBar={true}
              sidebarTopActions={sidebarTopActions}
              onTerminalTitleChange={setTerminalTitle}
              onTerminalAgentStatusChange={setTerminalAgentStatus}
              terminalFocusRequest={terminalFocusRequest}
              onStartTerminal={(tabId, paneId) => {
                void startTerminalPane(activeProject.id, tabId, paneId)
              }}
              onAddTerminal={() => void addTerminal()}
              onSplitTerminal={(tabId, direction) =>
                void splitTerminalPane(tabId, direction)
              }
              onClosePane={closePane}
              onFocusPane={setActivePane}
              onTerminalFocusChange={handleTerminalFocusChange}
              onRenamePane={renamePane}
              onDropPane={dropPane}
              onQuickSplitPane={(tabId, targetPaneId, zone) =>
                void quickSplitPane(tabId, targetPaneId, zone)
              }
              onTerminalExpandedPaneChange={handleTerminalExpandedPaneChange}
              onTerminalLayoutChange={setTerminalLayout}
              onExtractPaneToTab={extractPaneToTab}
              onOpenDiffTab={openDiffTab}
              onOpenFileTab={openFileTab}
              onOpenDevPreviewTab={openDevPreviewTab}
              onOpenCommitTab={openCommitTab}
              onSummarizeHistory={summarizeHistory}
              onSummarizeChat={summarizeChat}
              onProjectActivity={markProjectUpdated}
              onFocusSession={focusSession}
              rightSidebarTab={rightSidebarTab}
              onRightSidebarTabChange={setRightSidebarTab}
              activeTreeFilePath={activeTreeFilePath}
              fileReveal={fileReveal}
              workspaceTabs={
                <WorkspaceTabBar
                  tabs={activeProject.tabs}
                  activeId={activeTabId}
                  animationScopeKey={activeProject.id}
                  openingTabId={openingTerminalTabId}
                  onSelect={selectTab}
                  onAdd={addTerminal}
                  onConfigureAgents={() =>
                    void navigate({
                      to: "/settings",
                      search: { section: "agents" },
                    })
                  }
                  onClose={closeTab}
                  onCloseAll={closeAllTabs}
                  onCloseAllTerminals={() =>
                    void closeAllProjectTerminals(activeProject.id)
                  }
                  onCloseOthers={closeOtherTabs}
                  onCloseToRight={closeTabsToRight}
                  onRename={renameTab}
                  onReorder={reorderTabs}
                  onPin={pinTab}
                  onOpenInVSCode={() =>
                    void window.shellApi.openInVSCode(activeProject.path)
                  }
                  trailing={topBarTrailing}
                  leading={topBarLeading}
                  draggable={true}
                />
              }
            />
          )
        })()}
      </div>
    </div>
  )
}
