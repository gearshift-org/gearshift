import { useEffect, useRef, useState } from "react"
import { TitleBar } from "./TitleBar"
import { TerminalTabBar } from "./TerminalTabBar"
import { WorkspaceSplit } from "./WorkspaceSplit"
import type { Project } from "./types"
import { loadProjects, saveProjects } from "@/lib/projects"

function makeId() {
  return crypto.randomUUID()
}

function basename(p: string) {
  return p.replace(/\/+$/, "").split("/").pop() || p
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
  const [activeProjectId, setActiveProjectId] = useState<string>(
    () => projects[0]?.id ?? "",
  )

  // Persist project list + tabs (id/name/customName/activeTabId) whenever it changes.
  useEffect(() => {
    saveProjects(
      projects.map((p) => ({
        id: p.id,
        name: p.name,
        path: p.path,
        activeTabId: p.activeTerminalId,
        tabs: p.terminals.map((t) => ({
          id: t.id,
          name: t.name,
          ...(t.customName ? { customName: t.customName } : {}),
        })),
      })),
    )
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

  const addProject = async () => {
    const path = await window.dialogApi.openProject()
    if (!path) return
    const id = makeId()
    setProjects((prev) => [
      ...prev,
      {
        id,
        name: basename(path),
        path,
        terminals: [],
        activeTerminalId: "",
      },
    ])
    setActiveProjectId(id)
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

  const startTerminal = async (tabId: string) => {
    if (!activeProject) return
    const tab = activeProject.terminals.find((t) => t.id === tabId)
    if (!tab || !tab.pendingStart) return
    const { id: newId } = await window.term.create({ cwd: activeProject.path })
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== activeProject.id) return p
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
  }

  const selectTerminal = (id: string) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProjectId ? { ...p, activeTerminalId: id } : p,
      ),
    )
  }

  const setTerminalTitle = (terminalId: string, title: string) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProjectId
          ? {
              ...p,
              terminals: p.terminals.map((t) =>
                t.id === terminalId ? { ...t, autoTitle: title } : t,
              ),
            }
          : p,
      ),
    )
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
  const addTerminalRef = useRef(addTerminal)
  addTerminalRef.current = addTerminal
  const closeActiveTerminalRef = useRef(() => {
    const ap = projects.find((p) => p.id === activeProjectId)
    if (!ap?.activeTerminalId) return
    closeTerminal(ap.activeTerminalId)
  })
  closeActiveTerminalRef.current = () => {
    const ap = projects.find((p) => p.id === activeProjectId)
    if (!ap?.activeTerminalId) return
    closeTerminal(ap.activeTerminalId)
  }

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
        onSelectProject={setActiveProjectId}
        onAddProject={addProject}
        onCloseProject={closeProject}
      />
      <TerminalTabBar
        terminals={activeProject?.terminals ?? []}
        activeId={activeProject?.activeTerminalId ?? ""}
        onSelect={selectTerminal}
        onAdd={addTerminal}
        onClose={closeTerminal}
        onCloseAll={closeAllTerminals}
        onRename={renameTerminal}
      />
      <WorkspaceSplit
        project={activeProject}
        onTerminalTitleChange={setTerminalTitle}
        onStartTerminal={startTerminal}
      />
    </div>
  )
}
