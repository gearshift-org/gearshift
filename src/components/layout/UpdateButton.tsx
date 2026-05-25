import { useEffect, useState } from "react"
import { ArrowUpCircle } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { UpdaterState } from "../../../electron/preload"

export function UpdateButton() {
  const [state, setState] = useState<UpdaterState>({ status: "idle" })

  useEffect(() => {
    const api = window.updaterApi
    if (!api) return
    void api.getState().then((s) => setState(s))
    const unsubscribe = api.onState(setState)
    return unsubscribe
  }, [])

  if (state.status !== "ready") return null

  return (
    <div className="flex items-center pl-1 [-webkit-app-region:no-drag]">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() => window.updaterApi?.quitAndInstall()}
              aria-label={`Restart to update to ${state.version}`}
              className="inline-flex h-6 items-center gap-1 rounded-full bg-primary px-2 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <ArrowUpCircle className="size-3.5" />
              Update
            </button>
          }
        />
        <TooltipContent>Restart to install v{state.version}</TooltipContent>
      </Tooltip>
    </div>
  )
}
