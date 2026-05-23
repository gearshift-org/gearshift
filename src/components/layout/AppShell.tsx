import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { TitleBar } from "./TitleBar"
import { TerminalTabBar } from "./TerminalTabBar"
import { WorkspaceSplit } from "./WorkspaceSplit"
import type { Project } from "./types"
import {
  loadProjects,
  loadRecentProjects,
  pushRecentProject,
  saveActiveProjectId,
  saveProjects,
  type RecentProject,
} from "@/lib/projects"

function makeId() {
  return crypto.randomUUID()
}

function basename(p: string) {
  return p.replace(/\/+$/, "").split("/").pop() || p
}

function serializeProjects(projects: Project[]) {
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    path: p.path,
    activeTabId: p.activeTerminalId,
    tabs: p.terminals.map((t) => ({
      id: t.id,
      name: t.name,
      ...(t.customName ? { customName: t.customName } : {}),
    })),
  }))
}

export function AppShell() {
  const navigate = useNavigate()
  const params = useParams({ strict: false }) as {
    projectId?: string
    terminalId?: string
  }
  const routeProjectId = params.projectId ?? null
  const routeTerminalId = params.terminalId ?? null

  const [projects, setProjects] = useState<Project[]>(() =>
    loadProjects().map((p) => ({
      id: p.id,
      name: p.name,
      path: p.path,
      terminals: (p.tabs ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        customName: t.customName,
        pendingStart: true,
      })),
      activeTerminalId: p.activeTabId ?? p.tabs?.[0]?.id ?? "",
    })),
  )

  const [recents, setRecents] = useState<RecentProject[]>(() =>
    loadRecentProjects(),
  )

  const [changesPaneOpen, setChangesPaneOpen] = useState(true)

  // Resolve current project from the route (with fallback to first project).
  const activeProjectId =
    (routeProjectId && projects.some((p) => p.id === routeProjectId)
      ? routeProjectId
      : projects[0]?.id) ?? ""
  const activeProject = projects.find((p) => p.id === activeProjectId)

  // Resolve current terminal: route → project's last-active → first.
  const activeTerminalId = (() => {
    if (!activeProject) return ""
    if (
      routeTerminalId &&
      activeProject.terminals.some((t) => t.id === routeTerminalId)
    ) {
      return routeTerminalId
    }
    if (
      activeProject.activeTerminalId &&
      activeProject.terminals.some(
        (t) => t.id === activeProject.activeTerminalId,
      )
    ) {
      return activeProject.activeTerminalId
    }
    return activeProject.terminals[0]?.id ?? ""
  })()

  const navigateToProject = useCallback(
    (id: string | null, terminalId?: string) => {
      if (!id) {
        void navigate({ to: "/" })
        return
      }
      if (terminalId) {
        void navigate({
          to: "/projects/$projectId/terminals/$terminalId",
          params: { projectId: id, terminalId },
        })
      } else {
        void navigate({
          to: "/projects/$projectId",
          params: { projectId: id },
        })
      }
    },
    [navigate],
  )

  const navigateToTerminal = useCallback(
    (terminalId: string) => {
      if (!activeProjectId || !terminalId) return
      void navigate({
        to: "/projects/$projectId/terminals/$terminalId",
        params: { projectId: activeProjectId, terminalId },
      })
    },
    [navigate, activeProjectId],
  )

  // Persist last-active project id from the route.
  useEffect(() => {
    saveActiveProjectId(activeProjectId)
  }, [activeProjectId])

  // Sync project's stored activeTerminalId with whatever the route shows so
  // future project switches restore the last terminal the user was on.
  useEffect(() => {
    if (!activeProjectId || !activeTerminalId) return
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProjectId && p.activeTerminalId !== activeTerminalId
          ? { ...p, activeTerminalId }
          : p,
      ),
    )
  }, [activeProjectId, activeTerminalId])

  // If the URL points at a missing project (e.g. after closing one) redirect
  // to whatever is active now.
  useEffect(() => {
    if (routeProjectId && !projects.some((p) => p.id === routeProjectId)) {
      navigateToProject(activeProjectId || null)
    }
  }, [routeProjectId, projects, activeProjectId, navigateToProject])

  // Seed recents with currently-open projects on first mount.
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

  // Persist project list + tabs whenever it changes.
  useEffect(() => {
    saveProjects(serializeProjects(projects))
  }, [projects])

  // Auto-spawn one terminal only when an active project has no tabs at all.
  useEffect(() => {
    if (!activeProject) return
    if (activeProject.terminals.length > 0) return
    let cancelled = false
    ;(async () => {
      const { id } = await window.term.create({ cwd: activeProject.path })
      if (cancelled) {
        window.term.kill(id)
        return
      }
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProject.id
            ? {
                ...p,
                terminals: [{ id, name: "Terminal 1" }],
                activeTerminalId: id,
              }
            : p,
        ),
      )
      void navigate({
        to: "/projects/$projectId/terminals/$terminalId",
        params: { projectId: activeProject.id, terminalId: id },
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
      navigateToProject(existing.id, existing.activeTerminalId || undefined)
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
        terminals: [],
        activeTerminalId: "",
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
    navigateToProject(id, p?.activeTerminalId || undefined)
  }

  const closeProject = (id: string) => {
    setProjects((prev) => {
      const target = prev.find((p) => p.id === id)
      if (target) {
        for (const t of target.terminals) {
          if (!t.pendingStart) window.term.kill(t.id)
        }
      }
      const next = prev.filter((p) => p.id !== id)
      if (id === activeProjectId) {
        const nextActive = next[0]
        if (nextActive) {
          navigateToProject(
            nextActive.id,
            nextActive.activeTerminalId || undefined,
          )
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
        for (const t of p.terminals) {
          if (!t.pendingStart) window.term.kill(t.id)
        }
      }
      const closedIds = new Set(toClose.map((p) => p.id))
      const next = prev.filter((p) => !closedIds.has(p.id))
      if (closedIds.has(activeProjectId)) {
        const keep = next.find((p) => p.id === id)
        navigateToProject(id, keep?.activeTerminalId || undefined)
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

  const reorderTerminals = (fromId: string, toId: string) => {
    if (fromId === toId || !activeProject) return
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== activeProjectId) return p
        const from = p.terminals.findIndex((t) => t.id === fromId)
        const to = p.terminals.findIndex((t) => t.id === toId)
        if (from < 0 || to < 0) return p
        const terminals = p.terminals.slice()
        const [moved] = terminals.splice(from, 1)
        terminals.splice(to, 0, moved)
        return { ...p, terminals }
      }),
    )
  }

  const closeOtherProjects = (keepId: string) => {
    setProjects((prev) => {
      for (const p of prev) {
        if (p.id === keepId) continue
        for (const t of p.terminals) {
          if (!t.pendingStart) window.term.kill(t.id)
        }
      }
      const next = prev.filter((p) => p.id === keepId)
      const keep = next[0]
      navigateToProject(keepId, keep?.activeTerminalId || undefined)
      return next
    })
  }

  const addTerminal = async () => {
    if (!activeProject) return
    const { id } = await window.term.create({ cwd: activeProject.path })
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== activeProject.id) return p
        return {
          ...p,
          terminals: [
            ...p.terminals,
            { id, name: `Terminal ${p.terminals.length + 1}` },
          ],
          activeTerminalId: id,
        }
      }),
    )
    navigateToTerminal(id)
  }

  const startingTerminalsRef = useRef(new Set<string>())

  const startTerminal = useCallback(
    async (projectId: string, tabId: string) => {
      const project = projects.find((p) => p.id === projectId)
      const tab = project?.terminals.find((t) => t.id === tabId)
      if (!project || !tab?.pendingStart) return

      const startKey = `${projectId}:${tabId}`
      if (startingTerminalsRef.current.has(startKey)) return
      startingTerminalsRef.current.add(startKey)

      try {
        const { id: newId } = await window.term.create({ cwd: project.path })
        setProjects((prev) =>
          prev.map((p) => {
            if (p.id !== projectId) return p
            return {
              ...p,
              terminals: p.terminals.map((t) =>
                t.id === tabId ? { ...t, id: newId, pendingStart: false } : t,
              ),
              activeTerminalId:
                p.activeTerminalId === tabId ? newId : p.activeTerminalId,
            }
          }),
        )
        // If the URL pointed at the placeholder, update it to the real id.
        if (
          routeProjectId === projectId &&
          routeTerminalId === tabId &&
          tabId !== newId
        ) {
          void navigate({
            to: "/projects/$projectId/terminals/$terminalId",
            params: { projectId, terminalId: newId },
            replace: true,
          })
        }
      } finally {
        startingTerminalsRef.current.delete(startKey)
      }
    },
    [projects, navigate, routeProjectId, routeTerminalId],
  )

  useEffect(() => {
    if (!activeProject || !activeTerminalId) return
    const activeTab = activeProject.terminals.find(
      (t) => t.id === activeTerminalId,
    )
    if (activeTab?.pendingStart) {
      void startTerminal(activeProject.id, activeTab.id)
    }
  }, [activeProject, activeTerminalId, startTerminal])

  const selectTerminal = (id: string) => {
    navigateToTerminal(id)
  }

  const setTerminalTitle = (terminalId: string, title: string) => {
    setProjects((prev) => {
      const next = prev.map((p) =>
        p.terminals.some((t) => t.id === terminalId)
          ? {
              ...p,
              terminals: p.terminals.map((t) =>
                t.id === terminalId ? { ...t, autoTitle: title } : t,
              ),
            }
          : p,
      )
      saveProjects(serializeProjects(next))
      return next
    })
  }

  const renameTerminal = (terminalId: string, name: string) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProjectId
          ? {
              ...p,
              terminals: p.terminals.map((t) =>
                t.id === terminalId
                  ? { ...t, customName: name || undefined }
                  : t,
              ),
            }
          : p,
      ),
    )
  }

  const closeTerminal = (id: string) => {
    const tab = activeProject?.terminals.find((t) => t.id === id)
    if (tab && !tab.pendingStart) window.term.kill(id)
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== activeProjectId) return p
        const closingIdx = p.terminals.findIndex((t) => t.id === id)
        const terminals = p.terminals.filter((t) => t.id !== id)
        let nextActive = p.activeTerminalId
        if (p.activeTerminalId === id) {
          const nextIdx = Math.max(0, closingIdx - 1)
          nextActive = terminals[nextIdx]?.id ?? ""
        }
        return { ...p, terminals, activeTerminalId: nextActive }
      }),
    )
    if (id === activeTerminalId) {
      const closingIdx =
        activeProject?.terminals.findIndex((t) => t.id === id) ?? -1
      const remaining =
        activeProject?.terminals.filter((t) => t.id !== id) ?? []
      const nextIdx = Math.max(0, closingIdx - 1)
      const next = remaining[nextIdx]?.id
      if (next) navigateToTerminal(next)
      else if (activeProjectId) navigateToProject(activeProjectId)
    }
  }

  const closeTerminalsToRight = (id: string) => {
    if (!activeProject) return
    const idx = activeProject.terminals.findIndex((t) => t.id === id)
    if (idx < 0) return
    const toClose = activeProject.terminals.slice(idx + 1)
    if (toClose.length === 0) return
    for (const t of toClose) {
      if (!t.pendingStart) window.term.kill(t.id)
    }
    const closedIds = new Set(toClose.map((t) => t.id))
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== activeProjectId) return p
        const terminals = p.terminals.filter((t) => !closedIds.has(t.id))
        const nextActive = closedIds.has(p.activeTerminalId)
          ? terminals[terminals.length - 1]?.id ?? ""
          : p.activeTerminalId
        return { ...p, terminals, activeTerminalId: nextActive }
      }),
    )
    if (closedIds.has(activeTerminalId)) navigateToTerminal(id)
  }

  const closeOtherTerminals = (keepId: string) => {
    if (!activeProject) return
    const toClose = activeProject.terminals.filter((t) => t.id !== keepId)
    if (toClose.length === 0) return
    for (const t of toClose) {
      if (!t.pendingStart) window.term.kill(t.id)
    }
    const keep = activeProject.terminals.find((t) => t.id === keepId)
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProjectId
          ? {
              ...p,
              terminals: keep ? [keep] : [],
              activeTerminalId: keep ? keep.id : "",
            }
          : p,
      ),
    )
    if (activeTerminalId !== keepId) navigateToTerminal(keepId)
  }

  const closeAllTerminals = () => {
    if (!activeProject) return
    for (const t of activeProject.terminals) {
      if (!t.pendingStart) window.term.kill(t.id)
    }
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProjectId
          ? { ...p, terminals: [], activeTerminalId: "" }
          : p,
      ),
    )
    navigateToProject(activeProjectId)
  }

  // Stable refs so the window-level keydown listener always has the latest handlers.
  const addTerminalRef = useRef<() => void>(() => undefined)
  const closeActiveTerminalRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    addTerminalRef.current = addTerminal
    closeActiveTerminalRef.current = () => {
      if (!activeTerminalId) return
      closeTerminal(activeTerminalId)
    }
  })

  useEffect(() => {
    const offNew = window.appApi.onNewTerminal(() => addTerminalRef.current())
    const offClose = window.appApi.onCloseTerminal(() =>
      closeActiveTerminalRef.current(),
    )
    return () => {
      offNew()
      offClose()
    }
  }, [])

  return (
    <div className="flex h-svh flex-col bg-background text-foreground">
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
        changesPaneOpen={changesPaneOpen}
        onToggleChangesPane={() => setChangesPaneOpen((v) => !v)}
      />
      {activeProject ? (
        <WorkspaceSplit
          projects={projects}
          activeProjectId={activeProjectId}
          changesPaneOpen={changesPaneOpen}
          onTerminalTitleChange={setTerminalTitle}
          onStartTerminal={(tabId) => {
            void startTerminal(activeProject.id, tabId)
          }}
          terminalTabs={
            <TerminalTabBar
              terminals={activeProject.terminals}
              activeId={activeTerminalId}
              onSelect={selectTerminal}
              onAdd={addTerminal}
              onClose={closeTerminal}
              onCloseAll={closeAllTerminals}
              onCloseOthers={closeOtherTerminals}
              onCloseToRight={closeTerminalsToRight}
              onRename={renameTerminal}
              onReorder={reorderTerminals}
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
