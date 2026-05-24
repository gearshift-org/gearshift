import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useKeybindings } from "@/lib/keybindings/useKeybindings"
import { toast } from "sonner"
import { PanelRight } from "lucide-react"
import { ProjectGitStatusBadge } from "./ProjectGitStatusBadge"
import { TitleBar } from "./TitleBar"
import { ThemeToggle } from "./ThemeToggle"
import { WorkspaceTabBar } from "./WorkspaceTabBar"
import { WorkspaceSplit } from "./WorkspaceSplit"
import { CommandPalette } from "./CommandPalette"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { tabDisplayName } from "./terminalName"
import agentCompleteSoundUrl from "@/assets/sounds/agent-complete.wav?url"
import type { Project, TerminalAgentStatus, WorkspaceTab } from "./types"
import {
  loadActiveProjectId,
  loadPaletteRecents,
  loadProjects,
  loadRecentProjects,
  loadRightSidebarTab,
  loadSidebarOpen,
  pushRecentPaletteFile,
  pushRecentPaletteProject,
  pushRecentPaletteTab,
  pushRecentProject,
  saveActiveProjectId,
  saveProjects,
  saveRightSidebarTab,
  saveSidebarOpen,
  type PaletteRecents,
  type RecentProject,
  type RightSidebarTab,
  type StoredProject,
} from "@/lib/projects"
import { store } from "@/lib/store"

function hydrateProjects(): Project[] {
  return loadProjects().map((p: StoredProject) => ({
    id: p.id,
    name: p.name,
    path: p.path,
    tabs: (p.tabs ?? []).map((t) => {
      const storedPanes =
        t.panes && t.panes.length > 0 ? t.panes : [{ id: t.id }]
      const panes = storedPanes.map((sp) => ({
        id: sp.id,
        pendingStart: true,
        ...(sp.sessionId ? { pendingSessionId: sp.sessionId } : {}),
        ...(sp.customName ? { customName: sp.customName } : {}),
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
      }
    }),
    activeTabId: p.activeTabId ?? p.tabs?.[0]?.id ?? "",
  }))
}

function makeId() {
  return crypto.randomUUID()
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
        activePaneId: t.activePaneId,
        panes: t.panes.map((pp) => {
          // Persist the live sessionId for running panes, and keep the
          // pending one for panes the user hasn't activated yet — that way
          // a relaunch can still try to adopt them.
          const sid = pp.sessionId ?? pp.pendingSessionId
          return {
            id: pp.id,
            ...(sid ? { sessionId: sid } : {}),
            ...(pp.customName ? { customName: pp.customName } : {}),
          }
        }),
      })),
    }
  })
}

function agentDoneToastId(projectId: string, tabId: string, paneId: string) {
  return `agent-done:${projectId}:${tabId}:${paneId}`
}

function dismissProjectAgentDoneToasts(project: Project) {
  for (const tab of project.tabs) {
    if (tab.kind !== "terminal") continue
    for (const pane of tab.panes) {
      toast.dismiss(agentDoneToastId(project.id, tab.id, pane.id))
    }
  }
}

function isAppVisibleAndFocused() {
  return document.visibilityState === "visible" && document.hasFocus()
}

function playAgentCompleteSound() {
  const audio = new Audio(agentCompleteSoundUrl)
  audio.volume = 0.5
  void audio.play().catch(() => {
    // Sound playback can be blocked until the user has interacted with the app.
  })
}

export function AppShell() {
  const navigate = useNavigate()
  const params = useParams({ strict: false }) as {
    projectId?: string
    tabId?: string
  }
  const routeProjectId = params.projectId ?? null
  const routeTabId = params.tabId ?? null

  const [projects, setProjects] = useState<Project[]>(() => hydrateProjects())
  const [recents, setRecents] = useState<RecentProject[]>(() =>
    loadRecentProjects()
  )
  const [paletteRecents, setPaletteRecents] = useState<PaletteRecents>(() =>
    loadPaletteRecents()
  )
  const [sidebarOpen, setSidebarOpen] = useState(() => loadSidebarOpen())
  const [rightSidebarTab, setRightSidebarTab] = useState<RightSidebarTab>(() =>
    loadRightSidebarTab()
  )
  const [stateRestored, setStateRestored] = useState(() => store.isReady())
  const [restoredActiveProjectId, setRestoredActiveProjectId] = useState<
    string | null
  >(() => loadActiveProjectId())

  // Disk snapshot arrives async — re-sync once it lands so the UI can paint
  // immediately with empty state and then fill in. Also restores the last
  // active project (router boots at "/" since hydration isn't sync anymore).
  useEffect(
    () =>
      store.onReady(() => {
        const hydrated = hydrateProjects()
        setProjects(hydrated)
        setRecents(loadRecentProjects())
        setPaletteRecents(loadPaletteRecents())
        setSidebarOpen(loadSidebarOpen())
        setRightSidebarTab(loadRightSidebarTab())
        const storedActiveId = loadActiveProjectId()
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
  const terminalAgentStatusRef = useRef(new Map<string, TerminalAgentStatus>())

  useEffect(() => {
    saveSidebarOpen(sidebarOpen)
  }, [sidebarOpen])
  useEffect(() => {
    saveRightSidebarTab(rightSidebarTab)
  }, [rightSidebarTab])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [activeTreeFilePath, setActiveTreeFilePath] = useState("")

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

  useEffect(() => {
    if (!stateRestored) return
    saveActiveProjectId(activeProjectId)
    if (activeProjectPath) pushRecentPaletteProject(activeProjectPath)
  }, [activeProjectId, activeProjectPath, stateRestored])

  useEffect(() => {
    if (!activeProjectId) return
    const activeProject = projects.find((p) => p.id === activeProjectId)
    if (activeProject) dismissProjectAgentDoneToasts(activeProject)
    if (!activeProject?.agentDone) return
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProjectId && p.agentDone ? { ...p, agentDone: false } : p
      )
    )
  }, [activeProjectId, projects])

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

  const openProjectByPath = async (path: string, name?: string) => {
    const existing = projects.find((p) => p.path === path)
    if (existing) {
      navigateToProject(existing.id, existing.activeTabId || undefined)
      return
    }
    const id = makeId()
    const tabId = makeId()
    const resolvedName = name || basename(path)
    const { id: paneId } = await window.term.create({ cwd: path })
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
  }

  const addProject = async () => {
    const path = await window.dialogApi.openProject()
    if (!path) return
    void openProjectByPath(path)
  }

  const pickRecent = (recent: RecentProject) => {
    void openProjectByPath(recent.path, recent.name)
  }

  const selectProject = (id: string) => {
    const p = projects.find((x) => x.id === id)
    if (p) dismissProjectAgentDoneToasts(p)
    setProjects((prev) =>
      prev.map((project) =>
        project.id === id && project.agentDone
          ? { ...project, agentDone: false }
          : project
      )
    )
    navigateToProject(id, p?.activeTabId || undefined)
  }

  const closeProject = (id: string) => {
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

  const closeAllProjectTerminals = (id: string) => {
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
        return { ...p, tabs, activeTabId }
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

  const closeProjectsToRight = (id: string) => {
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
      }),
    )
  }

  const reorderPanes = (tabId: string, fromPaneId: string, toPaneId: string) => {
    if (fromPaneId === toPaneId || !activeProjectId) return
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== activeProjectId) return p
        return {
          ...p,
          tabs: p.tabs.map((t) => {
            if (t.id !== tabId || t.kind !== "terminal") return t
            const from = t.panes.findIndex((pp) => pp.id === fromPaneId)
            const to = t.panes.findIndex((pp) => pp.id === toPaneId)
            if (from < 0 || to < 0) return t
            const panes = t.panes.slice()
            const [moved] = panes.splice(from, 1)
            panes.splice(to, 0, moved)
            return { ...t, panes }
          }),
        }
      }),
    )
  }

  const closeOtherProjects = (keepId: string) => {
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

  const addTerminal = async () => {
    if (!activeProject) return
    const { id: paneId } = await window.term.create({ cwd: activeProject.path })
    const tabId = makeId()
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== activeProject.id) return p
        const terminalCount = p.tabs.filter((t) => t.kind === "terminal").length
        return {
          ...p,
          tabs: [
            ...p.tabs,
            {
              kind: "terminal" as const,
              id: tabId,
              name: `Terminal ${terminalCount + 1}`,
              panes: [{ id: paneId, sessionId: paneId }],
              activePaneId: paneId,
            },
          ],
          activeTabId: tabId,
        }
      })
    )
    navigateToTab(tabId)
  }

  /** Add a new terminal pane to an existing terminal tab (Cmd+D / split). */
  const splitTerminalPane = useCallback(
    async (tabId: string) => {
      if (!activeProject) return
      const tab = activeProject.tabs.find((t) => t.id === tabId)
      if (!tab || tab.kind !== "terminal") return
      const { id: paneId } = await window.term.create({
        cwd: activeProject.path,
      })
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProject.id
            ? {
                ...p,
                tabs: p.tabs.map((t) =>
                  t.id === tabId && t.kind === "terminal"
                    ? {
                        ...t,
                        panes: [...t.panes, { id: paneId, sessionId: paneId }],
                        activePaneId: paneId,
                      }
                    : t
                ),
              }
            : p
        )
      )
    },
    [activeProject]
  )

  /** Close a single pane within a terminal tab. Closes the tab if it was the last. */
  const closePane = useCallback(
    (tabId: string, paneId: string) => {
      const tab = activeProject?.tabs.find((t) => t.id === tabId)
      if (!tab || tab.kind !== "terminal") return
      const pane = tab.panes.find((pp) => pp.id === paneId)
      if (!pane) return
      if (!pane.pendingStart) {
        try {
          window.term.kill(paneId)
        } catch {
          // ignore
        }
      }
      if (tab.panes.length <= 1) {
        // last pane → close the tab entirely
        closeTabRef.current?.(tabId)
        return
      }
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id !== activeProjectId) return p
          return {
            ...p,
            tabs: p.tabs.map((t) => {
              if (t.id !== tabId || t.kind !== "terminal") return t
              const panes = t.panes.filter((pp) => pp.id !== paneId)
              const nextActive =
                t.activePaneId === paneId
                  ? (panes[panes.length - 1]?.id ?? "")
                  : t.activePaneId
              return { ...t, panes, activePaneId: nextActive }
            }),
          }
        })
      )
    },
    [activeProject, activeProjectId]
  )

  const setActivePane = useCallback(
    (tabId: string, paneId: string) => {
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
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? {
                ...p,
                agentDone: false,
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
    (path: string) => {
      if (!activeProject) return
      setActiveTreeFilePath(path)
      setPaletteRecents(pushRecentPaletteFile(activeProject.path, path))
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
            const res = await window.term.adopt(pane.pendingSessionId)
            if (res.ok) sessionId = pane.pendingSessionId
          } catch {
            // fall through to create
          }
        }
        if (!sessionId) {
          const { id } = await window.term.create({ cwd: project.path })
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
    (path: string) => {
      setSidebarOpen(true)
      setRightSidebarTab("files")
      setActiveTreeFilePath(path)
      openFileTab(path)
    },
    [openFileTab]
  )

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
    const finishedWork = wasWorking && !status.working
    const appVisibleAndFocused = isAppVisibleAndFocused()
    const finishedAwayFromAttention =
      finishedWork &&
      !!targetProject &&
      (targetProject.id !== activeProjectId || !appVisibleAndFocused)

    setProjects((prev) =>
      prev.map((p) => {
        if (!p.tabs.some((t) => t.id === tabId)) return p

        const tabs = p.tabs.map((t) => {
          if (t.id !== tabId || t.kind !== "terminal") return t
          return {
            ...t,
            panes: t.panes.map((pp) =>
              pp.id === paneId ? { ...pp, agentStatus: status } : pp
            ),
          }
        })

        return {
          ...p,
          tabs,
          agentDone:
            status.working || p.id === activeProjectId
              ? false
              : finishedWork
                ? true
                : p.agentDone,
        }
      })
    )

    if (
      finishedAwayFromAttention &&
      targetProject &&
      targetTab?.kind === "terminal"
    ) {
      playAgentCompleteSound()
      const terminalName = tabDisplayName(targetTab)
      const toastId = agentDoneToastId(targetProject.id, tabId, paneId)
      if (appVisibleAndFocused) {
        console.info("Agent complete: showing in-app toast")
        toast.custom(
          (id) => (
            <button
              type="button"
              onClick={() =>
                openAgentDoneTarget(targetProject.id, tabId, paneId, id)
              }
              className="flex w-full min-w-72 items-start gap-3 rounded-md border border-border bg-popover p-3 text-left text-popover-foreground shadow-lg"
            >
              <span className="mt-1 size-2 shrink-0 rounded-full bg-emerald-500" />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-medium">Agent finished</span>
                <span className="flex min-w-0 items-baseline gap-1 text-xs">
                  <span className="max-w-36 truncate font-semibold text-foreground">
                    {targetProject.name}
                  </span>
                  <span className="shrink-0 text-muted-foreground">·</span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {terminalName}
                  </span>
                </span>
              </span>
            </button>
          ),
          {
            id: toastId,
            duration: Infinity,
          }
        )
      } else {
        console.info("Agent complete: showing desktop notification")
        if (typeof Notification !== "undefined") {
          try {
            const notification = new Notification(
              targetProject.name || "GearShift",
              {
                body: `Agent finished in ${terminalName}`,
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

  const closeTab = (id: string) => {
    const tab = activeProject?.tabs.find((t) => t.id === id)
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

  const closeTabsToRight = (id: string) => {
    if (!activeProject) return
    const idx = activeProject.tabs.findIndex((t) => t.id === id)
    if (idx < 0) return
    const toClose = activeProject.tabs.slice(idx + 1)
    if (toClose.length === 0) return
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

  const closeOtherTabs = (keepId: string) => {
    if (!activeProject) return
    const toClose = activeProject.tabs.filter((t) => t.id !== keepId)
    if (toClose.length === 0) return
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

  const closeAllTabs = () => {
    if (!activeProject) return
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
  const splitActiveTerminalRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    addTerminalRef.current = addTerminal
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
    splitActiveTerminalRef.current = () => {
      if (!activeProject || !activeTabId) return
      const active = activeProject.tabs.find((t) => t.id === activeTabId)
      if (active?.kind === "terminal") {
        void splitTerminalPane(activeTabId)
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

  const { findActionForEvent } = useKeybindings()
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.dataset?.keycapture === "true") return
      const action = findActionForEvent(e)
      if (!action) return
      switch (action) {
        case "sidebar.toggle":
          e.preventDefault()
          setSidebarOpen((v) => !v)
          break
        case "palette.open":
          e.preventDefault()
          setPaletteOpen((v) => !v)
          break
        case "terminal.split":
          e.preventDefault()
          splitActiveTerminalRef.current()
          break
        case "settings.open":
          e.preventDefault()
          void navigate({ to: "/settings" })
          break
        default:
          break
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [findActionForEvent, navigate])

  return (
    <div className="flex h-svh flex-col bg-background text-foreground">
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
      {(() => {
        const toggleSidebar = () => setSidebarOpen((v) => !v)
        const openChanges = () => {
          setRightSidebarTab("changes")
          setSidebarOpen(true)
        }
        const titleBar = (
          <TitleBar
            projects={projects}
            activeProjectId={activeProjectId}
            recents={recents.filter(
              (r) => !projects.some((p) => p.path === r.path)
            )}
            onSelectProject={selectProject}
            onAddProject={addProject}
            onPickRecent={pickRecent}
            onCloseProject={closeProject}
            onCloseAllProjectTerminals={closeAllProjectTerminals}
            onCloseOtherProjects={closeOtherProjects}
            onCloseProjectsToRight={closeProjectsToRight}
            onOpenProjectInVSCode={openProjectInVSCode}
            onReorderProjects={reorderProjects}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={toggleSidebar}
            onOpenChanges={openChanges}
            showRightControls={!sidebarOpen || !activeProject}
          />
        )
        const sidebarTopActions = (
          <div className="flex items-center pr-1">
            <ProjectGitStatusBadge
              cwd={activeProject.path}
              onOpenChanges={openChanges}
            />
            <ThemeToggle />
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
        if (!activeProject) {
          return (
            <>
              {titleBar}
              <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
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
            sidebarOpen={sidebarOpen}
            titleBar={titleBar}
            sidebarTopActions={sidebarTopActions}
            onTerminalTitleChange={setTerminalTitle}
            onTerminalAgentStatusChange={setTerminalAgentStatus}
            onStartTerminal={(tabId, paneId) => {
              void startTerminalPane(activeProject.id, tabId, paneId)
            }}
            onAddTerminal={() => void addTerminal()}
            onSplitTerminal={(tabId) => void splitTerminalPane(tabId)}
            onClosePane={closePane}
            onFocusPane={setActivePane}
            onRenamePane={renamePane}
            onReorderPanes={reorderPanes}
            onOpenDiffTab={openDiffTab}
            onOpenFileTab={openFileTab}
            rightSidebarTab={rightSidebarTab}
            onRightSidebarTabChange={setRightSidebarTab}
            activeTreeFilePath={activeTreeFilePath}
            workspaceTabs={
              <WorkspaceTabBar
                tabs={activeProject.tabs}
                activeId={activeTabId}
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
              />
            }
          />
        )
      })()}
    </div>
  )
}
