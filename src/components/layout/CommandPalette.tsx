import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import {
  FileDiff,
  FolderGit2,
  TerminalSquare,
} from "lucide-react"
import { FileIcon } from "@/components/icons/FileIcon"
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import type { PaletteRecents } from "@/lib/projects"
import { tabDisplayName } from "./terminalName"
import type { Project, WorkspaceTab } from "./types"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: Project[]
  activeProject: Project | undefined
  paletteRecents: PaletteRecents
  onSelectProject: (id: string) => void
  onSelectTab: (id: string) => void
  onOpenFile: (path: string) => void
}

const MAX_FILE_RESULTS = 100

function tabIcon(t: WorkspaceTab) {
  if (t.kind === "diff") return <FileDiff />
  if (t.kind === "file") return <FileIcon name={t.path.split("/").pop() ?? t.path} />
  return <TerminalSquare />
}

/**
 * Lightweight scorer: prefers basename matches, then path matches, then
 * subsequence matches. Returns null when nothing matches. Designed to be
 * cheap enough to run across thousands of paths on every keystroke.
 */
function recencyIndex(recents: string[], value: string): number {
  const index = recents.indexOf(value)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

function scorePath(path: string, qLower: string): number | null {
  if (!qLower) return 0
  const pLower = path.toLowerCase()
  const slash = pLower.lastIndexOf("/")
  const base = slash >= 0 ? pLower.slice(slash + 1) : pLower

  if (base === qLower) return 1000
  if (base.startsWith(qLower)) return 900 - base.length
  const baseIdx = base.indexOf(qLower)
  if (baseIdx >= 0) return 700 - baseIdx - base.length * 0.01
  const pathIdx = pLower.indexOf(qLower)
  if (pathIdx >= 0) return 500 - pathIdx - pLower.length * 0.01

  // Subsequence fallback — every char in query appears in order somewhere.
  let i = 0
  for (let j = 0; j < pLower.length && i < qLower.length; j++) {
    if (pLower[j] === qLower[i]) i++
  }
  if (i === qLower.length) return 100 - pLower.length * 0.01
  return null
}

export function CommandPalette({
  open,
  onOpenChange,
  projects,
  activeProject,
  paletteRecents,
  onSelectProject,
  onSelectTab,
  onOpenFile,
}: Props) {
  const [files, setFiles] = useState<string[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [query, setQuery] = useState("")
  const listRef = useRef<HTMLDivElement>(null)
  // Defer the query so typing stays responsive while the large file list
  // re-filters in a lower-priority render pass.
  const deferredQuery = useDeferredValue(query)
  const projectPath = activeProject?.path

  // Lazy-load the project file list on first open / project change. Clear
  // stale results synchronously so switching projects never flashes the prior
  // project's files in the palette.
  useEffect(() => {
    if (!open || !projectPath) {
      setFiles([])
      return
    }
    let cancelled = false
    setFiles([])
    setFilesLoading(true)
    window.fsApi.listAllFiles(projectPath).then((res) => {
      if (cancelled) return
      setFiles(res.ok ? res.files : [])
      setFilesLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [open, projectPath])

  // Reset the query when the palette closes so reopening starts fresh.
  useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  const qLower = deferredQuery.trim().toLowerCase()

  // When the search changes, cmdk keeps the current scroll position. Move the
  // results back to the top so the best matches are visible first.
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 })
  }, [qLower])

  const filteredTabs = useMemo(() => {
    const tabs = activeProject?.tabs ?? []
    const recentTabs = paletteRecents.tabsByProject[activeProject?.path ?? ""] ?? []
    const byRecency = (items: WorkspaceTab[]) =>
      items.slice().sort((a, b) => recencyIndex(recentTabs, a.id) - recencyIndex(recentTabs, b.id))
    if (!qLower) return byRecency(tabs)
    return byRecency(tabs.filter((t) => {
      const hay = (
        tabDisplayName(t) +
        " " +
        (t.kind === "diff" || t.kind === "file" ? t.path : "")
      ).toLowerCase()
      return hay.includes(qLower)
    }))
  }, [activeProject?.path, activeProject?.tabs, paletteRecents.tabsByProject, qLower])

  const filteredProjects = useMemo(() => {
    const byRecency = (items: Project[]) =>
      items
        .slice()
        .sort(
          (a, b) =>
            recencyIndex(paletteRecents.projects, a.path) -
            recencyIndex(paletteRecents.projects, b.path),
        )
    if (!qLower) return byRecency(projects)
    return byRecency(
      projects.filter(
        (p) =>
          p.name.toLowerCase().includes(qLower) ||
          p.path.toLowerCase().includes(qLower),
      ),
    )
  }, [paletteRecents.projects, projects, qLower])

  const filteredFiles = useMemo(() => {
    if (!files.length) return []
    const recentFiles = paletteRecents.filesByProject[activeProject?.path ?? ""] ?? []
    if (!qLower) {
      return files
        .slice()
        .sort(
          (a, b) => recencyIndex(recentFiles, a) - recencyIndex(recentFiles, b),
        )
        .slice(0, MAX_FILE_RESULTS)
    }
    const scored: Array<{ path: string; score: number }> = []
    for (let i = 0; i < files.length; i++) {
      const s = scorePath(files[i], qLower)
      if (s !== null) scored.push({ path: files[i], score: s })
    }
    scored.sort(
      (a, b) =>
        b.score - a.score ||
        recencyIndex(recentFiles, a.path) - recencyIndex(recentFiles, b.path),
    )
    return scored.slice(0, MAX_FILE_RESULTS).map((s) => s.path)
  }, [activeProject?.path, files, paletteRecents.filesByProject, qLower])

  const run = (fn: () => void) => {
    fn()
    onOpenChange(false)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Type a command, file, tab, or project…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList ref={listRef}>
        <CommandEmpty>
          {filesLoading ? "Loading…" : "No matches."}
        </CommandEmpty>

        {filteredProjects.length > 0 && (
          <CommandGroup heading="Projects">
            {filteredProjects.map((p) => (
              <CommandItem
                key={p.id}
                value={`project ${p.name} ${p.path}`}
                onSelect={() => run(() => onSelectProject(p.id))}
              >
                <FolderGit2 />
                <span className="truncate">{p.name}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">
                  {p.path}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {filteredTabs.length > 0 && (
          <>
            {filteredProjects.length > 0 && <CommandSeparator />}
            <CommandGroup heading="Tabs">
              {filteredTabs.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`tab ${tabDisplayName(t)} ${t.kind === "diff" || t.kind === "file" ? t.path : ""}`}
                  onSelect={() => run(() => onSelectTab(t.id))}
                >
                  {tabIcon(t)}
                  <span className="truncate">{tabDisplayName(t)}</span>
                  {(t.kind === "diff" || t.kind === "file") && (
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {t.path}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {activeProject && filteredFiles.length > 0 && (
          <>
            {(filteredProjects.length > 0 || filteredTabs.length > 0) && (
              <CommandSeparator />
            )}
            <CommandGroup heading="Files">
              {filteredFiles.map((f) => (
                <CommandItem
                  key={f}
                  value={`file ${f}`}
                  onSelect={() => run(() => onOpenFile(f))}
                >
                  <FileIcon name={f.split("/").pop() ?? f} />
                  <span className="truncate">{f.split("/").pop()}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {f}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
