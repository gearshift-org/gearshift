import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
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
import { HISTORY_RANGE_OPTIONS, type HistoryRange } from "@/lib/historySummary"

type Props = {
  onSelect: (range: HistoryRange) => void
  disabled?: boolean
  align?: "start" | "center" | "end"
  side?: "top" | "bottom" | "left" | "right"
  /** Override the trigger button styling for the host context. */
  className?: string
  /** Stop pointer/mouse events from bubbling (e.g. pane-header drag). */
  stopPropagation?: boolean
}

/**
 * Single source of truth for the "Summarize chat history" control — the same
 * dropdown is used in the sidebar History panel and the terminal pane header.
 * The caller decides what each range does via `onSelect`.
 */
export function SummarizeHistoryMenu({
  onSelect,
  disabled,
  align = "end",
  side = "bottom",
  className,
  stopPropagation,
}: Props) {
  const stop = stopPropagation
    ? {
        onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
        onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
      }
    : {}
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              {...stop}
              disabled={disabled}
              aria-label="Summarize chat history"
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-sm text-foreground transition-colors outline-none hover:bg-foreground/15 disabled:opacity-30",
                className
              )}
            >
              <Sparkles className="size-3.5" />
            </DropdownMenuTrigger>
          }
        />
        <TooltipContent>Summarize chat history</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align={align} side={side} className="min-w-[160px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
            Summarize
          </DropdownMenuLabel>
          {HISTORY_RANGE_OPTIONS.map((opt) => (
            <DropdownMenuItem key={opt.key} onClick={() => onSelect(opt.key)}>
              {opt.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
