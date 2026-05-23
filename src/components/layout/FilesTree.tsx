import { useCallback, useEffect, useState } from "react"
import { ChevronDown, ChevronRight, File, Folder } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
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
  /** Bumped to invalidate readDir caches across the tree. */
  invalidation: number
}

function joinPath(a: string, b: string): string {
  return `${a.replace(/\/+$/, "")}/${b}`
}

function FolderNode({
  cwd,
  absPath,
  relPath,
  depth,
  onOpenFile,
  invalidation,
}: NodeProps) {
  const [open, setOpen] = useState(depth === 0)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    window.fsApi.readDir(absPath).then((res) => {
      if (res.ok) {
        const sorted = [...res.entries].sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        setEntries(sorted)
      } else {
        setEntries([])
      }
      setLoading(false)
    })
  }, [absPath])

  useEffect(() => {
    if (open && entries === null) load()
  }, [open, entries, load])

  // Re-load on invalidation if we were already open.
  useEffect(() => {
    if (open) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invalidation])

  return (
    <div>
      {depth > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "flex w-full items-center gap-1 px-2 py-[3px] text-left text-xs text-foreground hover:bg-accent/40",
          )}
          style={{ paddingLeft: depth * 12 }}
        >
          {open ? (
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
          )}
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{relPath.split("/").pop()}</span>
        </button>
      )}
      {open && (
        <div>
          {loading && entries === null && (
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
                  invalidation={invalidation}
                />
              )
            }
            return (
              <button
                key={childAbs}
                type="button"
                onClick={() => onOpenFile(childRel)}
                className="flex w-full items-center gap-1 px-2 py-[3px] text-left text-xs text-foreground hover:bg-accent/40"
                style={{ paddingLeft: (depth + 1) * 12 + 12 }}
              >
                <File className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{e.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

type Props = {
  cwd: string
  onOpenFile: (relPath: string) => void
}

export function FilesTree({ cwd, onOpenFile }: Props) {
  // Bump on fs:changed to invalidate cached entries across nodes.
  const [invalidation, setInvalidation] = useState(0)

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
      timer = window.setTimeout(() => setInvalidation((n) => n + 1), 300)
    })
    return () => {
      active = false
      off()
      if (timer !== null) window.clearTimeout(timer)
      if (watchId) window.fsApi.unwatchProject(watchId)
    }
  }, [cwd])

  return (
    <ScrollArea className="h-full">
      <FolderNode
        cwd={cwd}
        absPath={cwd}
        relPath=""
        depth={0}
        onOpenFile={onOpenFile}
        invalidation={invalidation}
      />
    </ScrollArea>
  )
}
