import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, ChevronRight, ChevronsDownUp } from "lucide-react"
import { FileIcon, FolderIcon } from "@/components/icons/FileIcon"
import { VSCodeIcon } from "@/components/icons/VSCodeIcon"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { setPathDragData } from "@/lib/pathDrag"
import { cn } from "@/lib/utils"

type Entry = { name: string; isDir: boolean }

type NodeProps = {
  cwd: string
  /** Absolute path of this directory. */
  absPath: string
  /** Path relative to project root, used when opening files. */
  relPath: string
  /** Indent level. */
  depth: number
  onOpenFile: (relPath: string) => void
  activePath?: string
}

const CollapseSignalContext = createContext(0)

function joinPath(a: string, b: string): string {
  return `${a.replace(/\/+$/, "")}/${b}`
}

function fileTreeProjectQueryKey(cwd: string) {
  return ["file-tree", cwd] as const
}

function fileTreeDirQueryKey(cwd: string, absPath: string) {
  return [...fileTreeProjectQueryKey(cwd), absPath] as const
}

async function readDirEntries(absPath: string): Promise<Entry[]> {
  const res = await window.fsApi.readDir(absPath)
  if (!res.ok) return []
  return [...res.entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function FolderNode({
  cwd,
  absPath,
  relPath,
  depth,
  onOpenFile,
  activePath,
}: NodeProps) {
  const [manuallyOpen, setManuallyOpen] = useState(depth === 0)
  const [forceClosed, setForceClosed] = useState(false)
  const collapseSignal = useContext(CollapseSignalContext)
  useEffect(() => {
    if (collapseSignal > 0 && depth > 0) {
      setManuallyOpen(false)
      setForceClosed(true)
    }
  }, [collapseSignal, depth])
  useEffect(() => {
    setForceClosed(false)
  }, [activePath])
  const isActiveAncestor =
    !!activePath && (depth === 0 || activePath.startsWith(`${relPath}/`))
  const open =
    depth === 0 || (!forceClosed && (manuallyOpen || isActiveAncestor))

  const entriesQuery = useQuery({
    queryKey: fileTreeDirQueryKey(cwd, absPath),
    enabled: open,
    queryFn: () => readDirEntries(absPath),
  })
  const entries = entriesQuery.data

  const folderButton = depth > 0 && (
    <button
      type="button"
      draggable
      onDragStart={(e) => setPathDragData(e.dataTransfer, [absPath])}
      onClick={() => {
        setForceClosed(false)
        setManuallyOpen((v) => !v)
      }}
      className={cn(
        "flex w-full items-center gap-1 px-2 py-[3px] text-left text-xs text-foreground hover:bg-accent/40"
      )}
      style={{ paddingLeft: depth * 12 }}
    >
      {open ? (
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
      )}
      <FolderIcon
        name={relPath.split("/").pop() ?? relPath}
        open={open}
        className="size-4 shrink-0"
      />
      <span className="truncate">{relPath.split("/").pop()}</span>
    </button>
  )

  return (
    <div>
      {folderButton && (
        <FileTreeContextMenu absPath={absPath}>
          {folderButton}
        </FileTreeContextMenu>
      )}
      {open && (
        <div>
          {entriesQuery.isLoading && entries === undefined && (
            <div
              className="px-2 py-1 text-xs text-muted-foreground"
              style={{ paddingLeft: (depth + 1) * 12 }}
            >
              Loading…
            </div>
          )}
          {entries?.map((e) => {
            const childAbs = joinPath(absPath, e.name)
            const childRel = relPath ? joinPath(relPath, e.name) : e.name
            if (e.isDir) {
              return (
                <FolderNode
                  key={childAbs}
                  cwd={cwd}
                  absPath={childAbs}
                  relPath={childRel}
                  depth={depth + 1}
                  onOpenFile={onOpenFile}
                  activePath={activePath}
                />
              )
            }
            return (
              <FileNode
                key={childAbs}
                name={e.name}
                absPath={childAbs}
                relPath={childRel}
                active={childRel === activePath}
                depth={depth}
                onOpenFile={onOpenFile}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function FileTreeContextMenu({
  absPath,
  children,
}: {
  absPath: string
  children: ReactElement
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent className="min-w-[180px] whitespace-nowrap">
        <ContextMenuItem
          onClick={() => {
            void window.shellApi.openInVSCode(absPath)
          }}
        >
          <VSCodeIcon className="size-3.5" />
          Open in VS Code
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            void window.shellApi.revealInFinder(absPath)
          }}
        >
          Reveal in Finder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => {
            void navigator.clipboard.writeText(absPath)
          }}
        >
          Copy Path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function FileNode({
  name,
  absPath,
  relPath,
  active,
  depth,
  onOpenFile,
}: {
  name: string
  absPath: string
  relPath: string
  active: boolean
  depth: number
  onOpenFile: (relPath: string) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!active) return
    ref.current?.scrollIntoView({ block: "nearest" })
  }, [active])

  return (
    <FileTreeContextMenu absPath={absPath}>
      <button
        ref={ref}
        type="button"
        draggable
        onDragStart={(e) => setPathDragData(e.dataTransfer, [absPath])}
        onClick={() => onOpenFile(relPath)}
        className={cn(
          "flex w-full items-center gap-1 px-2 py-[3px] text-left text-xs text-foreground hover:bg-accent/40",
          active && "bg-foreground/10 dark:bg-foreground/15"
        )}
        style={{ paddingLeft: (depth + 1) * 12 + 12 }}
      >
        <FileIcon name={name} className="size-4 shrink-0" />
        <span className="truncate">{name}</span>
      </button>
    </FileTreeContextMenu>
  )
}

type Props = {
  cwd: string
  activePath?: string
  onOpenFile: (relPath: string) => void
}

export function FilesTree({ cwd, activePath, onOpenFile }: Props) {
  const queryClient = useQueryClient()
  const [collapseSignal, setCollapseSignal] = useState(0)

  useEffect(() => {
    let active = true
    let watchId: string | null = null
    window.fsApi.watchProject(cwd).then((res) => {
      if (!active || !res.ok || !res.watchId) return
      watchId = res.watchId
    })
    let timer: number | null = null
    const off = window.fsApi.onChanged((ev) => {
      if (ev.cwd !== cwd) return
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: fileTreeProjectQueryKey(cwd),
        })
      }, 300)
    })
    return () => {
      active = false
      off()
      if (timer !== null) window.clearTimeout(timer)
      if (watchId) window.fsApi.unwatchProject(watchId)
    }
  }, [cwd, queryClient])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[34px] shrink-0 items-center justify-between border-b border-border/60 px-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Files</span>
        <button
          type="button"
          onClick={() => setCollapseSignal((n) => n + 1)}
          aria-label="Collapse all folders"
          title="Collapse all folders"
          className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
        >
          <ChevronsDownUp className="size-3.5" />
        </button>
      </div>
      <CollapseSignalContext.Provider value={collapseSignal}>
        <ScrollArea className="min-h-0 flex-1">
          <FileTreeContextMenu absPath={cwd}>
            <div className="min-h-full">
              <FolderNode
                key={cwd}
                cwd={cwd}
                absPath={cwd}
                relPath=""
                depth={0}
                onOpenFile={onOpenFile}
                activePath={activePath}
              />
            </div>
          </FileTreeContextMenu>
        </ScrollArea>
      </CollapseSignalContext.Provider>
    </div>
  )
}
