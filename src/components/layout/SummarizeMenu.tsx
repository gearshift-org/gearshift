import { Sparkles } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// All agents the app can launch; summarize requires one of these to already
// be running in the project.
const SUMMARIZE_AGENTS = ["claude", "codex", "opencode", "pi", "gemini"]

export function SummarizeMenu({
  onSummarize,
}: {
  onSummarize: (agent: string) => void
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              aria-label="Summarize recent commits"
              className="grid size-5 place-items-center rounded-sm text-foreground outline-none transition-colors hover:bg-foreground/15"
            >
              <Sparkles className="size-3.5" />
            </DropdownMenuTrigger>
          }
        />
        <TooltipContent>Summarize recent commits</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
            Summarize with
          </DropdownMenuLabel>
          {SUMMARIZE_AGENTS.map((agent) => (
            <DropdownMenuItem
              key={agent}
              onClick={() => onSummarize(agent)}
              className="capitalize"
            >
              {agent}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
