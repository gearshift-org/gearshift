import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { TitleBar } from "./TitleBar"
import { WorkspaceTabBar } from "./WorkspaceTabBar"
import { WorkspaceSplit } from "./WorkspaceSplit"
import { CommandPalette } from "./CommandPalette"
import type { Project, WorkspaceTab } from "./types"
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
    tabs: (p.tabs ?? []).map((t) => ({
      kind: "terminal" as const,
      id: t.id,
      name: t.name,
      customName: t.customName,
      panes: [{ id: t.id, pendingStart: true }],
      activePaneId: t.id,
    })),
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
    if (!pane.pendingStart) {
      try {
        window.term.kill(pane.id)
      } catch {
        // ignore
      }
    }
  }
}

function serializeProjects(projects: Project[]) {
  return projects.map((p) => {
    const terminals = p.tabs.filter((t) => t.kind === "terminal")
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
      })),
    }
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
    loadRecentProjects(),
  )
  const [paletteRecents, setPaletteRecents] = useState<PaletteRecents>(() =>
    loadPaletteRecents(),
  )
  const [sidebarOpen, setSidebarOpen] = useState(() => loadSidebarOpen())
  const [rightSidebarTab, setRightSidebarTab] = useState<RightSidebarTab>(() =>
    loadRightSidebarTab(),
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
    [],
  )
  // Forward reference: closePane (defined below) calls closeTab when the last
  // pane is being closed. Wired via effect once both are defined.
  const closeTabRef = useRef<(id: string) => void>(() => undefined)

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
    [navigate, stateRestored],
  )

  const navigateToTab = useCallback(
    (tabId: string) => {
      if (!activeProjectId || !tabId) return
      void navigate({
        to: "/projects/$projectId/tabs/$tabId",
        params: { projectId: activeProjectId, tabId },
      })
    },
    [navigate, activeProjectId],
  )

  useEffect(() => {
    if (!stateRestored) return
    saveActiveProjectId(activeProjectId)
    if (activeProjectPath) pushRecentPaletteProject(activeProjectPath)
  }, [activeProjectId, activeProjectPath, stateRestored])

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
          : p,
      ),
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

  // Auto-spawn one terminal only when an active project has no tabs at all.
  useEffect(() => {
    if (!activeProject) return
    if (activeProject.tabs.length > 0) return
    let cancelled = false
    ;(async () => {
      const { id } = await window.term.create({ cwd: activeProject.path })
      if (cancelled) {
        window.term.kill(id)
        return
      }
      const tabId = makeId()
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProject.id
            ? {
                ...p,
                tabs: [
                  {
                    kind: "terminal",
                    id: tabId,
                    name: "Terminal 1",
                    panes: [{ id }],
                    activePaneId: id,
                  },
                ] as WorkspaceTab[],
                activeTabId: tabId,
              }
            : p,
        ),
      )
      void navigate({
        to: "/projects/$projectId/tabs/$tabId",
        params: { projectId: activeProject.id, tabId },
        replace: true,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [activeProject, navigate])

  const openProjectByPath = (path: string, name?: string) => {
    const existing = projects.find((p) => p.path === path)
    if (existing) {
      navigateToProject(existing.id, existing.activeTabId || undefined)
      return
    }
    const id = makeId()
    const resolvedName = name || basename(path)
    setProjects((prev) => [
      ...prev,
      {
        id,
        name: resolvedName,
        path,
        tabs: [],
        activeTabId: "",
      },
    ])
    navigateToProject(id)
    setRecents(pushRecentProject({ name: resolvedName, path }))
  }

  const addProject = async () => {
    const path = await window.dialogApi.openProject()
    if (!path) return
    openProjectByPath(path)
  }

  const pickRecent = (recent: RecentProject) => {
    openProjectByPath(recent.path, recent.name)
  }

  const selectProject = (id: string) => {
    const p = projects.find((x) => x.id === id)
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
              panes: [{ id: paneId }],
              activePaneId: paneId,
            },
          ],
          activeTabId: tabId,
        }
      }),
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
                        panes: [...t.panes, { id: paneId }],
                        activePaneId: paneId,
                      }
                    : t,
                ),
              }
            : p,
        ),
      )
    },
    [activeProject],
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
                  ? panes[panes.length - 1]?.id ?? ""
                  : t.activePaneId
              return { ...t, panes, activePaneId: nextActive }
            }),
          }
        }),
      )
    },
    [activeProject, activeProjectId],
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
                    : t,
                ),
              }
            : p,
        ),
      )
    },
    [activeProjectId],
  )

  const openDiffTab = useCallback(
    (path: string, staged: boolean) => {
      if (!activeProject) return
      // Already open (pinned or preview) for the exact same path/staged — focus.
      const exact = activeProject.tabs.find(
        (t) => t.kind === "diff" && t.path === path && t.staged === staged,
      )
      if (exact) {
        navigateToTab(exact.id)
        return
      }
      // Reuse the existing preview diff tab if any (VS Code-style).
      const preview = activeProject.tabs.find(
        (t) => t.kind === "diff" && t.preview,
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
                      : t,
                  ),
                  activeTabId: preview.id,
                }
              : p,
          ),
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
            : p,
        ),
      )
      navigateToTab(id)
    },
    [activeProject, navigateToTab],
  )

  const openFileTab = useCallback(
    (path: string) => {
      if (!activeProject) return
      setActiveTreeFilePath(path)
      setPaletteRecents(pushRecentPaletteFile(activeProject.path, path))
      const exact = activeProject.tabs.find(
        (t) => t.kind === "file" && t.path === path,
      )
      if (exact) {
        navigateToTab(exact.id)
        return
      }
      // Reuse the existing preview file tab if any.
      const preview = activeProject.tabs.find(
        (t) => t.kind === "file" && t.preview,
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
                      : t,
                  ),
                  activeTabId: preview.id,
                }
              : p,
          ),
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
            : p,
        ),
      )
      navigateToTab(id)
    },
    [activeProject, navigateToTab],
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
                  : t,
              ),
            }
          : p,
      ),
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
        const { id: newId } = await window.term.create({ cwd: project.path })
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
                      ? { ...pp, id: newId, pendingStart: false }
                      : pp,
                  ),
                  activePaneId:
                    t.activePaneId === paneId ? newId : t.activePaneId,
                }
              }),
            }
          }),
        )
      } finally {
        startingTerminalsRef.current.delete(startKey)
      }
    },
    [projects],
  )

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
    [openFileTab],
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
          (id) => id !== activeTabId,
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
                        pp.id === paneId ? { ...pp, autoTitle: title } : pp,
                      ),
                    }
                  : t,
              ),
            }
          : p,
      )
      saveProjects(serializeProjects(next))
      return next
    })
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
                  : t,
              ),
            }
          : p,
      ),
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
      }),
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
          ? tabs[tabs.length - 1]?.id ?? ""
          : p.activeTabId
        return { ...p, tabs, activeTabId: nextActive }
      }),
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
          : p,
      ),
    )
    if (activeTabId !== keepId) navigateToTab(keepId)
  }

  const closeAllTabs = () => {
    if (!activeProject) return
    for (const t of activeProject.tabs) killAllPanes(t)
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProjectId ? { ...p, tabs: [], activeTabId: "" } : p,
      ),
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
      closeActiveTabRef.current(),
    )
    return () => {
      offNew()
      offClose()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && !e.shiftKey && !e.altKey && e.key === "2") {
        e.preventDefault()
        setSidebarOpen((v) => !v)
      }
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
        e.preventDefault()
        splitActiveTerminalRef.current()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

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
      <TitleBar
        projects={projects}
        activeProjectId={activeProjectId}
        recents={recents.filter(
          (r) => !projects.some((p) => p.path === r.path),
        )}
        onSelectProject={selectProject}
        onAddProject={addProject}
        onPickRecent={pickRecent}
        onCloseProject={closeProject}
        onCloseOtherProjects={closeOtherProjects}
        onCloseProjectsToRight={closeProjectsToRight}
        onOpenProjectInVSCode={openProjectInVSCode}
        onReorderProjects={reorderProjects}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />
      {activeProject ? (
        <WorkspaceSplit
          projects={projects}
          activeProjectId={activeProjectId}
          sidebarOpen={sidebarOpen}
          onTerminalTitleChange={setTerminalTitle}
          onStartTerminal={(tabId, paneId) => {
            void startTerminalPane(activeProject.id, tabId, paneId)
          }}
          onSplitTerminal={(tabId) => void splitTerminalPane(tabId)}
          onClosePane={closePane}
          onFocusPane={setActivePane}
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
      ) : (
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
      )}
    </div>
  )
}
