import { useState } from "react"
import { TitleBar } from "./TitleBar"
import { TerminalTabBar } from "./TerminalTabBar"
import { WorkspaceSplit } from "./WorkspaceSplit"
import type { Project } from "./types"

const INITIAL_PROJECTS: Project[] = [
  {
    id: "p1",
    name: "Project Tab",
    activeTerminalId: "p1-t1",
    terminals: [
      { id: "p1-t1", name: "Terminal 1" },
      { id: "p1-t2", name: "Terminal 2" },
    ],
  },
  {
    id: "p2",
    name: "Project Tab2",
    activeTerminalId: "p2-t1",
    terminals: [
      { id: "p2-t1", name: "Terminal 1" },
      { id: "p2-t2", name: "Terminal 2" },
    ],
  },
]

export function AppShell() {
  const [projects, setProjects] = useState<Project[]>(INITIAL_PROJECTS)
  const [activeProjectId, setActiveProjectId] = useState(INITIAL_PROJECTS[0].id)

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const activeTerminal = activeProject?.terminals.find(
    (t) => t.id === activeProject.activeTerminalId,
  )

  const addProject = () => {
    const id = `p${projects.length + 1}-${Date.now()}`
    const firstTerm = `${id}-t1`
    setProjects((prev) => [
      ...prev,
      {
        id,
        name: `Project ${prev.length + 1}`,
        activeTerminalId: firstTerm,
        terminals: [{ id: firstTerm, name: "Terminal 1" }],
      },
    ])
    setActiveProjectId(id)
  }

  const addTerminal = () => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== activeProjectId) return p
        const id = `${p.id}-t${p.terminals.length + 1}-${Date.now()}`
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

  const selectTerminal = (id: string) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProjectId ? { ...p, activeTerminalId: id } : p,
      ),
    )
  }

  const closeProject = (id: string) => {
    setProjects((prev) => {
      if (prev.length <= 1) return prev
      const next = prev.filter((p) => p.id !== id)
      if (id === activeProjectId) {
        setActiveProjectId(next[0].id)
      }
      return next
    })
  }

  const closeTerminal = (id: string) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== activeProjectId) return p
        if (p.terminals.length <= 1) return p
        const terminals = p.terminals.filter((t) => t.id !== id)
        const activeTerminalId =
          p.activeTerminalId === id ? terminals[0].id : p.activeTerminalId
        return { ...p, terminals, activeTerminalId }
      }),
    )
  }

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
      />
      <WorkspaceSplit terminal={activeTerminal} />
    </div>
  )
}
