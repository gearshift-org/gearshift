import { store } from "./store"
import type { TerminalLayout } from "@/components/layout/types"

export type StoredPane = {
  /** Stable DOM-key id assigned at create time. Persists across restarts. */
  id: string
  /** Daemon session id. Present → renderer attempts adopt on next launch. */
  sessionId?: string
  /** Last title emitted by the running process. */
  autoTitle?: string
  /** User-set name for this pane. */
  customName?: string
  /** The coding agent's own session id (e.g. Claude's resumable session UUID), reported via hooks. */
  agentSessionId?: string
  /** Human-readable agent session title (AI title or first prompt) shown as the pane title. */
  agentSessionTitle?: string
}

export type LastAgentTerminal = {
  projectId: string
  projectPath: string
  tabId: string
  paneId: string
  sessionId?: string
  updatedAt: number
}

export type LastAgentTerminalsByProject = Record<string, LastAgentTerminal>

export type StoredTab = {
  id: string
  name: string
  customName?: string
  /** Persisted multi-pane state. Falls back to [{ id: tab.id }] for older snapshots. */
  panes?: StoredPane[]
  activePaneId?: string
  /** Persisted recursive split arrangement over pane ids. */
  layout?: TerminalLayout
}

export type StoredProject = {
  id: string
  name: string
  path: string
  tabs?: StoredTab[]
  activeTabId?: string
}

const KEY = "gearshift.projects"
const ACTIVE_KEY = "gearshift.activeProjectId"
const LAST_AGENT_TERMINAL_KEY = "gearshift.lastAgentTerminal"
const RECENTS_KEY = "gearshift.recentProjects"
const PALETTE_RECENTS_KEY = "gearshift.paletteRecents"
const PALETTE_RECENTS_MAX = 200

export type RecentProject = { name: string; path: string }

export function stableProjectId(projectPath: string): string {
  const normalized = projectPath.replace(/\/+$/, "")
  let hashA = 0x811c9dc5
  let hashB = 0x01000193
  for (let i = 0; i < normalized.length; i += 1) {
    const code = normalized.charCodeAt(i)
    hashA ^= code
    hashA = Math.imul(hashA, 0x01000193)
    hashB ^= code
    hashB = Math.imul(hashB, 0x811c9dc5)
  }
  return `project-${(hashA >>> 0).toString(36)}${(hashB >>> 0).toString(36)}`
}

export type PaletteRecents = {
  projects: string[]
  tabsByProject: Record<string, string[]>
  filesByProject: Record<string, string[]>
}

function cleanStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : []
}

function pushRecent(
  list: string[],
  value: string,
  max = PALETTE_RECENTS_MAX
): string[] {
  if (!value) return list
  return [value, ...list.filter((v) => v !== value)].slice(0, max)
}

export function loadPaletteRecents(): PaletteRecents {
  try {
    const raw = store.get(PALETTE_RECENTS_KEY)
    if (!raw) return { projects: [], tabsByProject: {}, filesByProject: {} }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") {
      return { projects: [], tabsByProject: {}, filesByProject: {} }
    }
    const tabsByProject: Record<string, string[]> = {}
    if (parsed.tabsByProject && typeof parsed.tabsByProject === "object") {
      for (const [projectPath, tabs] of Object.entries(parsed.tabsByProject)) {
        tabsByProject[projectPath] = cleanStringArray(tabs)
      }
    }
    const filesByProject: Record<string, string[]> = {}
    if (parsed.filesByProject && typeof parsed.filesByProject === "object") {
      for (const [projectPath, files] of Object.entries(
        parsed.filesByProject
      )) {
        filesByProject[projectPath] = cleanStringArray(files)
      }
    }
    return {
      projects: cleanStringArray(parsed.projects),
      tabsByProject,
      filesByProject,
    }
  } catch {
    return { projects: [], tabsByProject: {}, filesByProject: {} }
  }
}

export function savePaletteRecents(recents: PaletteRecents): void {
  store.set(PALETTE_RECENTS_KEY, JSON.stringify(recents))
}

export function pushRecentPaletteProject(projectPath: string): PaletteRecents {
  const current = loadPaletteRecents()
  const next = {
    ...current,
    projects: pushRecent(current.projects, projectPath),
  }
  savePaletteRecents(next)
  return next
}

export function pushRecentPaletteTab(
  projectPath: string,
  tabId: string
): PaletteRecents {
  const current = loadPaletteRecents()
  const next = {
    ...current,
    tabsByProject: {
      ...current.tabsByProject,
      [projectPath]: pushRecent(
        current.tabsByProject[projectPath] ?? [],
        tabId
      ),
    },
  }
  savePaletteRecents(next)
  return next
}

export function pushRecentPaletteFile(
  projectPath: string,
  filePath: string
): PaletteRecents {
  const current = loadPaletteRecents()
  const next = {
    ...current,
    filesByProject: {
      ...current.filesByProject,
      [projectPath]: pushRecent(
        current.filesByProject[projectPath] ?? [],
        filePath
      ),
    },
  }
  savePaletteRecents(next)
  return next
}

export function loadRecentProjects(): RecentProject[] {
  try {
    const raw = store.get(RECENTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (p): p is RecentProject =>
        !!p && typeof p.name === "string" && typeof p.path === "string"
    )
  } catch {
    return []
  }
}

export function saveRecentProjects(recents: RecentProject[]): void {
  store.set(RECENTS_KEY, JSON.stringify(recents))
}

export function pushRecentProject(entry: RecentProject): RecentProject[] {
  const existing = loadRecentProjects().filter((p) => p.path !== entry.path)
  const next = [entry, ...existing]
  saveRecentProjects(next)
  return next
}

export function loadProjects(): StoredProject[] {
  try {
    const raw = store.get(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (p): p is StoredProject =>
          typeof p?.id === "string" &&
          typeof p?.name === "string" &&
          typeof p?.path === "string"
      )
      .map((p) => ({
        ...p,
        tabs: Array.isArray(p.tabs)
          ? p.tabs
              .filter(
                (t: unknown): t is StoredTab =>
                  !!t &&
                  typeof (t as StoredTab).id === "string" &&
                  typeof (t as StoredTab).name === "string"
              )
              .map((t) => {
                const panes: StoredPane[] = Array.isArray(t.panes)
                  ? t.panes
                      .filter(
                        (pp: unknown): pp is StoredPane =>
                          !!pp && typeof (pp as StoredPane).id === "string"
                      )
                      .map((pp) => ({
                        id: pp.id,
                        ...(typeof pp.sessionId === "string"
                          ? { sessionId: pp.sessionId }
                          : {}),
                        ...(typeof pp.autoTitle === "string"
                          ? { autoTitle: pp.autoTitle }
                          : {}),
                        ...(typeof pp.customName === "string"
                          ? { customName: pp.customName }
                          : {}),
                        ...(typeof pp.agentSessionId === "string"
                          ? { agentSessionId: pp.agentSessionId }
                          : {}),
                        ...(typeof pp.agentSessionTitle === "string"
                          ? { agentSessionTitle: pp.agentSessionTitle }
                          : {}),
                      }))
                  : [{ id: t.id }]
                return {
                  id: t.id,
                  name: t.name,
                  panes,
                  ...(typeof t.activePaneId === "string" &&
                  panes.some((pp) => pp.id === t.activePaneId)
                    ? { activePaneId: t.activePaneId }
                    : { activePaneId: panes[0]?.id ?? t.id }),
                  ...(typeof t.customName === "string"
                    ? { customName: t.customName }
                    : {}),
                  ...(t.layout && typeof t.layout === "object"
                    ? { layout: t.layout as TerminalLayout }
                    : {}),
                }
              })
          : [],
      }))
  } catch {
    return []
  }
}

export function saveProjects(projects: StoredProject[]): void {
  store.set(KEY, JSON.stringify(projects))
}

export function loadActiveProjectId(): string | null {
  try {
    return store.get(ACTIVE_KEY)
  } catch {
    return null
  }
}

export function saveActiveProjectId(id: string): void {
  if (id) store.set(ACTIVE_KEY, id)
  else store.remove(ACTIVE_KEY)
}

function parseLastAgentTerminal(value: unknown): LastAgentTerminal | null {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as LastAgentTerminal).projectId !== "string" ||
    typeof (value as LastAgentTerminal).projectPath !== "string" ||
    typeof (value as LastAgentTerminal).tabId !== "string" ||
    typeof (value as LastAgentTerminal).paneId !== "string"
  ) {
    return null
  }
  const parsed = value as LastAgentTerminal
  return {
    projectId: parsed.projectId,
    projectPath: parsed.projectPath,
    tabId: parsed.tabId,
    paneId: parsed.paneId,
    ...(typeof parsed.sessionId === "string"
      ? { sessionId: parsed.sessionId }
      : {}),
    updatedAt:
      typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
  }
}

export function loadLastAgentTerminals(): LastAgentTerminalsByProject {
  try {
    const raw = store.get(LAST_AGENT_TERMINAL_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    const legacy = parseLastAgentTerminal(parsed)
    if (legacy) return { [legacy.projectId]: legacy }
    if (!parsed || typeof parsed !== "object") return {}
    const out: LastAgentTerminalsByProject = {}
    for (const [projectId, value] of Object.entries(parsed)) {
      const target = parseLastAgentTerminal(value)
      if (target) out[projectId] = target
    }
    return out
  } catch {
    return {}
  }
}

export function saveLastAgentTerminals(
  targets: LastAgentTerminalsByProject
): void {
  try {
    store.set(LAST_AGENT_TERMINAL_KEY, JSON.stringify(targets))
  } catch {
    // ignore
  }
}

const SIDEBAR_WIDTH_KEY = "gearshift.sidebarWidth"

export function loadSidebarWidth(): number | null {
  try {
    const raw = store.get(SIDEBAR_WIDTH_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export function saveSidebarWidth(width: number): void {
  try {
    store.set(SIDEBAR_WIDTH_KEY, String(Math.round(width)))
  } catch {
    // ignore quota errors
  }
}

const PROJECT_SIDEBAR_WIDTH_KEY = "gearshift.projectSidebarWidth"

export function loadProjectSidebarWidth(): number | null {
  try {
    const raw = store.get(PROJECT_SIDEBAR_WIDTH_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export function saveProjectSidebarWidth(width: number): void {
  try {
    store.set(PROJECT_SIDEBAR_WIDTH_KEY, String(Math.round(width)))
  } catch {
    // ignore quota errors
  }
}

const SIDEBAR_OPEN_KEY = "gearshift.sidebarOpen"

export function loadSidebarOpen(): boolean {
  try {
    // Default closed when nothing is stored.
    return store.get(SIDEBAR_OPEN_KEY) === "1"
  } catch {
    return false
  }
}

export function saveSidebarOpen(open: boolean): void {
  try {
    store.set(SIDEBAR_OPEN_KEY, open ? "1" : "0")
  } catch {
    // ignore
  }
}

const PROJECT_SIDEBAR_OPEN_KEY = "gearshift.projectSidebarOpen"

export function loadProjectSidebarOpen(): boolean {
  try {
    // Default open unless explicitly collapsed.
    return store.get(PROJECT_SIDEBAR_OPEN_KEY) !== "0"
  } catch {
    return true
  }
}

export function saveProjectSidebarOpen(open: boolean): void {
  try {
    store.set(PROJECT_SIDEBAR_OPEN_KEY, open ? "1" : "0")
  } catch {
    // ignore
  }
}

const FOCUSED_PROJECT_IDS_KEY = "gearshift.focusedProjectIds"

export function loadFocusedProjectIds(): string[] {
  try {
    const raw = store.get(FOCUSED_PROJECT_IDS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((x) => typeof x === "string")
      : []
  } catch {
    return []
  }
}

export function saveFocusedProjectIds(ids: string[]): void {
  try {
    if (ids.length > 0) store.set(FOCUSED_PROJECT_IDS_KEY, JSON.stringify(ids))
    else store.remove(FOCUSED_PROJECT_IDS_KEY)
  } catch {
    // ignore
  }
}

const PROJECT_SIDEBAR_GROUP_OPEN_KEY = "gearshift.projectSidebarGroupOpen"

export type ProjectSidebarGroupOpenState = {
  pinned: boolean
  projects: boolean
}

const DEFAULT_PROJECT_SIDEBAR_GROUP_OPEN: ProjectSidebarGroupOpenState = {
  pinned: true,
  projects: true,
}

export function loadProjectSidebarGroupOpen(): ProjectSidebarGroupOpenState {
  try {
    const raw = store.get(PROJECT_SIDEBAR_GROUP_OPEN_KEY)
    if (!raw) return DEFAULT_PROJECT_SIDEBAR_GROUP_OPEN
    const parsed = JSON.parse(raw)
    return {
      pinned:
        typeof parsed?.pinned === "boolean"
          ? parsed.pinned
          : DEFAULT_PROJECT_SIDEBAR_GROUP_OPEN.pinned,
      projects:
        typeof parsed?.projects === "boolean"
          ? parsed.projects
          : DEFAULT_PROJECT_SIDEBAR_GROUP_OPEN.projects,
    }
  } catch {
    return DEFAULT_PROJECT_SIDEBAR_GROUP_OPEN
  }
}

export function saveProjectSidebarGroupOpen(
  state: ProjectSidebarGroupOpenState
): void {
  try {
    store.set(PROJECT_SIDEBAR_GROUP_OPEN_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

const PROJECT_SIDEBAR_SORT_KEY = "gearshift.projectSidebarSort"

export type ProjectSortMode = "manual" | "recent"

export function loadProjectSidebarSort(): ProjectSortMode {
  try {
    return store.get(PROJECT_SIDEBAR_SORT_KEY) === "recent"
      ? "recent"
      : "manual"
  } catch {
    return "manual"
  }
}

export function saveProjectSidebarSort(mode: ProjectSortMode): void {
  try {
    store.set(PROJECT_SIDEBAR_SORT_KEY, mode)
  } catch {
    // ignore
  }
}

const PINNED_PROJECT_PATHS_KEY = "gearshift.pinnedProjectPaths"

// Pinned projects are keyed by path (stable across sessions, like recents).
export function loadPinnedProjectPaths(): string[] {
  try {
    const raw = store.get(PINNED_PROJECT_PATHS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((x) => typeof x === "string")
      : []
  } catch {
    return []
  }
}

export function savePinnedProjectPaths(paths: string[]): void {
  try {
    if (paths.length > 0) {
      store.set(PINNED_PROJECT_PATHS_KEY, JSON.stringify(paths))
    } else {
      store.remove(PINNED_PROJECT_PATHS_KEY)
    }
  } catch {
    // ignore
  }
}

const RIGHT_SIDEBAR_TAB_KEY = "gearshift.rightSidebarTab"
const AUTO_HIDE_TITLE_BAR_KEY = "gearshift.autoHideTitleBar"
const HISTORY_RETENTION_ENABLED_KEY = "gearshift.historyRetentionEnabled"
const HISTORY_RETENTION_DAYS_KEY = "gearshift.historyRetentionDays"

export const HISTORY_RETENTION_DEFAULT_DAYS = 30
export const HISTORY_RETENTION_MIN_DAYS = 1

export const AUTO_HIDE_TITLE_BAR_EVENT = "gearshift:autoHideTitleBarChanged"
export type RightSidebarTab = "git" | "files" | "history"

export function loadRightSidebarTab(): RightSidebarTab {
  try {
    const v = store.get(RIGHT_SIDEBAR_TAB_KEY)
    if (v === "files" || v === "history") return v
    return "git"
  } catch {
    return "git"
  }
}

export function saveRightSidebarTab(tab: RightSidebarTab): void {
  try {
    store.set(RIGHT_SIDEBAR_TAB_KEY, tab)
  } catch {
    // ignore
  }
}

export function loadAutoHideTitleBar(): boolean {
  try {
    return store.get(AUTO_HIDE_TITLE_BAR_KEY) === "1"
  } catch {
    return false
  }
}

export function saveAutoHideTitleBar(enabled: boolean): void {
  try {
    store.set(AUTO_HIDE_TITLE_BAR_KEY, enabled ? "1" : "0")
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent<boolean>(AUTO_HIDE_TITLE_BAR_EVENT, {
          detail: enabled,
        })
      )
    }
  } catch {
    // ignore
  }
}

export const COMPACT_PROJECT_SIDEBAR_EVENT =
  "gearshift:compactProjectSidebarChanged"
const COMPACT_PROJECT_SIDEBAR_KEY = "gearshift.compactProjectSidebar"

export function loadCompactProjectSidebar(): boolean {
  try {
    const value = store.get(COMPACT_PROJECT_SIDEBAR_KEY)
    return value === null ? true : value === "1"
  } catch {
    return true
  }
}

export function saveCompactProjectSidebar(enabled: boolean): void {
  try {
    store.set(COMPACT_PROJECT_SIDEBAR_KEY, enabled ? "1" : "0")
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent<boolean>(COMPACT_PROJECT_SIDEBAR_EVENT, {
          detail: enabled,
        })
      )
    }
  } catch {
    // ignore
  }
}

export function loadHistoryRetentionEnabled(): boolean {
  try {
    // Enabled by default: only an explicit "0" disables it.
    return store.get(HISTORY_RETENTION_ENABLED_KEY) !== "0"
  } catch {
    return true
  }
}

export function saveHistoryRetentionEnabled(enabled: boolean): void {
  try {
    store.set(HISTORY_RETENTION_ENABLED_KEY, enabled ? "1" : "0")
  } catch {
    // ignore
  }
}

export function loadHistoryRetentionDays(): number {
  try {
    const raw = store.get(HISTORY_RETENTION_DAYS_KEY)
    const n = raw == null ? NaN : Math.floor(Number(raw))
    if (!Number.isFinite(n)) return HISTORY_RETENTION_DEFAULT_DAYS
    return Math.max(HISTORY_RETENTION_MIN_DAYS, n)
  } catch {
    return HISTORY_RETENTION_DEFAULT_DAYS
  }
}

export function saveHistoryRetentionDays(days: number): void {
  try {
    const n = Math.max(HISTORY_RETENTION_MIN_DAYS, Math.floor(days))
    store.set(HISTORY_RETENTION_DAYS_KEY, String(n))
  } catch {
    // ignore
  }
}

const DIFF_VIEW_MODE_KEY = "gearshift.diffViewMode"

export function loadDiffViewMode(): "unified" | "split" {
  try {
    return store.get(DIFF_VIEW_MODE_KEY) === "split" ? "split" : "unified"
  } catch {
    return "unified"
  }
}

export function saveDiffViewMode(mode: "unified" | "split"): void {
  try {
    store.set(DIFF_VIEW_MODE_KEY, mode)
  } catch {
    // ignore
  }
}

const PROJECT_COLORS_KEY = "gearshift.projectColors"
const PROJECT_AVATARS_KEY = "gearshift.projectAvatars"
export const PROJECT_AVATAR_CHANGED_EVENT = "gearshift:project-avatar-changed"

function dispatchProjectAvatarChanged(path: string): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent(PROJECT_AVATAR_CHANGED_EVENT, { detail: { path } })
  )
}

function loadProjectColors(): Record<string, string> {
  try {
    const raw = store.get(PROJECT_COLORS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function saveProjectColors(map: Record<string, string>): void {
  try {
    store.set(PROJECT_COLORS_KEY, JSON.stringify(map))
  } catch {
    // ignore
  }
}

function randomHexColor(): string {
  // Bias toward mid-luminance, vibrant colors so initials stay readable on
  // either light or dark backgrounds.
  const h = Math.floor(Math.random() * 360)
  const s = 55 + Math.floor(Math.random() * 25) // 55–80%
  const l = 45 + Math.floor(Math.random() * 15) // 45–60%
  // HSL → RGB
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0")
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/**
 * Get a stable hex color for a project, keyed by its path. Generates and
 * persists a new random color the first time a path is seen.
 */
export function getProjectColor(path: string): string {
  if (!path) return "#888888"
  const map = loadProjectColors()
  if (map[path]) return map[path]
  const color = randomHexColor()
  map[path] = color
  saveProjectColors(map)
  return color
}

export function randomizeProjectColor(path: string): string {
  if (!path) return "#888888"
  const map = loadProjectColors()
  const color = randomHexColor()
  map[path] = color
  saveProjectColors(map)
  dispatchProjectAvatarChanged(path)
  return color
}

function loadProjectAvatars(): Record<string, string> {
  try {
    const raw = store.get(PROJECT_AVATARS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function saveProjectAvatars(map: Record<string, string>): void {
  try {
    store.set(PROJECT_AVATARS_KEY, JSON.stringify(map))
  } catch {
    // ignore
  }
}

export function getProjectAvatarImagePath(path: string): string | null {
  if (!path) return null
  return loadProjectAvatars()[path] ?? null
}

export function getProjectAvatarImagePathMap(): Record<string, string> {
  return loadProjectAvatars()
}

export function setProjectAvatarImagePath(
  path: string,
  imagePath: string
): void {
  if (!path || !imagePath) return
  const map = loadProjectAvatars()
  map[path] = imagePath
  saveProjectAvatars(map)
  dispatchProjectAvatarChanged(path)
}

export function clearProjectAvatarImagePath(path: string): void {
  if (!path) return
  const map = loadProjectAvatars()
  delete map[path]
  saveProjectAvatars(map)
  dispatchProjectAvatarChanged(path)
}
