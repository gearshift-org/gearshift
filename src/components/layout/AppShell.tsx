import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { matchesAccelerator } from "@/lib/keybindings/registry"
import { useKeybindings } from "@/lib/keybindings/useKeybindings"
import { toast } from "sonner"
import { PanelLeft, PanelRight, X } from "lucide-react"
import { ProjectAvatar } from "./ProjectAvatar"
import { AutoHideTitleBar } from "./AutoHideTitleBar"
import { TitleBar } from "./TitleBar"
import { UpdateButton } from "./UpdateButton"
import { ProjectGitStatusBadge } from "./ProjectGitStatusBadge"
import { HistoryNavButtons } from "./HistoryNavButtons"
import { ProjectSidebar } from "./ProjectSidebar"
import { ProjectSwitcher } from "./ProjectSwitcher"
import { useTheme } from "@/components/theme-provider"
import { WorkspaceTabBar } from "./WorkspaceTabBar"
import { WorkspaceSplit } from "./WorkspaceSplit"
import { CommandPalette } from "./CommandPalette"
import logoGrayUrl from "@/assets/logo-gray.svg?url"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { paneDisplayName, tabDisplayName } from "./terminalName"
import {
  ensureLayout,
  moveLeafBeside,
  orderedPaneIds,
  removeLeaf,
  splitLeaf,
  swapLeaves,
} from "./terminalLayout"
import agentCompleteSoundUrl from "@/assets/sounds/agent-complete.wav?url"
import type {
  DropZone,
  FileReveal,
  Project,
  SplitDirection,
  TerminalAgentName,
  TerminalAgentStatus,
  TerminalLayout,
  TerminalPane,
  WorkspaceTab,
} from "./types"
import {
  loadActiveProjectId,
  loadAutoHideTitleBar,
  loadLastAgentTerminals,
  loadPaletteRecents,
  loadProjects,
  loadProjectSidebarOpen,
  loadRecentProjects,
  loadRightSidebarEdgeReveal,
  loadRightSidebarTab,
  loadSidebarOpen,
  pushRecentPaletteFile,
  pushRecentPaletteProject,
  pushRecentPaletteTab,
  pushRecentProject,
  saveActiveProjectId,
  saveAutoHideTitleBar,
  saveLastAgentTerminals,
  saveProjectSidebarOpen,
  saveProjects,
  saveRecentProjects,
  saveRightSidebarTab,
  saveSidebarOpen,
  stableProjectId,
  AUTO_HIDE_TITLE_BAR_EVENT,
  type LastAgentTerminal,
  type LastAgentTerminalsByProject,
  type PaletteRecents,
  RIGHT_SIDEBAR_EDGE_REVEAL_EVENT,
  type RecentProject,
  type RightSidebarTab,
  type StoredProject,
} from "@/lib/projects"
import { loadAiCommitPrompt } from "@/lib/aiCommitPrompt"
import { store } from "@/lib/store"
import { cn } from "@/lib/utils"

type ProjectIdMigration = { from: string; to: string }

function hydrateProjectSnapshot(): {
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
        tabs: (p.tabs ?? []).map((t) => {
          const storedPanes =
            t.panes && t.panes.length > 0 ? t.panes : [{ id: t.id }]
          const panes = storedPanes.map((sp) => ({
            id: sp.id,
            pendingStart: true,
            ...(sp.sessionId ? { pendingSessionId: sp.sessionId } : {}),
            ...(sp.autoTitle ? { autoTitle: sp.autoTitle } : {}),
            ...(sp.customName ? { customName: sp.customName } : {}),
            ...(sp.agentSessionId ? { agentSessionId: sp.agentSessionId } : {}),
            ...(sp.agentSessionTitle
              ? { agentSessionTitle: sp.agentSessionTitle }
              : {}),
          }))
          const activePaneId =
            (t.activePaneId && panes.some((pp) => pp.id === t.activePaneId)
              ? t.activePaneId
              : panes[0]?.id) ?? t.id
          return {
            kind: "terminal" as const,
            id: t.id,
            name: t.name,
            customName: t.customName,
            panes,
            activePaneId,
            ...(t.layout ? { layout: t.layout } : {}),
          }
        }),
        activeTabId: p.activeTabId ?? p.tabs?.[0]?.id ?? "",
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

const SIDEBAR_REVEAL_OUTSIDE_LIMIT = 500
const RIGHT_SIDEBAR_OVERLAY_TRANSITION_MS = 200
// Must match the fixed width of ProjectSidebar so the collapse/expand width
// animation clips its contents without reflowing them.
const PROJECT_SIDEBAR_WIDTH = 248
const AGENT_TERMINAL_COMMANDS: Record<TerminalAgentName, string> = {
  claude: "claude",
  codex: "codex",
  opencode: "opencode",
  pi: "pi",
  gemini: "gemini",
}
const APP_TITLE = "GearShift"
const AGENT_TERMINAL_LABELS: Record<TerminalAgentName, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  pi: "Pi",
  gemini: "Gemini",
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

function rememberedAgentTerminalForProject(
  map: LastAgentTerminalsByProject,
  project: Project | undefined
): LastAgentTerminal | null {
  if (!project) return null
  return (
    map[project.id] ??
    Object.values(map).find((target) => target.projectPath === project.path) ??
    null
  )
}

function paneHasActiveAgent(pane: TerminalPane): boolean {
  return !!(
    pane.agentStatus?.running ||
    pane.agentStatus?.working ||
    pane.agentStatus?.needsAttention
  )
}

function findProjectAgentTerminal(
  project: Project | undefined,
  remembered: LastAgentTerminal | null
): LastAgentTerminal | null {
  if (!project) return null
  if (
    remembered &&
    (remembered.projectId === project.id ||
      remembered.projectPath === project.path)
  ) {
    const tab = project.tabs.find(
      (t) => t.kind === "terminal" && t.id === remembered.tabId
    )
    const pane =
      tab?.kind === "terminal"
        ? tab.panes.find((pp) => pp.id === remembered.paneId)
        : undefined
    if (pane && paneHasActiveAgent(pane)) {
      return lastAgentTerminalFromPane(
        project,
        remembered.tabId,
        remembered.paneId,
        remembered
      )
    }
  }

  const activeTab = project.tabs.find((t) => t.id === project.activeTabId)
  if (activeTab?.kind === "terminal") {
    const activePane = activeTab.panes.find(
      (pane) => pane.id === activeTab.activePaneId
    )
    if (activePane && paneHasActiveAgent(activePane)) {
      return lastAgentTerminalFromPane(project, activeTab.id, activePane.id)
    }
  }

  for (const tab of project.tabs) {
    if (tab.kind !== "terminal") continue
    const pane = tab.panes.find(paneHasActiveAgent)
    if (pane) return lastAgentTerminalFromPane(project, tab.id, pane.id)
  }
  return null
}

function isModifierKey(key: string): boolean {
  return ["Alt", "Control", "Meta", "Shift"].includes(key)
}

function basename(p: string) {
  return p.replace(/\/+$/, "").split("/").pop() || p
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

function countWorkingTerminalPanes(tabs: WorkspaceTab[]): number {
  let count = 0
  for (const tab of tabs) {
    if (tab.kind !== "terminal") continue
    for (const pane of tab.panes) {
      if (pane.agentStatus?.working) count += 1
    }
  }
  return count
}

function serializeProjects(projects: Project[]) {
  return projects.map((p) => {
    const terminals = p.tabs.filter(
      (t): t is Extract<WorkspaceTab, { kind: "terminal" }> =>
        t.kind === "terminal"
    )
    const activeTerminal = terminals.find((t) => t.id === p.activeTabId)
    return {
      id: p.id,
      name: p.name,
      path: p.path,
      // Only persist the active id if it points at a terminal — diff/file tabs
      // are ephemeral.
      activeTabId: activeTerminal?.id ?? terminals[0]?.id ?? "",
      tabs: terminals.map((t) => ({
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
          return {
            id: pp.id,
            ...(sid ? { sessionId: sid } : {}),
            ...(pp.autoTitle ? { autoTitle: pp.autoTitle } : {}),
            ...(pp.customName ? { customName: pp.customName } : {}),
            ...(pp.agentSessionId ? { agentSessionId: pp.agentSessionId } : {}),
            ...(pp.agentSessionTitle
              ? { agentSessionTitle: pp.agentSessionTitle }
              : {}),
          }
        }),
      })),
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

const AGENT_PROMPT_SUBMIT_DELAY_MS = 80

function writeAgentPrompt(sessionId: string, prompt: string): void {
  const body = prompt.trim()
  if (!body) return
  window.term.write(sessionId, body)
  window.setTimeout(() => {
    window.term.write(sessionId, "\r")
  }, AGENT_PROMPT_SUBMIT_DELAY_MS)
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

export function AppShell() {
  const navigate = useNavigate()
  const { resolvedTheme } = useTheme()
  const params = useParams({ strict: false }) as {
    projectId?: string
    tabId?: string
  }
  const routeProjectId = params.projectId ?? null
  const routeTabId = params.tabId ?? null
  const initialProjectSnapshot = useMemo(() => hydrateProjectSnapshot(), [])

  const [projects, setProjects] = useState<Project[]>(
    () => initialProjectSnapshot.projects
  )
  const [recents, setRecents] = useState<RecentProject[]>(() =>
    loadRecentProjects()
  )
  const [paletteRecents, setPaletteRecents] = useState<PaletteRecents>(() =>
    loadPaletteRecents()
  )
  const [sidebarOpen, setSidebarOpen] = useState(() => loadSidebarOpen())
  const [rightSidebarEdgeReveal, setRightSidebarEdgeReveal] = useState(() =>
    loadRightSidebarEdgeReveal()
  )
  const [autoHideTitleBar, setAutoHideTitleBar] = useState(() =>
    loadAutoHideTitleBar()
  )
  const [projectSidebarOpen, setProjectSidebarOpen] = useState(() =>
    loadProjectSidebarOpen()
  )
  const [rightSidebarOverlayOpen, setRightSidebarOverlayOpen] = useState(false)
  const [rightSidebarTab, setRightSidebarTab] = useState<RightSidebarTab>(() =>
    loadRightSidebarTab()
  )
  const [terminalFocusRequest, setTerminalFocusRequest] = useState<{
    tabId: string
    paneId: string
    nonce: number
  } | null>(null)
  const [lastAgentTerminals, setLastAgentTerminals] =
    useState<LastAgentTerminalsByProject>(() => loadLastAgentTerminals())
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
        const snapshot = hydrateProjectSnapshot()
        const hydrated = snapshot.projects
        if (snapshot.migrations.length > 0) {
          saveProjects(serializeProjects(hydrated))
          void window.term.history.migrateProjectIds(snapshot.migrations)
        }
        setProjects(hydrated)
        setRecents(loadRecentProjects())
        setPaletteRecents(loadPaletteRecents())
        setSidebarOpen(loadSidebarOpen())
        setRightSidebarEdgeReveal(loadRightSidebarEdgeReveal())
        setAutoHideTitleBar(loadAutoHideTitleBar())
        setProjectSidebarOpen(loadProjectSidebarOpen())
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
        if (validStoredActiveId && !params.projectId) {
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
  const windowFocusedRef = useRef(
    typeof document !== "undefined" ? document.hasFocus() : true
  )
  const lastMouseRef = useRef({ x: -1, y: -1 })
  const edgeEnteredAtRef = useRef({ right: 0 })
  const edgeRevealTimersRef = useRef<{ right: number | null }>({ right: null })
  const pinRightSidebarTimerRef = useRef<number | null>(null)
  const modifierKeyHeldRef = useRef(false)
  const modifierRevealPauseUntilRef = useRef(0)
  const resetEdgeRevealTracking = useCallback(() => {
    edgeEnteredAtRef.current = { right: 0 }
    if (edgeRevealTimersRef.current.right != null) {
      window.clearTimeout(edgeRevealTimersRef.current.right)
    }
    edgeRevealTimersRef.current = { right: null }
  }, [])
  const closeRightSidebarOverlay = useCallback(() => {
    if (pinRightSidebarTimerRef.current != null) {
      window.clearTimeout(pinRightSidebarTimerRef.current)
      pinRightSidebarTimerRef.current = null
    }
    resetEdgeRevealTracking()
    setRightSidebarOverlayOpen(false)
  }, [resetEdgeRevealTracking])

  const clearPinRightSidebarTimer = useCallback(() => {
    if (pinRightSidebarTimerRef.current == null) return
    window.clearTimeout(pinRightSidebarTimerRef.current)
    pinRightSidebarTimerRef.current = null
  }, [])

  useEffect(() => clearPinRightSidebarTimer, [clearPinRightSidebarTimer])

  useEffect(() => {
    projectsRef.current = projects
  }, [projects])

  useEffect(() => {
    saveSidebarOpen(sidebarOpen)
  }, [sidebarOpen])
  useEffect(() => {
    saveProjectSidebarOpen(projectSidebarOpen)
  }, [projectSidebarOpen])
  useEffect(() => {
    const onEdgeRevealChange = (event: Event) => {
      const enabled = (event as CustomEvent<boolean>).detail
      setRightSidebarEdgeReveal(enabled)
      if (!enabled) setRightSidebarOverlayOpen(false)
    }
    window.addEventListener(RIGHT_SIDEBAR_EDGE_REVEAL_EVENT, onEdgeRevealChange)
    return () => {
      window.removeEventListener(
        RIGHT_SIDEBAR_EDGE_REVEAL_EVENT,
        onEdgeRevealChange
      )
    }
  }, [])
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
  const activeProjectId =
    (routeProjectId && projects.some((p) => p.id === routeProjectId)
      ? routeProjectId
      : (restoredProjectId ?? projects[0]?.id)) ?? ""
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const activeProjectPath = activeProject?.path
  const showRightOverlay = !sidebarOpen && rightSidebarOverlayOpen

  const openRightSidebar = useCallback(() => {
    clearPinRightSidebarTimer()
    if (!sidebarOpen && rightSidebarEdgeReveal && activeProject) {
      setRightSidebarOverlayOpen(true)
      pinRightSidebarTimerRef.current = window.setTimeout(() => {
        pinRightSidebarTimerRef.current = null
        setSidebarOpen(true)
        setRightSidebarOverlayOpen(false)
      }, RIGHT_SIDEBAR_OVERLAY_TRANSITION_MS)
      return
    }
    setRightSidebarOverlayOpen(false)
    setSidebarOpen(true)
  }, [
    activeProject,
    clearPinRightSidebarTimer,
    rightSidebarEdgeReveal,
    sidebarOpen,
  ])

  const toggleRightSidebar = useCallback(() => {
    clearPinRightSidebarTimer()
    if (sidebarOpen) {
      setRightSidebarOverlayOpen(false)
      setSidebarOpen(false)
      return
    }
    openRightSidebar()
  }, [clearPinRightSidebarTimer, openRightSidebar, sidebarOpen])

  const toggleProjectSidebar = useCallback(() => {
    setProjectSidebarOpen((v) => !v)
  }, [])

  const confirmCloseWorkingTerminals = async (count: number) => {
    if (count === 0) return true
    return window.dialogApi.confirmTerminalClose({ count })
  }

  useEffect(() => {
    const onFocus = () => {
      windowFocusedRef.current = true
      resetEdgeRevealTracking()
    }
    const onBlur = () => {
      windowFocusedRef.current = false
      closeRightSidebarOverlay()
      lastMouseRef.current = { x: -1, y: -1 }
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
  }, [closeRightSidebarOverlay, resetEdgeRevealTracking])

  useEffect(() => {
    const pauseReveal = (ms: number) => {
      modifierRevealPauseUntilRef.current = performance.now() + ms
      resetEdgeRevealTracking()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (isModifierKey(event.key)) {
        modifierKeyHeldRef.current = true
        pauseReveal(250)
        return
      }
      if (event.metaKey || event.ctrlKey) pauseReveal(600)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (isModifierKey(event.key)) {
        modifierKeyHeldRef.current = false
        pauseReveal(250)
        return
      }
      if (event.metaKey || event.ctrlKey) pauseReveal(600)
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [resetEdgeRevealTracking])

  useEffect(() => {
    if (!showRightOverlay) return
    let cancelled = false
    const closeIfCursorIsFarOutside = async () => {
      const pointer = await window.appWindow
        .pointerState(SIDEBAR_REVEAL_OUTSIDE_LIMIT)
        .catch(() => null)
      if (cancelled || !pointer?.ok) return
      if (pointer.nearWindow) return
      closeRightSidebarOverlay()
    }
    void closeIfCursorIsFarOutside()
    const id = window.setInterval(closeIfCursorIsFarOutside, 80)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [closeRightSidebarOverlay, showRightOverlay])

  useEffect(() => {
    if (!rightSidebarEdgeReveal || sidebarOpen || !activeProject) {
      resetEdgeRevealTracking()
      return
    }

    const EDGE = 6
    const HOT_BUFFER = 30
    const REVEAL_DWELL_MS = 50

    const revealRightEdge = () => {
      if (!windowFocusedRef.current) return
      const modifierActive =
        modifierKeyHeldRef.current ||
        performance.now() < modifierRevealPauseUntilRef.current
      if (modifierActive) return
      const latest = lastMouseRef.current
      if (latest.x < window.innerWidth - EDGE) return
      setRightSidebarOverlayOpen(true)
    }

    const onMouseMove = (event: MouseEvent) => {
      const clientX = event.clientX
      const clientY = event.clientY
      const now = performance.now()
      if (!windowFocusedRef.current) {
        resetEdgeRevealTracking()
        return
      }

      const last = lastMouseRef.current
      if (clientX === last.x && clientY === last.y) return
      last.x = clientX
      last.y = clientY

      const modifierActive =
        modifierKeyHeldRef.current ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        now < modifierRevealPauseUntilRef.current
      if (modifierActive) {
        resetEdgeRevealTracking()
        return
      }

      const inRightEdge = clientX >= window.innerWidth - EDGE
      if (!inRightEdge) {
        edgeEnteredAtRef.current.right = 0
        if (edgeRevealTimersRef.current.right != null) {
          window.clearTimeout(edgeRevealTimersRef.current.right)
          edgeRevealTimersRef.current.right = null
        }
      } else if (edgeEnteredAtRef.current.right === 0) {
        edgeEnteredAtRef.current.right = now
        edgeRevealTimersRef.current.right = window.setTimeout(() => {
          edgeRevealTimersRef.current.right = null
          revealRightEdge()
        }, REVEAL_DWELL_MS)
      }

      const rightIntent =
        inRightEdge && now - edgeEnteredAtRef.current.right >= REVEAL_DWELL_MS
      if (rightIntent) {
        setRightSidebarOverlayOpen(true)
      } else if (clientX < window.innerWidth - 340 - HOT_BUFFER) {
        closeRightSidebarOverlay()
      }
    }

    window.addEventListener("mousemove", onMouseMove)
    return () => {
      window.removeEventListener("mousemove", onMouseMove)
      resetEdgeRevealTracking()
    }
  }, [
    activeProject,
    closeRightSidebarOverlay,
    resetEdgeRevealTracking,
    rightSidebarEdgeReveal,
    sidebarOpen,
  ])

  const activeTabId = (() => {
    if (!activeProject) return ""
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
    },
    [navigate, stateRestored]
  )

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

  const resolvedLastAgentTerminal = useMemo(
    () =>
      findProjectAgentTerminal(
        activeProject,
        rememberedAgentTerminalForProject(lastAgentTerminals, activeProject)
      ),
    [activeProject, lastAgentTerminals]
  )

  const commitWithAi = useCallback(() => {
    const project = projectsRef.current.find((p) => p.id === activeProjectId)
    const target = findProjectAgentTerminal(
      project,
      rememberedAgentTerminalForProject(lastAgentTerminals, project)
    )
    if (!project || !target) {
      toast.error("No coding agent terminal found for this project")
      return
    }

    window.focus()
    void window.appWindow?.focus?.()
    setProjects((prev) =>
      prev.map((p) =>
        p.id === target.projectId
          ? {
              ...p,
              activeTabId: target.tabId,
              tabs: p.tabs.map((t) =>
                t.id === target.tabId && t.kind === "terminal"
                  ? { ...t, activePaneId: target.paneId }
                  : t
              ),
            }
          : p
      )
    )
    navigateToProject(target.projectId, target.tabId)
    terminalFocusRequestNonceRef.current += 1
    setTerminalFocusRequest({
      tabId: target.tabId,
      paneId: target.paneId,
      nonce: terminalFocusRequestNonceRef.current,
    })

    window.setTimeout(() => {
      const latestProject = projectsRef.current.find(
        (p) => p.id === target.projectId
      )
      const latest = findProjectAgentTerminal(latestProject, target)
      const sessionId = latest?.sessionId ?? target.sessionId
      if (!sessionId) {
        toast.error("Agent terminal is not running")
        return
      }
      writeAgentPrompt(sessionId, loadAiCommitPrompt())
    }, 120)
  }, [activeProjectId, lastAgentTerminals, navigateToProject])

  useEffect(() => {
    if (!stateRestored) return
    saveActiveProjectId(activeProjectId)
    if (activeProjectPath)
      setPaletteRecents(pushRecentPaletteProject(activeProjectPath))
  }, [activeProjectId, activeProjectPath, stateRestored])

  const dismissViewedTerminalNotifications = useCallback(
    (projectId: string, tabId: string, paneId: string) => {
      const set = agentDoneToastsByProjectRef.current.get(projectId)
      if (set) {
        for (const id of [
          agentDoneToastId(projectId, tabId, paneId),
          agentAttentionToastId(projectId, tabId, paneId),
        ]) {
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
              if (!status?.completed && !status?.needsAttention) return pane
              paneChanged = true
              return {
                ...pane,
                agentStatus: {
                  ...status,
                  completed: false,
                  completedAt: undefined,
                  needsAttention: false,
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

  useEffect(() => {
    if (!activeProjectId || !activeTabId || !isAppVisibleAndFocused()) return
    const activeTab = activeProject?.tabs.find((t) => t.id === activeTabId)
    if (activeTab?.kind !== "terminal") return
    dismissViewedTerminalNotifications(
      activeProjectId,
      activeTabId,
      activeTab.activePaneId
    )
  }, [
    activeProject,
    activeProjectId,
    activeTabId,
    dismissViewedTerminalNotifications,
  ])

  useEffect(() => {
    const dismissActiveTerminalToasts = () => {
      if (!activeProjectId || !activeTabId || !isAppVisibleAndFocused()) return
      const activeTab = activeProject?.tabs.find((t) => t.id === activeTabId)
      if (activeTab?.kind !== "terminal") return
      dismissViewedTerminalNotifications(
        activeProjectId,
        activeTabId,
        activeTab.activePaneId
      )
    }
    window.addEventListener("focus", dismissActiveTerminalToasts)
    document.addEventListener("visibilitychange", dismissActiveTerminalToasts)
    return () => {
      window.removeEventListener("focus", dismissActiveTerminalToasts)
      document.removeEventListener(
        "visibilitychange",
        dismissActiveTerminalToasts
      )
    }
  }, [
    activeProject,
    activeProjectId,
    activeTabId,
    dismissViewedTerminalNotifications,
  ])

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
    if (!activeProject || !activeTabId) return
    const activeTab = activeProject.tabs.find((t) => t.id === activeTabId)
    if (activeTab?.kind !== "terminal") return
    lastTerminalByProjectRef.current[activeProject.id] = activeTab.id
    const activePane = activeTab.panes.find(
      (pp) => pp.id === activeTab.activePaneId
    )
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
      navigateToProject(id, tabId)
      setRecents(pushRecentProject({ name: resolvedName, path }))

      await window.term.create({
        cwd: path,
        theme: resolvedTheme,
        projectId: id,
        sessionId: paneId,
      })
    },
    [navigateToProject, resolvedTheme]
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
    navigateToProject(id, p?.activeTabId || undefined)
  }

  const closeProject = async (id: string) => {
    const target = projects.find((p) => p.id === id)
    if (
      target &&
      !(await confirmCloseWorkingTerminals(
        countWorkingTerminalPanes(target.tabs)
      ))
    ) {
      return
    }
    setProjects((prev) => {
      const target = prev.find((p) => p.id === id)
      if (target) {
        for (const t of target.tabs) killAllPanes(t)
      }
      const next = prev.filter((p) => p.id !== id)
      if (id === activeProjectId) {
        const nextActive = next[0]
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
      !(await confirmCloseWorkingTerminals(
        countWorkingTerminalPanes(terminalTabs)
      ))
    ) {
      return
    }
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p
        const terminalTabs = p.tabs.filter((t) => t.kind === "terminal")
        if (terminalTabs.length === 0) return p
        for (const t of terminalTabs) killAllPanes(t)
        const tabs = p.tabs.filter((t) => t.kind !== "terminal")
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
    const idx = projects.findIndex((p) => p.id === id)
    const toClose = idx >= 0 ? projects.slice(idx + 1) : []
    if (
      !(await confirmCloseWorkingTerminals(
        toClose.reduce(
          (count, project) => count + countWorkingTerminalPanes(project.tabs),
          0
        )
      ))
    ) {
      return
    }
    setProjects((prev) => {
      const idx = prev.findIndex((p) => p.id === id)
      if (idx < 0) return prev
      const toClose = prev.slice(idx + 1)
      if (toClose.length === 0) return prev
      for (const p of toClose) {
        for (const t of p.tabs) killAllPanes(t)
      }
      const closedIds = new Set(toClose.map((p) => p.id))
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
    const toClose = projects.filter((p) => p.id !== keepId)
    if (
      !(await confirmCloseWorkingTerminals(
        toClose.reduce(
          (count, project) => count + countWorkingTerminalPanes(project.tabs),
          0
        )
      ))
    ) {
      return
    }
    setProjects((prev) => {
      for (const p of prev) {
        if (p.id === keepId) continue
        for (const t of p.tabs) killAllPanes(t)
      }
      const next = prev.filter((p) => p.id === keepId)
      const keep = next[0]
      navigateToProject(keepId, keep?.activeTabId || undefined)
      return next
    })
  }

  const addTerminal = async (agentName?: TerminalAgentName) => {
    if (!activeProject) return
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
              panes: [{ id: paneId, sessionId: paneId }],
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
      window.term.write(paneId, `${AGENT_TERMINAL_COMMANDS[agentName]}\r`)
    }
  }

  /** Add a new terminal pane to an existing terminal tab (Cmd+D / split). */
  const splitTerminalPane = useCallback(
    async (tabId: string, direction: SplitDirection = "horizontal") => {
      const project = projectsRef.current.find((p) => p.id === activeProjectId)
      const tab = project?.tabs.find((t) => t.id === tabId)
      if (!project || !tab || tab.kind !== "terminal") return
      const { id: paneId } = await window.term.create({
        cwd: project.path,
        theme: resolvedTheme,
        projectId: project.id,
      })
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
      if (
        pane.agentStatus?.working &&
        !(await confirmCloseWorkingTerminals(1))
      ) {
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
      // Reuse the existing preview diff tab if any (VS Code-style).
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
      // Reuse the existing preview file tab if any.
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

  /** Pin a preview tab so subsequent file clicks don't replace it. */
  const pinTab = (id: string) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProjectId
          ? {
              ...p,
              tabs: p.tabs.map((t) =>
                t.id === id && (t.kind === "diff" || t.kind === "file")
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
    async (projectId: string, tabId: string, paneId: string) => {
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
        // Falls through to fresh create on miss (session was killed, the
        // 24 h idle sweep fired, or the daemon was restarted).
        let sessionId: string | null = null
        if (pane.pendingSessionId) {
          try {
            const res = await window.term.adopt(
              pane.pendingSessionId,
              project.id
            )
            if (res.ok) sessionId = pane.pendingSessionId
          } catch {
            // fall through to create
          }
        }
        if (!sessionId) {
          const { id } = await window.term.create({
            cwd: project.path,
            theme: resolvedTheme,
            projectId: project.id,
          })
          sessionId = id
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
    [projects]
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
      if (pane.pendingStart) {
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
    return [...projects].sort(
      (a, b) =>
        (order.get(a.path) ?? Infinity) - (order.get(b.path) ?? Infinity)
    )
  }, [projects, paletteRecents.projects])

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
    terminalAgentStatusRef.current.set(key, status)

    const targetProject = projects.find((p) =>
      p.tabs.some((t) => t.id === tabId)
    )
    const targetTab = targetProject?.tabs.find((t) => t.id === tabId)
    const fallbackPane =
      targetTab?.kind === "terminal"
        ? targetTab.panes.find((pp) => pp.id === paneId)
        : undefined
    const wasWorking =
      previousStatus?.working ?? fallbackPane?.agentStatus?.working ?? false
    const finishedWork =
      wasWorking && !status.working && status.completed === true
    const wasNeedsAttention =
      previousStatus?.needsAttention ??
      fallbackPane?.agentStatus?.needsAttention ??
      false
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

    if (status.agentName && targetProject) {
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
                    // id/title, so we never clobber a persisted one with undefined.
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
      playAgentCompleteSound()
    }

    if (
      finishedAwayFromAttention &&
      targetProject &&
      targetTab?.kind === "terminal"
    ) {
      const terminalName = tabDisplayName(targetTab)
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
          (id) => (
            <div className="relative flex w-[320px] rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lg">
              <button
                type="button"
                onClick={() =>
                  openAgentDoneTarget(targetProject.id, tabId, paneId, id)
                }
                className="flex min-w-0 flex-1 items-start gap-2 text-left"
              >
                <ProjectAvatar
                  name={targetProject.name}
                  path={targetProject.path}
                  className="mt-0.5 size-8 shrink-0 rounded-md text-xs"
                />
                <span className="flex min-w-0 flex-col gap-0.5 pr-5">
                  <span className="truncate text-sm font-semibold">
                    {targetProject.name}
                  </span>
                  <span className="flex min-w-0 items-baseline gap-1 text-[11px] text-muted-foreground">
                    <span className="shrink-0">Agent finished</span>
                    {elapsedTime && (
                      <>
                        <span className="shrink-0">·</span>
                        <span className="shrink-0">
                          Completed in {elapsedTime}
                        </span>
                      </>
                    )}
                  </span>
                  {latestPrompt && (
                    <span className="line-clamp-2 pt-0.5 text-[11px] leading-snug text-foreground/80">
                      {latestPrompt}
                    </span>
                  )}
                </span>
              </button>
              <button
                type="button"
                aria-label="Close notification"
                onClick={() => toast.dismiss(id)}
                className="absolute top-1 right-1 rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ),
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
          if (typeof Notification !== "undefined") {
            try {
              const notification = new Notification(
                targetProject.name || "GearShift",
                {
                  // Title: project name. Body: terminal name, then the last
                  // chat message on its own line.
                  body: latestPrompt
                    ? `${terminalName}\n${latestPrompt}`
                    : terminalName,
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

      void window.term.history
        .list(paneId)
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
      toast.custom(
        (id) => (
          <div className="relative flex w-[380px] rounded-md border border-border bg-popover p-2.5 text-popover-foreground shadow-lg">
            <button
              type="button"
              onClick={() =>
                openAgentDoneTarget(targetProject.id, tabId, paneId, id)
              }
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            >
              <ProjectAvatar
                name={targetProject.name}
                path={targetProject.path}
                className="size-10 shrink-0 rounded-md text-sm"
              />
              <span className="flex min-w-0 flex-col justify-center gap-0.5 pr-6">
                <span className="text-xs font-medium">Agent needs input</span>
                <span className="flex min-w-0 items-baseline gap-1 text-xs">
                  <span className="max-w-28 truncate font-semibold text-foreground">
                    {targetProject.name}
                  </span>
                  <span className="shrink-0 text-muted-foreground">·</span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {terminalName}
                  </span>
                </span>
              </span>
            </button>
            <button
              type="button"
              aria-label="Close notification"
              onClick={() => toast.dismiss(id)}
              className="absolute top-1.5 right-1.5 rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ),
        {
          id: toastId,
          duration: Infinity,
          onDismiss: cleanupToast,
          onAutoClose: cleanupToast,
        }
      )

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
    if (
      tab &&
      !(await confirmCloseWorkingTerminals(countWorkingTerminalPanes([tab])))
    ) {
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
    if (
      !(await confirmCloseWorkingTerminals(countWorkingTerminalPanes(toClose)))
    ) {
      return
    }
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
    if (
      !(await confirmCloseWorkingTerminals(countWorkingTerminalPanes(toClose)))
    ) {
      return
    }
    for (const t of toClose) killAllPanes(t)
    const keep = activeProject.tabs.find((t) => t.id === keepId)
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProjectId
          ? {
              ...p,
              tabs: keep ? [keep] : [],
              activeTabId: keep ? keep.id : "",
            }
          : p
      )
    )
    if (activeTabId !== keepId) navigateToTab(keepId)
  }

  const closeAllTabs = async () => {
    if (!activeProject) return
    if (
      !(await confirmCloseWorkingTerminals(
        countWorkingTerminalPanes(activeProject.tabs)
      ))
    ) {
      return
    }
    for (const t of activeProject.tabs) killAllPanes(t)
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProjectId ? { ...p, tabs: [], activeTabId: "" } : p
      )
    )
    navigateToProject(activeProjectId)
  }
  const addTerminalRef = useRef<() => void>(() => undefined)
  const closeActiveTabRef = useRef<() => void>(() => undefined)
  const splitActiveTerminalRef = useRef<
    (direction?: "horizontal" | "vertical") => void
  >(() => undefined)
  const goToLastTerminalRef = useRef<() => void>(() => undefined)

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
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
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
      // Let focused controls/editors handle their own shortcuts first. For
      // example, CodeMirror's Mod+S save binding calls preventDefault(), so the
      // sidebar shortcut should not also run while the editor handles saving.
      if (e.defaultPrevented) return
      const action = findActionForEvent(e)
      if (!action) return
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
        case "settings.open":
          e.preventDefault()
          void navigate({ to: "/settings" })
          break
        case "titlebar.togglePin":
          e.preventDefault()
          saveAutoHideTitleBar(!autoHideTitleBar)
          break
        default:
          break
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [
    bindings,
    findActionForEvent,
    navigate,
    autoHideTitleBar,
    openRightSidebar,
    toggleRightSidebar,
    toggleProjectSidebar,
  ])

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
      {/* Keep the sidebar mounted and animate its width so collapse/expand
          slides instead of popping. The inner sidebar stays at its full fixed
          width so its contents don't reflow while the wrapper clips them. */}
      <div
        aria-hidden={!projectSidebarOpen}
        style={{ width: projectSidebarOpen ? PROJECT_SIDEBAR_WIDTH : 0 }}
        className={cn(
          "shrink-0 overflow-hidden transition-[width] duration-200 ease-out [-webkit-app-region:no-drag]",
          !projectSidebarOpen && "pointer-events-none"
        )}
      >
        <ProjectSidebar
          projects={projects}
          activeId={activeProjectId}
          recents={recents.filter(
            (r) => !projects.some((p) => p.path === r.path)
          )}
          onSelect={selectProject}
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
          onOpenSettings={() => void navigate({ to: "/settings" })}
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {(() => {
          const toggleSidebar = () => {
            toggleRightSidebar()
          }
          const openChanges = () => {
            setRightSidebarTab("changes")
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
              <TooltipContent>Expand sidebar</TooltipContent>
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
                      <HistoryNavButtons />
                    </div>
                  ) : undefined
                }
              />
            </AutoHideTitleBar>
          )
          const sidebarTopActions = (
            <div className="flex items-center pr-1">
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
                  {sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                </TooltipContent>
              </Tooltip>
            </div>
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
                  {sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                </TooltipContent>
              </Tooltip>
            </div>
          ) : null
          // When the project sidebar is collapsed the workspace meets the window's
          // left edge, so the top bar reclaims the traffic-light gap and hosts the
          // expand control.
          const topBarLeading = expandProjectSidebarButton ? (
            <>
              <div className="w-[84px] shrink-0 self-stretch" />
              {expandProjectSidebarButton}
              <HistoryNavButtons className="pl-0.5" />
              <UpdateButton />
              {activeProject && (
                // Project switcher standing in for the hidden sidebar — lets the
                // user switch projects (or add one) without expanding it.
                <div className="flex min-w-0 items-center pr-2 pl-1.5">
                  <ProjectSwitcher
                    projects={switcherProjects}
                    activeProjectId={activeProjectId}
                    onSelect={selectProject}
                    onAdd={addProject}
                  />
                </div>
              )}
            </>
          ) : undefined
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
              sidebarOverlayMode={
                rightSidebarEdgeReveal && !sidebarOpen && !!activeProject
              }
              sidebarOverlayVisible={
                rightSidebarEdgeReveal &&
                !sidebarOpen &&
                !!activeProject &&
                rightSidebarOverlayOpen
              }
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
              onRenamePane={renamePane}
              onDropPane={dropPane}
              onTerminalLayoutChange={setTerminalLayout}
              onExtractPaneToTab={extractPaneToTab}
              onOpenDiffTab={openDiffTab}
              onOpenFileTab={openFileTab}
              onCommitWithAi={commitWithAi}
              canCommitWithAi={!!resolvedLastAgentTerminal}
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
                  onClose={closeTab}
                  onCloseAll={closeAllTabs}
                  onCloseOthers={closeOtherTabs}
                  onCloseToRight={closeTabsToRight}
                  onRename={renameTab}
                  onReorder={reorderTabs}
                  onPin={pinTab}
                  onOpenInVSCode={() =>
                    void window.shellApi.openInVSCode(activeProject.path)
                  }
                  trailing={topBarTrailing}
                  leading={topBarLeading ?? <UpdateButton />}
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
