import { useEffect, useState } from "react"
import { ArrowUpCircle, Download } from "lucide-react"
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

  if (state.status === "available" || state.status === "downloading") {
    const percent =
      state.status === "downloading"
        ? Math.max(0, Math.min(100, Math.round(state.percent)))
        : 0
    const label =
      state.status === "downloading" ? `Downloading ${percent}%` : "Downloading…"

    return (
      <div className="mx-1.5 flex shrink-0 items-center [-webkit-app-region:no-drag]">
        <Tooltip>
          <TooltipTrigger
            render={
              <div
                role="status"
                aria-label={`Downloading update${state.status === "downloading" ? ` ${percent}%` : ""}`}
                className="relative inline-flex h-5 min-w-24 overflow-hidden rounded-full border border-border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground"
              >
                <div
                  className="absolute inset-y-0 left-0 bg-primary/20 transition-[width]"
                  style={{ width: `${percent}%` }}
                />
                <span className="relative inline-flex items-center gap-1">
                  <Download className="size-3" />
                  {label}
                </span>
              </div>
            }
          />
          <TooltipContent>Downloading application update</TooltipContent>
        </Tooltip>
      </div>
    )
  }

  if (state.status !== "ready") return null

  return (
    <div className="mx-1.5 flex shrink-0 items-center [-webkit-app-region:no-drag]">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() => window.updaterApi?.quitAndInstall()}
              aria-label={`Restart to update to ${state.version}`}
              className="inline-flex h-5 items-center gap-1 rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <ArrowUpCircle className="size-3" />
              Restart to Update
            </button>
          }
        />
        <TooltipContent>Restart to install v{state.version}</TooltipContent>
      </Tooltip>
    </div>
  )
}
