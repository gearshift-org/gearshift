import { useCallback, useEffect, useRef, useState } from "react"
import { TitleBar } from "./TitleBar"
import { TerminalTabBar } from "./TerminalTabBar"
import { WorkspaceSplit } from "./WorkspaceSplit"
import type { Project } from "./types"
import {
  loadActiveProjectId,
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
  const [activeProjectId, setActiveProjectId] = useState<string>(() => {
    const stored = loadActiveProjectId()
    if (stored && projects.some((p) => p.id === stored)) return stored
    return projects[0]?.id ?? ""
  })

  const [recents, setRecents] = useState<RecentProject[]>(() =>
    loadRecentProjects(),
  )

  useEffect(() => {
    saveActiveProjectId(activeProjectId)
  }, [activeProjectId])

  // Seed recents with currently-open projects on first mount so they show up
  // again after being closed.
  useEffect(() => {
    let next = recents
    for (const p of projects) {
      if (!next.some((r) => r.path === p.path)) {
        next = pushRecentProject({ name: p.name, path: p.path })
      }
    }
    if (next !== recents) setRecents(next)
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist project list + tabs whenever it changes.
  useEffect(() => {
    saveProjects(serializeProjects(projects))
  }, [projects])

  const activeProject = projects.find((p) => p.id === activeProjectId)

  // Auto-spawn one terminal only when a project has no tabs at all
  // (i.e. newly added projects, not restored ones).
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
    })()
    return () => {
      cancelled = true
    }
  }, [activeProject])

  const openProjectByPath = (path: string, name?: string) => {
    const existing = projects.find((p) => p.path === path)
    if (existing) {
      setActiveProjectId(existing.id)
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
    setActiveProjectId(id)
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
        setActiveProjectId(next[0]?.id ?? "")
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
      if (closedIds.has(activeProjectId)) setActiveProjectId(id)
      return next
    })
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
      setActiveProjectId(keepId)
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
      } finally {
        startingTerminalsRef.current.delete(startKey)
      }
    },
    [projects],
  )

  useEffect(() => {
    if (!activeProject?.activeTerminalId) return
    const activeTab = activeProject.terminals.find(
      (t) => t.id === activeProject.activeTerminalId,
    )
    if (activeTab?.pendingStart) {
      void startTerminal(activeProject.id, activeTab.id)
    }
  }, [activeProject, startTerminal])

  const selectTerminal = (id: string) => {
    const selected = activeProject?.terminals.find((t) => t.id === id)
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProjectId ? { ...p, activeTerminalId: id } : p,
      ),
    )
    if (selected?.pendingStart) {
      void startTerminal(activeProjectId, id)
    }
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
        let activeTerminalId = p.activeTerminalId
        if (p.activeTerminalId === id) {
          // Prefer the tab to the left; fall back to the new tab now at this index.
          const nextIdx = Math.max(0, closingIdx - 1)
          activeTerminalId = terminals[nextIdx]?.id ?? ""
        }
        return { ...p, terminals, activeTerminalId }
      }),
    )
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
        const activeTerminalId = closedIds.has(p.activeTerminalId)
          ? terminals[terminals.length - 1]?.id ?? ""
          : p.activeTerminalId
        return { ...p, terminals, activeTerminalId }
      }),
    )
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
  }

  // Stable refs so the window-level keydown listener always has the latest handlers.
  const addTerminalRef = useRef<() => void>(() => undefined)
  const closeActiveTerminalRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    addTerminalRef.current = addTerminal
    closeActiveTerminalRef.current = () => {
      const ap = projects.find((p) => p.id === activeProjectId)
      if (!ap?.activeTerminalId) return
      closeTerminal(ap.activeTerminalId)
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
        onSelectProject={setActiveProjectId}
        onAddProject={addProject}
        onPickRecent={pickRecent}
        onCloseProject={closeProject}
        onCloseOtherProjects={closeOtherProjects}
        onCloseProjectsToRight={closeProjectsToRight}
      />
      <TerminalTabBar
        terminals={activeProject?.terminals ?? []}
        activeId={activeProject?.activeTerminalId ?? ""}
        onSelect={selectTerminal}
        onAdd={addTerminal}
        onClose={closeTerminal}
        onCloseAll={closeAllTerminals}
        onCloseToRight={closeTerminalsToRight}
        onRename={renameTerminal}
      />
      <WorkspaceSplit
        projects={projects}
        activeProjectId={activeProjectId}
        onTerminalTitleChange={setTerminalTitle}
        onStartTerminal={(tabId) => {
          if (!activeProject) return
          void startTerminal(activeProject.id, tabId)
        }}
      />
    </div>
  )
}
