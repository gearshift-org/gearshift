import { store } from "./store"

export type StoredPane = {
  /** Stable DOM-key id assigned at create time. Persists across restarts. */
  id: string
  /** Daemon session id. Present → renderer attempts adopt on next launch. */
  sessionId?: string
  /** User-set name for this pane. */
  customName?: string
}

export type StoredTab = {
  id: string
  name: string
  customName?: string
  /** Persisted multi-pane state. Falls back to [{ id: tab.id }] for older snapshots. */
  panes?: StoredPane[]
  activePaneId?: string
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
const RECENTS_KEY = "gearshift.recentProjects"
const RECENTS_MAX = 10
const PALETTE_RECENTS_KEY = "gearshift.paletteRecents"
const PALETTE_RECENTS_MAX = 200

export type RecentProject = { name: string; path: string }

export type PaletteRecents = {
  projects: string[]
  tabsByProject: Record<string, string[]>
  filesByProject: Record<string, string[]>
}

function cleanStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
}

function pushRecent(list: string[], value: string, max = PALETTE_RECENTS_MAX): string[] {
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
      for (const [projectPath, files] of Object.entries(parsed.filesByProject)) {
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
  tabId: string,
): PaletteRecents {
  const current = loadPaletteRecents()
  const next = {
    ...current,
    tabsByProject: {
      ...current.tabsByProject,
      [projectPath]: pushRecent(current.tabsByProject[projectPath] ?? [], tabId),
    },
  }
  savePaletteRecents(next)
  return next
}

export function pushRecentPaletteFile(
  projectPath: string,
  filePath: string,
): PaletteRecents {
  const current = loadPaletteRecents()
  const next = {
    ...current,
    filesByProject: {
      ...current.filesByProject,
      [projectPath]: pushRecent(
        current.filesByProject[projectPath] ?? [],
        filePath,
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
        !!p && typeof p.name === "string" && typeof p.path === "string",
    )
  } catch {
    return []
  }
}

export function saveRecentProjects(recents: RecentProject[]): void {
  store.set(RECENTS_KEY, JSON.stringify(recents.slice(0, RECENTS_MAX)))
}

export function pushRecentProject(entry: RecentProject): RecentProject[] {
  const existing = loadRecentProjects().filter((p) => p.path !== entry.path)
  const next = [entry, ...existing].slice(0, RECENTS_MAX)
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
          typeof p?.path === "string",
      )
      .map((p) => ({
        ...p,
        tabs: Array.isArray(p.tabs)
          ? p.tabs
              .filter(
                (t: unknown): t is StoredTab =>
                  !!t &&
                  typeof (t as StoredTab).id === "string" &&
                  typeof (t as StoredTab).name === "string",
              )
              .map((t) => {
                const panes: StoredPane[] = Array.isArray(t.panes)
                  ? t.panes
                      .filter(
                        (pp: unknown): pp is StoredPane =>
                          !!pp && typeof (pp as StoredPane).id === "string",
                      )
                      .map((pp) => ({
                        id: pp.id,
                        ...(typeof pp.sessionId === "string"
                          ? { sessionId: pp.sessionId }
                          : {}),
                        ...(typeof pp.customName === "string"
                          ? { customName: pp.customName }
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

const RIGHT_SIDEBAR_TAB_KEY = "gearshift.rightSidebarTab"

export type RightSidebarTab = "changes" | "files"

export function loadRightSidebarTab(): RightSidebarTab {
  try {
    return store.get(RIGHT_SIDEBAR_TAB_KEY) === "files" ? "files" : "changes"
  } catch {
    return "changes"
  }
}

export function saveRightSidebarTab(tab: RightSidebarTab): void {
  try {
    store.set(RIGHT_SIDEBAR_TAB_KEY, tab)
  } catch {
    // ignore
  }
}

const DIFF_VIEW_MODE_KEY = "gearshift.diffViewMode"

export function loadDiffViewMode(): "unified" | "split" {
  try {
    return store.get(DIFF_VIEW_MODE_KEY) === "split"
      ? "split"
      : "unified"
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
  return color
}
