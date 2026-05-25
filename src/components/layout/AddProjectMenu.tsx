import { FolderOpen, Plus } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { shortenHomePath } from "@/lib/pathDisplay"
import type { RecentProject } from "@/lib/projects"

type Props = {
  recents: RecentProject[]
  onPickRecent: (recent: RecentProject) => void
  onOpenDialog: () => void
}

export function AddProjectMenu({
  recents,
  onPickRecent,
  onOpenDialog,
}: Props) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              aria-label="Add project"
              className="group/add grid h-full w-10 place-items-center text-muted-foreground outline-none"
            >
              <span className="grid size-5 place-items-center rounded-sm transition-colors group-hover/add:bg-foreground/15 group-hover/add:text-foreground">
                <Plus className="size-3.5" />
              </span>
            </DropdownMenuTrigger>
          }
        />
        <TooltipContent>Open project</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-[260px]">
        {recents.length > 0 && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Recent
              </DropdownMenuLabel>
              {recents.map((r) => (
                <DropdownMenuItem
                  key={r.path}
                  onClick={() => onPickRecent(r)}
                  className="flex flex-col items-start gap-0.5"
                >
                  <span className="truncate font-medium">{r.name}</span>
                  <span className="truncate text-[10px] text-muted-foreground">
                    {shortenHomePath(r.path)}
                  </span>
                </DropdownMenuItem>
              ))}
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
