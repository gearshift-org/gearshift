import { useEffect, useState } from "react"
import {
  FileDiff,
  FileText,
  FolderGit2,
  TerminalSquare,
} from "lucide-react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { tabDisplayName } from "./terminalName"
import type { Project, WorkspaceTab } from "./types"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: Project[]
  activeProject: Project | undefined
  onSelectProject: (id: string) => void
  onSelectTab: (id: string) => void
  onOpenFile: (path: string) => void
}

function tabIcon(t: WorkspaceTab) {
  if (t.kind === "diff") return <FileDiff />
  if (t.kind === "file") return <FileText />
  return <TerminalSquare />
}

export function CommandPalette({
  open,
  onOpenChange,
  projects,
  activeProject,
  onSelectProject,
  onSelectTab,
  onOpenFile,
}: Props) {
  const [files, setFiles] = useState<string[]>([])
  const [filesLoading, setFilesLoading] = useState(false)

  // Lazy-load the project file list on first open / project change.
  useEffect(() => {
    if (!open || !activeProject) return
    let cancelled = false
    setFilesLoading(true)
    window.fsApi.listAllFiles(activeProject.path).then((res) => {
      if (cancelled) return
      setFiles(res.ok ? res.files : [])
      setFilesLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [open, activeProject])

  const run = (fn: () => void) => {
    fn()
    onOpenChange(false)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command, file, tab, or project…" />
      <CommandList>
        <CommandEmpty>
          {filesLoading ? "Loading…" : "No matches."}
        </CommandEmpty>

        {activeProject && activeProject.tabs.length > 0 && (
          <CommandGroup heading="Tabs">
            {activeProject.tabs.map((t) => (
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
        )}

        {projects.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Projects">
              {projects.map((p) => (
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
          </>
        )}

        {activeProject && files.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Files">
              {files.map((f) => (
                <CommandItem
                  key={f}
                  value={`file ${f}`}
                  onSelect={() => run(() => onOpenFile(f))}
                >
                  <FileText />
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
