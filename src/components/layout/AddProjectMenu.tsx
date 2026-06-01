import { useEffect, useMemo, useState, type KeyboardEvent } from "react"
import { FolderOpen, Plus, Search, X } from "lucide-react"
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
import type { RecentProject } from "@/lib/projects"

type Props = {
  recents: RecentProject[]
  onPickRecent: (recent: RecentProject) => void
  onRemoveRecent?: (recent: RecentProject) => void
  onOpenDialog: () => void
  variant?: "tab" | "sidebar"
}

export function AddProjectMenu({
  recents,
  onPickRecent,
  onRemoveRecent,
  onOpenDialog,
  variant = "tab",
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
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    setSelectedIndex(0)
  }, [query, filteredRecents.length])

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
          "group/recent relative flex items-center gap-2 pr-7",
          selected && "bg-accent text-accent-foreground"
        )}
      >
        <div className="min-w-0 flex-1">
          <span className="block truncate font-medium">{r.name}</span>
          <span
            className={cn(
              "block truncate text-[10px]",
              selected ? "text-accent-foreground/80" : "text-muted-foreground"
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
            className="absolute right-1.5 grid size-5 place-items-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-background/40 hover:text-foreground group-hover/recent:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3" />
          </button>
        )}
      </DropdownMenuItem>
    )
  })
  const shouldScrollRecents = filteredRecents.length > 5

  const trigger =
    variant === "sidebar" ? (
      <DropdownMenuTrigger
        aria-label="Add project"
        className="group/add flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors outline-none hover:bg-accent/40 hover:text-foreground"
      >
        <span className="grid size-4 shrink-0 place-items-center">
          <Plus className="size-3.5" />
        </span>
        Add Project
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
          <TooltipContent>Open project</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenuContent
        align="start"
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
                  <ScrollArea className="-mr-2 h-72 overflow-hidden">
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
