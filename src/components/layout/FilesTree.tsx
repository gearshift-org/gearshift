import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  Clipboard,
  ClipboardPaste,
  Copy,
  FilePlus,
  FolderPlus,
  Pencil,
  Search,
  X,
} from "lucide-react"
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
import {
  getPathDragData,
  hasPathDragData,
  setPathDragData,
} from "@/lib/pathDrag"
import { cn } from "@/lib/utils"

type Entry = { name: string; isDir: boolean; ignored?: boolean }

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
  /** True when this entry is gitignored — rendered dimmed, like VS Code. */
  ignored?: boolean
}

const CollapseSignalContext = createContext(0)

type PendingCreate = {
  parentAbs: string
  kind: "file" | "folder"
}

type PendingRename = {
  absPath: string
  initialName: string
}

type TreeActions = {
  pendingCreate: PendingCreate | null
  pendingRename: PendingRename | null
  copiedPaths: string[]
  startCreate: (parentAbs: string, kind: "file" | "folder") => void
  submitCreate: (name: string) => Promise<void>
  cancelCreate: () => void
  startRename: (absPath: string) => void
  submitRename: (name: string) => Promise<void>
  cancelRename: () => void
  copyPaths: (sourcePaths: string[]) => void
  pasteIntoDir: (targetDirAbs: string) => Promise<void>
  trash: (absPath: string, isDir: boolean) => Promise<void>
  moveToDir: (sourcePaths: string[], targetDirAbs: string) => Promise<void>
}

const TreeActionsContext = createContext<TreeActions | null>(null)

function useTreeActions(): TreeActions {
  const ctx = useContext(TreeActionsContext)
  if (!ctx) throw new Error("TreeActionsContext missing")
  return ctx
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
  ignored,
}: NodeProps) {
  const [manuallyOpen, setManuallyOpen] = useState(depth === 0)
  const [forceClosed, setForceClosed] = useState(false)
  const collapseSignal = useContext(CollapseSignalContext)
  const { pendingCreate, pendingRename, moveToDir, startRename } =
    useTreeActions()
  const [dragOver, setDragOver] = useState(false)
  const isCreateTarget = pendingCreate?.parentAbs === absPath
  const isRenaming = pendingRename?.absPath === absPath
  useEffect(() => {
    if (collapseSignal > 0 && depth > 0) {
      setManuallyOpen(false)
      setForceClosed(true)
    }
  }, [collapseSignal, depth])
  useEffect(() => {
    setForceClosed(false)
  }, [activePath])
  useEffect(() => {
    if (isCreateTarget) {
      setManuallyOpen(true)
      setForceClosed(false)
    }
  }, [isCreateTarget])
  const isActiveAncestor =
    !!activePath && (depth === 0 || activePath.startsWith(`${relPath}/`))
  const open =
    depth === 0 ||
    isCreateTarget ||
    (!forceClosed && (manuallyOpen || isActiveAncestor))

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
      onDragOver={(e) => {
        if (!hasPathDragData(e.dataTransfer)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = "move"
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        e.stopPropagation()
        setDragOver(false)
      }}
      onDrop={(e) => {
        const paths = getPathDragData(e.dataTransfer)
        if (paths.length === 0) return
        e.preventDefault()
        e.stopPropagation()
        setDragOver(false)
        void moveToDir(paths, absPath)
      }}
      onClick={() => {
        if (open) {
          setManuallyOpen(false)
          setForceClosed(true)
        } else {
          setManuallyOpen(true)
          setForceClosed(false)
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          startRename(absPath)
        }
      }}
      className={cn(
        "flex w-full items-center gap-1 px-2 py-[3px] text-left text-xs text-foreground outline-none hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:ring-1 focus-visible:ring-ring/60 focus-visible:ring-inset",
        dragOver && "bg-accent/70 ring-1 ring-ring/40 ring-inset",
        ignored && "text-muted-foreground opacity-80"
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
      {depth > 0 && isRenaming && pendingRename ? (
        <RenameEntryRow
          initialName={pendingRename.initialName}
          isDir
          depth={depth}
        />
      ) : folderButton ? (
        <FileTreeContextMenu absPath={absPath} isDir>
          {folderButton}
        </FileTreeContextMenu>
      ) : null}
      {open && (
        <div>
          {isCreateTarget && pendingCreate && (
            <NewEntryRow kind={pendingCreate.kind} depth={depth + 1} />
          )}
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
                  ignored={ignored || e.ignored}
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
                ignored={ignored || e.ignored}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function NewEntryRow({
  kind,
  depth,
}: {
  kind: "file" | "folder"
  depth: number
}) {
  const { submitCreate, cancelCreate } = useTreeActions()
  const [value, setValue] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = async () => {
    const name = value.trim()
    if (!name || submitting) return
    setSubmitting(true)
    try {
      await submitCreate(name)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="flex items-center gap-1 px-2 py-[3px] text-xs"
      style={{ paddingLeft: depth * 12 + 12 }}
    >
      {kind === "folder" ? (
        <FolderIcon name={value || "new"} open className="size-4 shrink-0" />
      ) : (
        <FileIcon name={value || "new"} className="size-4 shrink-0" />
      )}
      <input
        ref={inputRef}
        value={value}
        disabled={submitting}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            void submit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            cancelCreate()
          }
        }}
        onBlur={() => {
          if (value.trim()) {
            void submit()
          } else {
            cancelCreate()
          }
        }}
        placeholder={kind === "folder" ? "New folder" : "New file"}
        className="min-w-0 flex-1 rounded-sm border border-ring/40 bg-background px-1 py-0 outline-none focus:border-ring"
      />
    </div>
  )
}

function RenameEntryRow({
  initialName,
  isDir,
  depth,
}: {
  initialName: string
  isDir: boolean
  depth: number
}) {
  const { submitRename, cancelRename } = useTreeActions()
  const [value, setValue] = useState(initialName)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Track whether the input has actually taken focus. A context menu restores
  // focus to its (now-unmounted) trigger as it closes, which can fire a blur on
  // this input before the user types — that spurious blur must not commit.
  const focusedRef = useRef(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      const dot = value.lastIndexOf(".")
      // Select the base name (excluding the extension) like Finder/VS Code.
      if (!isDir && dot > 0) el.setSelectionRange(0, dot)
      else el.select()
      focusedRef.current = true
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async () => {
    const name = value.trim()
    if (submitting) return
    if (!name || name === initialName) {
      cancelRename()
      return
    }
    setSubmitting(true)
    try {
      await submitRename(name)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="flex items-center gap-1 px-2 py-[3px] text-xs"
      style={{ paddingLeft: isDir ? depth * 12 : (depth + 1) * 12 + 12 }}
    >
      {isDir ? (
        <>
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
          <FolderIcon
            name={value || initialName}
            open
            className="size-4 shrink-0"
          />
        </>
      ) : (
        <FileIcon name={value || initialName} className="size-4 shrink-0" />
      )}
      <input
        ref={inputRef}
        value={value}
        disabled={submitting}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            void submit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            cancelRename()
          }
        }}
        onBlur={() => {
          if (!focusedRef.current) return
          void submit()
        }}
        className="min-w-0 flex-1 rounded-sm border border-ring/40 bg-background px-1 py-0 outline-none focus:border-ring"
      />
    </div>
  )
}

function FileTreeContextMenu({
  absPath,
  isDir,
  canRenameCopy = true,
  children,
}: {
  absPath: string
  isDir: boolean
  canRenameCopy?: boolean
  children: ReactElement
}) {
  const {
    copiedPaths,
    startCreate,
    startRename,
    copyPaths,
    pasteIntoDir,
    trash,
  } = useTreeActions()
  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent className="min-w-[180px] whitespace-nowrap">
        {isDir && (
          <>
            <ContextMenuItem onClick={() => startCreate(absPath, "file")}>
              <FilePlus className="size-3.5" />
              New File
            </ContextMenuItem>
            <ContextMenuItem onClick={() => startCreate(absPath, "folder")}>
              <FolderPlus className="size-3.5" />
              New Folder
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
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
        {canRenameCopy && (
          <>
            <ContextMenuItem
              onClick={() => {
                // Defer until the menu has closed and restored focus to its
                // trigger; otherwise that restoration steals focus from the
                // rename input the moment it mounts.
                requestAnimationFrame(() => startRename(absPath))
              }}
            >
              <Pencil className="size-3.5" />
              Rename
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => {
                copyPaths([absPath])
              }}
            >
              <Copy className="size-3.5" />
              Copy
            </ContextMenuItem>
          </>
        )}
        {isDir && (
          <ContextMenuItem
            disabled={copiedPaths.length === 0}
            onClick={() => {
              void pasteIntoDir(absPath)
            }}
          >
            <ClipboardPaste className="size-3.5" />
            Paste
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onClick={() => {
            void navigator.clipboard.writeText(absPath)
          }}
        >
          <Clipboard className="size-3.5" />
          Copy Path
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => {
            void trash(absPath, isDir)
          }}
          className="text-red-500 focus:text-red-500 data-highlighted:text-red-500"
        >
          Delete
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
  ignored,
}: {
  name: string
  absPath: string
  relPath: string
  active: boolean
  depth: number
  onOpenFile: (relPath: string) => void
  ignored?: boolean
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const { pendingRename, startRename } = useTreeActions()
  const isRenaming = pendingRename?.absPath === absPath

  useEffect(() => {
    if (!active) return
    ref.current?.scrollIntoView({ block: "nearest" })
  }, [active])

  if (isRenaming && pendingRename) {
    return (
      <RenameEntryRow
        initialName={pendingRename.initialName}
        isDir={false}
        depth={depth}
      />
    )
  }

  return (
    <FileTreeContextMenu absPath={absPath} isDir={false}>
      <button
        ref={ref}
        type="button"
        draggable
        onDragStart={(e) => setPathDragData(e.dataTransfer, [absPath])}
        onClick={() => onOpenFile(relPath)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            startRename(absPath)
          }
        }}
        className={cn(
          "flex w-full items-center gap-1 px-2 py-[3px] text-left text-xs text-foreground outline-none hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:ring-1 focus-visible:ring-ring/60 focus-visible:ring-inset",
          active && "bg-foreground/10 dark:bg-foreground/15",
          ignored && "text-muted-foreground opacity-80"
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

function fileTreeAllFilesQueryKey(cwd: string) {
  return ["file-tree-all", cwd] as const
}

export function FilesTree({ cwd, activePath, onOpenFile }: Props) {
  const queryClient = useQueryClient()
  const [collapseSignal, setCollapseSignal] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null)
  const [pendingRename, setPendingRename] = useState<PendingRename | null>(null)
  const [copiedPaths, setCopiedPaths] = useState<string[]>([])
  const [rootDragOver, setRootDragOver] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const allFilesQuery = useQuery({
    queryKey: fileTreeAllFilesQueryKey(cwd),
    enabled: searchOpen,
    queryFn: async () => {
      const res = await window.fsApi.listAllFiles(cwd)
      return res.ok ? res.files : []
    },
  })

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
  }, [searchOpen])

  useEffect(() => {
    const openSearch = () => {
      setSearchOpen(true)
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
    window.addEventListener("gearshift:file-search", openSearch)
    return () => window.removeEventListener("gearshift:file-search", openSearch)
  }, [])

  const closeSearch = () => {
    setSearchOpen(false)
    setQuery("")
  }

  const [selectedIndex, setSelectedIndex] = useState(0)
  const [deferredQuery, setDeferredQuery] = useState("")
  useEffect(() => {
    const id = window.setTimeout(() => setDeferredQuery(query), 80)
    return () => window.clearTimeout(id)
  }, [query])

  const trimmedQuery = deferredQuery.trim().toLowerCase()
  const filtering = searchOpen && trimmedQuery.length > 0

  const indexedFiles = useMemo(() => {
    const files = allFilesQuery.data ?? []
    return files.map((path) => ({ path, lower: path.toLowerCase() }))
  }, [allFilesQuery.data])

  const matches = useMemo(() => {
    if (!filtering) return []
    const out: string[] = []
    for (const f of indexedFiles) {
      if (f.lower.includes(trimmedQuery)) {
        out.push(f.path)
        if (out.length >= 150) break
      }
    }
    return out
  }, [filtering, indexedFiles, trimmedQuery])

  useEffect(() => {
    setSelectedIndex(0)
  }, [matches])

  useEffect(() => {
    let active = true
    let watchId: string | null = null
    let timer: number | null = null
    // Gate on watchId (not a cwd string compare) so path normalization
    // mismatches can't silently drop events — matches the git watcher.
    const off = window.fsApi.onChanged((ev) => {
      if (!watchId || ev.watchId !== watchId) return
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: fileTreeProjectQueryKey(cwd),
        })
        void queryClient.invalidateQueries({
          queryKey: fileTreeAllFilesQueryKey(cwd),
        })
      }, 300)
    })
    window.fsApi.watchProject(cwd).then((res) => {
      if (!active || !res.ok || !res.watchId) return
      watchId = res.watchId
    })
    return () => {
      active = false
      off()
      if (timer !== null) window.clearTimeout(timer)
      if (watchId) window.fsApi.unwatchProject(watchId)
    }
  }, [cwd, queryClient])

  useEffect(() => {
    setPendingCreate(null)
    setPendingRename(null)
  }, [cwd])

  const invalidateTree = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: fileTreeProjectQueryKey(cwd),
    })
    void queryClient.invalidateQueries({
      queryKey: fileTreeAllFilesQueryKey(cwd),
    })
  }, [cwd, queryClient])

  const treeActions = useMemo<TreeActions>(
    () => ({
      pendingCreate,
      pendingRename,
      copiedPaths,
      startCreate: (parentAbs, kind) => setPendingCreate({ parentAbs, kind }),
      cancelCreate: () => setPendingCreate(null),
      submitCreate: async (name) => {
        if (!pendingCreate) return
        const target = joinPath(pendingCreate.parentAbs, name)
        const res =
          pendingCreate.kind === "file"
            ? await window.fsApi.createFile(target)
            : await window.fsApi.createDir(target)
        if (!res.ok) {
          toast.error(res.error ?? "Failed to create")
          return
        }
        setPendingCreate(null)
        invalidateTree()
        if (pendingCreate.kind === "file") {
          const relPath = target.startsWith(cwd + "/")
            ? target.slice(cwd.length + 1)
            : null
          if (relPath) onOpenFile(relPath)
        }
      },
      startRename: (absPath) => {
        const initialName = absPath.split("/").pop() ?? absPath
        setPendingCreate(null)
        setPendingRename({ absPath, initialName })
      },
      cancelRename: () => setPendingRename(null),
      submitRename: async (name) => {
        if (!pendingRename) return
        const res = await window.fsApi.rename(pendingRename.absPath, name)
        if (!res.ok) {
          toast.error(res.error ?? "Failed to rename")
          return
        }
        const oldRelPath = pendingRename.absPath.startsWith(cwd + "/")
          ? pendingRename.absPath.slice(cwd.length + 1)
          : null
        const newRelPath =
          res.newPath && res.newPath.startsWith(cwd + "/")
            ? res.newPath.slice(cwd.length + 1)
            : null
        setPendingRename(null)
        invalidateTree()
        if (oldRelPath && newRelPath) {
          if (activePath === oldRelPath) {
            onOpenFile(newRelPath)
          } else if (activePath?.startsWith(`${oldRelPath}/`)) {
            onOpenFile(
              `${newRelPath}/${activePath.slice(oldRelPath.length + 1)}`
            )
          }
        }
      },
      copyPaths: (sourcePaths) => {
        setCopiedPaths([...new Set(sourcePaths)])
      },
      pasteIntoDir: async (targetDirAbs) => {
        const uniquePaths = [...new Set(copiedPaths)].filter(
          (sourcePath) => sourcePath !== targetDirAbs
        )
        if (uniquePaths.length === 0) return

        const results = await Promise.all(
          uniquePaths.map((sourcePath) =>
            window.fsApi.copy(sourcePath, targetDirAbs).then((res) => ({
              sourcePath,
              res,
            }))
          )
        )
        const failed = results.find(({ res }) => !res.ok)
        if (failed) {
          const name = failed.sourcePath.split("/").pop() ?? failed.sourcePath
          toast.error(failed.res.error ?? `Failed to copy ${name}`)
        }
        if (results.some(({ res }) => res.ok)) invalidateTree()
      },
      trash: async (absPath, isDir) => {
        const name = absPath.split("/").pop() ?? absPath
        const confirmed = window.confirm(
          `Move "${name}" to Trash?\n\n${isDir ? "This folder and all its contents will be moved." : "This file will be moved."}`
        )
        if (!confirmed) return
        const res = await window.fsApi.trash(absPath)
        if (!res.ok) {
          toast.error(res.error ?? "Failed to delete")
          return
        }
        invalidateTree()
      },
      moveToDir: async (sourcePaths, targetDirAbs) => {
        const uniquePaths = [...new Set(sourcePaths)].filter(
          (sourcePath) => sourcePath !== targetDirAbs
        )
        if (uniquePaths.length === 0) return

        const results = await Promise.all(
          uniquePaths.map((sourcePath) =>
            window.fsApi.move(sourcePath, targetDirAbs).then((res) => ({
              sourcePath,
              res,
            }))
          )
        )
        const failed = results.find(({ res }) => !res.ok)
        if (failed) {
          const name = failed.sourcePath.split("/").pop() ?? failed.sourcePath
          toast.error(failed.res.error ?? `Failed to move ${name}`)
        }
        if (results.some(({ res }) => res.ok)) invalidateTree()
      },
    }),
    [
      pendingCreate,
      pendingRename,
      copiedPaths,
      invalidateTree,
      cwd,
      activePath,
      onOpenFile,
    ]
  )

  return (
    <TreeActionsContext.Provider value={treeActions}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-[34px] shrink-0 items-center justify-between border-b border-border/60 px-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          <span>Files</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPendingCreate({ parentAbs: cwd, kind: "file" })}
              aria-label="New file"
              title="New file"
              className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            >
              <FilePlus className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() =>
                setPendingCreate({ parentAbs: cwd, kind: "folder" })
              }
              aria-label="New folder"
              title="New folder"
              className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            >
              <FolderPlus className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setSearchOpen((v) => !v)}
              aria-label="Search files"
              aria-pressed={searchOpen}
              title="Search files"
              className={cn(
                "grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
                searchOpen && "bg-foreground/10 text-foreground"
              )}
            >
              <Search className="size-3.5" />
            </button>
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
        </div>
        {searchOpen && (
          <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/60 bg-popover px-2 text-xs">
            <Search className="size-3 shrink-0 text-muted-foreground" />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault()
                  closeSearch()
                } else if (e.key === "ArrowDown") {
                  e.preventDefault()
                  setSelectedIndex((i) =>
                    matches.length === 0 ? 0 : (i + 1) % matches.length
                  )
                } else if (e.key === "ArrowUp") {
                  e.preventDefault()
                  setSelectedIndex((i) =>
                    matches.length === 0
                      ? 0
                      : (i - 1 + matches.length) % matches.length
                  )
                } else if (e.key === "Enter") {
                  e.preventDefault()
                  const target = matches[selectedIndex]
                  if (target) onOpenFile(target)
                }
              }}
              placeholder="Find file"
              className="min-w-0 flex-1 bg-transparent px-1 py-0.5 outline-none placeholder:text-muted-foreground"
            />
            {filtering && (
              <span className="px-1 text-muted-foreground">
                {matches.length}
              </span>
            )}
            <button
              type="button"
              onClick={closeSearch}
              aria-label="Close search"
              className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/15 hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </div>
        )}
        {filtering ? (
          <ScrollArea className="min-h-0 flex-1">
            <div className="min-h-full py-1">
              {allFilesQuery.isLoading && (
                <div className="px-3 py-1 text-xs text-muted-foreground">
                  Loading…
                </div>
              )}
              {!allFilesQuery.isLoading && matches.length === 0 && (
                <div className="px-3 py-1 text-xs text-muted-foreground">
                  No matches
                </div>
              )}
              {matches.map((rel, i) => (
                <SearchResultRow
                  key={rel}
                  cwd={cwd}
                  relPath={rel}
                  active={rel === activePath}
                  selected={i === selectedIndex}
                  onOpenFile={onOpenFile}
                />
              ))}
            </div>
          </ScrollArea>
        ) : (
          <CollapseSignalContext.Provider value={collapseSignal}>
            <ScrollArea className="min-h-0 flex-1">
              <FileTreeContextMenu absPath={cwd} isDir canRenameCopy={false}>
                <div
                  className={cn(
                    "min-h-full",
                    rootDragOver &&
                      "bg-accent/20 ring-1 ring-ring/30 ring-inset"
                  )}
                  onDragOver={(e) => {
                    if (!hasPathDragData(e.dataTransfer)) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = "move"
                    setRootDragOver(true)
                  }}
                  onDragLeave={(e) => {
                    if (
                      e.currentTarget.contains(e.relatedTarget as Node | null)
                    )
                      return
                    setRootDragOver(false)
                  }}
                  onDrop={(e) => {
                    const paths = getPathDragData(e.dataTransfer)
                    if (paths.length === 0) return
                    e.preventDefault()
                    setRootDragOver(false)
                    void treeActions.moveToDir(paths, cwd)
                  }}
                >
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
        )}
      </div>
    </TreeActionsContext.Provider>
  )
}

const SearchResultRow = memo(function SearchResultRow({
  cwd,
  relPath,
  active,
  selected,
  onOpenFile,
}: {
  cwd: string
  relPath: string
  active: boolean
  selected: boolean
  onOpenFile: (relPath: string) => void
}) {
  const absPath = joinPath(cwd, relPath)
  const name = relPath.split("/").pop() ?? relPath
  const dir = relPath.includes("/")
    ? relPath.slice(0, relPath.length - name.length - 1)
    : ""
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" })
  }, [selected])
  return (
    <FileTreeContextMenu absPath={absPath} isDir={false}>
      <button
        ref={ref}
        type="button"
        draggable
        onDragStart={(e) => setPathDragData(e.dataTransfer, [absPath])}
        onClick={() => onOpenFile(relPath)}
        className={cn(
          "flex w-full items-center gap-1 px-3 py-[3px] text-left text-xs text-foreground hover:bg-accent/40",
          selected && "bg-accent/60",
          active && "bg-foreground/10 dark:bg-foreground/15"
        )}
      >
        <FileIcon name={name} className="size-4 shrink-0" />
        <span className="truncate">{name}</span>
        {dir && (
          <span className="ml-auto truncate pl-2 text-[10px] text-muted-foreground">
            {dir}
          </span>
        )}
      </button>
    </FileTreeContextMenu>
  )
})
