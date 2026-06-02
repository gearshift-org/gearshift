import { useSyncExternalStore } from "react"
import { useRouter } from "@tanstack/react-router"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// TanStack history stores the current entry's index under this state key.
const STATE_INDEX_KEY = "__TSR_index"

function historyIndex(state: unknown): number {
  const value = (state as Record<string, unknown> | null)?.[STATE_INDEX_KEY]
  return typeof value === "number" ? value : 0
}

/**
 * Browser-style back/forward buttons driven by the router's memory history.
 * Mirrors the mouse back/forward handler wired up in main.tsx.
 */
export function HistoryNavButtons({ className }: { className?: string }) {
  const router = useRouter()
  const history = router.history
  // Re-render whenever the history stack changes so the disabled state of each
  // arrow stays accurate. The snapshot is a primitive so React can bail out
  // when nothing relevant moved.
  useSyncExternalStore(
    history.subscribe,
    () => `${historyIndex(history.location.state)}:${history.length}`
  )

  const index = historyIndex(history.location.state)
  const canGoBack = index > 0
  const canGoForward = index < history.length - 1

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() => history.back()}
              disabled={!canGoBack}
              aria-label="Back"
              className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors [-webkit-app-region:no-drag] hover:bg-foreground/15 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <ArrowLeft className="size-3.5" />
            </button>
          }
        />
        <TooltipContent>Back</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() => history.forward()}
              disabled={!canGoForward}
              aria-label="Forward"
              className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors [-webkit-app-region:no-drag] hover:bg-foreground/15 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <ArrowRight className="size-3.5" />
            </button>
          }
        />
        <TooltipContent>Forward</TooltipContent>
      </Tooltip>
    </div>
  )
}
