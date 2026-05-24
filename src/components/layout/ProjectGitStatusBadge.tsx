import { useQuery } from "@tanstack/react-query"
import { GitBranch } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { fetchGitQueryData, gitQueryKey } from "@/lib/gitStatusQuery"
import { ChangeCountBadge } from "./ChangeCountBadge"

type Props = {
  cwd: string | null
  onOpenChanges: () => void
}

export function ProjectGitStatusBadge({ cwd, onOpenChanges }: Props) {
  const gitQuery = useQuery({
    queryKey: gitQueryKey(cwd),
    enabled: !!cwd,
    queryFn: () => fetchGitQueryData(cwd!),
  })
  const count = gitQuery.data?.files.length ?? 0

  if (!cwd || gitQuery.isError || count === 0) return null

  const label = `Open ${count} changed ${count === 1 ? "file" : "files"}`

  return (
    <div className="flex items-center pr-1 [-webkit-app-region:no-drag]">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={onOpenChanges}
              aria-label={label}
              className="relative grid size-5 place-items-center rounded-sm text-foreground transition-colors hover:bg-foreground/15"
            >
              <GitBranch className="size-3.5" />
              <ChangeCountBadge
                count={count}
                className="absolute right-0 bottom-0 translate-x-1/4 translate-y-1/4 ring-1 ring-background"
              />
            </button>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </div>
  )
}
