import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, ChevronRight } from "lucide-react"
import { FileIcon, FolderIcon } from "@/components/icons/FileIcon"
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
  const isActiveAncestor =
    !!activePath && (depth === 0 || activePath.startsWith(`${relPath}/`))
  const open = depth === 0 || manuallyOpen || isActiveAncestor

  const entriesQuery = useQuery({
    queryKey: fileTreeDirQueryKey(cwd, absPath),
    enabled: open,
    queryFn: () => readDirEntries(absPath),
  })
  const entries = entriesQuery.data

  return (
    <div>
      {depth > 0 && (
        <button
          type="button"
          draggable
          onDragStart={(e) => setPathDragData(e.dataTransfer, [absPath])}
          onClick={() => setManuallyOpen((v) => !v)}
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
    <button
      ref={ref}
      type="button"
      draggable
      onDragStart={(e) => setPathDragData(e.dataTransfer, [absPath])}
      onClick={() => onOpenFile(relPath)}
      className={cn(
        "flex w-full items-center gap-1 px-2 py-[3px] text-left text-xs text-foreground hover:bg-accent/40",
        active && "bg-accent text-accent-foreground"
      )}
      style={{ paddingLeft: (depth + 1) * 12 + 12 }}
    >
      <FileIcon name={name} className="size-4 shrink-0" />
      <span className="truncate">{name}</span>
    </button>
  )
}

type Props = {
  cwd: string
  activePath?: string
  onOpenFile: (relPath: string) => void
}

export function FilesTree({ cwd, activePath, onOpenFile }: Props) {
  const queryClient = useQueryClient()

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
    <ScrollArea className="h-full">
      <FolderNode
        key={cwd}
        cwd={cwd}
        absPath={cwd}
        relPath=""
        depth={0}
        onOpenFile={onOpenFile}
        activePath={activePath}
      />
    </ScrollArea>
  )
}
