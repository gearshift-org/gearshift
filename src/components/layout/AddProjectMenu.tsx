import { useMemo, useState, type KeyboardEvent } from "react"
import { FolderOpen, FolderPlus, Plus, Search, X } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { shortenHomePath } from "@/lib/pathDisplay"
import { cn } from "@/lib/utils"
import { menuItemActiveClass } from "@/components/ui/menu-styles"
import type { RecentProject } from "@/lib/projects"

type Props = {
  recents: RecentProject[]
  onPickRecent: (recent: RecentProject) => void
  onRemoveRecent?: (recent: RecentProject) => void
  onOpenDialog: () => void
  variant?: "tab" | "sidebar" | "sidebar-icon"
  compact?: boolean
}

export function AddProjectMenu({
  recents,
  onPickRecent,
  onRemoveRecent,
  onOpenDialog,
  variant = "tab",
  compact = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const filteredRecents = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return recents
    return recents.filter(
      (recent) =>
        recent.name.toLowerCase().includes(q) ||
        recent.path.toLowerCase().includes(q)
    )
  }, [query, recents])
  const selectionKey = `${query}\0${filteredRecents.length}`
  const [selection, setSelection] = useState({ key: selectionKey, index: 0 })
  const selectedIndex =
    selection.key === selectionKey
      ? Math.min(selection.index, Math.max(filteredRecents.length - 1, 0))
      : 0
  const setSelectedIndex = (next: number | ((index: number) => number)) => {
    setSelection((prev) => {
      const index = prev.key === selectionKey ? prev.index : 0
      return {
        key: selectionKey,
        index: typeof next === "function" ? next(index) : next,
      }
    })
  }

  const pickRecent = (recent: RecentProject) => {
    onPickRecent(recent)
    setOpen(false)
  }

  const pickSelectedRecent = () => {
    const recent = filteredRecents[selectedIndex]
    if (recent) pickRecent(recent)
  }

  const handleFilterKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // The input owns filtering, so menu keyboard events do not reach Base UI's
    // default roving focus. Mirror the expected command-menu behavior here.
    e.stopPropagation()
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex((i) =>
        filteredRecents.length === 0 ? 0 : (i + 1) % filteredRecents.length
      )
      return
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex((i) =>
        filteredRecents.length === 0
          ? 0
          : (i - 1 + filteredRecents.length) % filteredRecents.length
      )
      return
    }
    if (e.key === "Enter") {
      if (filteredRecents.length === 0) return
      e.preventDefault()
      pickSelectedRecent()
    }
  }

  const recentItems = filteredRecents.map((r, index) => {
    const selected = index === selectedIndex
    return (
      <DropdownMenuItem
        key={r.path}
        onClick={() => pickRecent(r)}
        onMouseMove={() => setSelectedIndex(index)}
        className={cn(
          "group/recent relative mx-1 flex items-center gap-2 pr-7",
          selected && menuItemActiveClass
        )}
      >
        <div className="min-w-0 flex-1">
          <span className="block truncate font-medium">{r.name}</span>
          <span
            className={cn(
              "block truncate text-[10px]",
              selected ? "text-foreground/70" : "text-muted-foreground"
            )}
          >
            {shortenHomePath(r.path)}
          </span>
        </div>
        {onRemoveRecent && (
          <button
            type="button"
            aria-label={`Remove ${r.name} from recent projects`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onRemoveRecent(r)
            }}
            className="absolute right-1.5 grid size-5 place-items-center rounded-sm text-muted-foreground opacity-0 transition-opacity group-hover/recent:opacity-100 hover:bg-background/40 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="size-3" />
          </button>
        )}
      </DropdownMenuItem>
    )
  })
  const shouldScrollRecents = filteredRecents.length > 5
  const isSidebarIcon = variant === "sidebar-icon"

  const trigger =
    variant === "sidebar" ? (
      <DropdownMenuTrigger
        aria-label="Add project"
        className={cn(
          "group/add flex w-full items-center gap-2.5 rounded-sm px-2 text-sm leading-tight font-medium text-muted-foreground transition-colors outline-none hover:bg-sidebar-accent/70 hover:text-foreground",
          compact ? "py-1.5" : "py-2"
        )}
      >
        <span className="grid size-4 shrink-0 place-items-center">
          <Plus className="size-3.5" />
        </span>
        Add Project
      </DropdownMenuTrigger>
    ) : isSidebarIcon ? (
      <DropdownMenuTrigger
        aria-label="Add project"
        className="grid size-5 place-items-center rounded-sm text-muted-foreground/80 transition-colors outline-none hover:text-foreground data-[popup-open]:text-foreground"
      >
        <FolderPlus className="size-3.5" />
      </DropdownMenuTrigger>
    ) : (
      <DropdownMenuTrigger
        aria-label="Add project"
        className="group/add grid h-full w-10 place-items-center text-muted-foreground outline-none"
      >
        <span className="grid size-5 place-items-center rounded-sm transition-colors group-hover/add:bg-foreground/15 group-hover/add:text-foreground">
          <Plus className="size-3.5" />
        </span>
      </DropdownMenuTrigger>
    )

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {variant === "sidebar" ? (
        trigger
      ) : (
        <Tooltip>
          <TooltipTrigger render={trigger} />
          <TooltipContent>
            {isSidebarIcon ? "Add project" : "Open project"}
          </TooltipContent>
        </Tooltip>
      )}
      <DropdownMenuContent
        align={isSidebarIcon ? "end" : "start"}
        className={cn(
          "flex max-h-[min(520px,var(--available-height))] min-w-[260px] flex-col overflow-hidden",
          variant === "sidebar" && "w-[214px]"
        )}
      >
        {recents.length > 0 && (
          <>
            <div className="relative p-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleFilterKeyDown}
                placeholder="Filter projects..."
                className="h-8 pl-7"
              />
            </div>
            <DropdownMenuGroup className="min-h-0">
              <DropdownMenuLabel className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                Recent
              </DropdownMenuLabel>
              {filteredRecents.length > 0 ? (
                shouldScrollRecents ? (
                  <ScrollArea className="-mr-1 h-72 overflow-hidden pr-1">
                    {recentItems}
                  </ScrollArea>
                ) : (
                  recentItems
                )
              ) : (
                <div className="px-1.5 py-2 text-sm text-muted-foreground">
                  No projects found
                </div>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={onOpenDialog}>
          <FolderOpen className="size-3.5" />
          Open Project…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
