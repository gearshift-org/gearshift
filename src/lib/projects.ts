export type StoredTab = {
  id: string
  name: string
  customName?: string
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

export function loadProjects(): StoredProject[] {
  try {
    const raw = localStorage.getItem(KEY)
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
          ? p.tabs.filter(
              (t: unknown): t is StoredTab =>
                !!t &&
                typeof (t as StoredTab).id === "string" &&
                typeof (t as StoredTab).name === "string",
            )
          : [],
      }))
  } catch {
    return []
  }
}

export function saveProjects(projects: StoredProject[]): void {
  localStorage.setItem(KEY, JSON.stringify(projects))
}

export function loadActiveProjectId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

export function saveActiveProjectId(id: string): void {
  if (id) localStorage.setItem(ACTIVE_KEY, id)
  else localStorage.removeItem(ACTIVE_KEY)
}
