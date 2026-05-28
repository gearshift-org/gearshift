import * as React from "react"
import { PanelLeft, PanelRight, PanelTop } from "lucide-react"
import {
  loadAutoHideTitleBar,
  loadProjectSidebarLayout,
  loadRightSidebarEdgeReveal,
  saveAutoHideTitleBar,
  saveProjectSidebarLayout,
  saveRightSidebarEdgeReveal,
} from "@/lib/projects"
import { cn } from "@/lib/utils"
import { store } from "@/lib/store"

export function GeneralPanel() {
  const [edgeReveal, setEdgeReveal] = React.useState(() =>
    loadRightSidebarEdgeReveal()
  )
  const [autoHideTitleBar, setAutoHideTitleBar] = React.useState(() =>
    loadAutoHideTitleBar()
  )
  const [projectSidebarLayout, setProjectSidebarLayout] = React.useState(() =>
    loadProjectSidebarLayout()
  )

  React.useEffect(
    () =>
      store.onReady(() => {
        setEdgeReveal(loadRightSidebarEdgeReveal())
        setAutoHideTitleBar(loadAutoHideTitleBar())
        setProjectSidebarLayout(loadProjectSidebarLayout())
      }),
    []
  )

  const updateEdgeReveal = (enabled: boolean) => {
    setEdgeReveal(enabled)
    saveRightSidebarEdgeReveal(enabled)
  }

  const updateAutoHideTitleBar = (enabled: boolean) => {
    setAutoHideTitleBar(enabled)
    saveAutoHideTitleBar(enabled)
  }

  const updateProjectSidebarLayout = (enabled: boolean) => {
    setProjectSidebarLayout(enabled)
    saveProjectSidebarLayout(enabled)
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">General</h2>
        <p className="text-sm text-muted-foreground">
          Tune workspace behavior for everyday use.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-background">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <PanelTop className="size-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">Window</h3>
            <p className="text-xs text-muted-foreground">
              Control the title bar and native window controls.
            </p>
          </div>
        </div>
        <div className="p-4">
          <button
            type="button"
            role="switch"
            aria-checked={autoHideTitleBar}
            onClick={() => updateAutoHideTitleBar(!autoHideTitleBar)}
            className="flex w-full items-center justify-between gap-4 rounded-md border border-border bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <span>
              <span className="block text-sm font-medium text-foreground">
                Auto Hide Title Bar
              </span>
              <span className="block text-xs text-muted-foreground">
                Hide the title bar and traffic lights after a short delay. Hover
                the top edge to slide it back down.
              </span>
            </span>
            <span
              className={cn(
                "relative h-5 w-9 shrink-0 rounded-full border border-border transition-colors",
                autoHideTitleBar ? "bg-primary" : "bg-muted"
              )}
              aria-hidden="true"
            >
              <span
                className={cn(
                  "absolute top-1/2 size-4 -translate-y-1/2 rounded-full bg-background shadow-sm transition-transform",
                  autoHideTitleBar ? "translate-x-4" : "translate-x-0.5"
                )}
              />
            </span>
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <PanelLeft className="size-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">Projects</h3>
            <p className="text-xs text-muted-foreground">
              Choose how open projects are listed.
            </p>
          </div>
        </div>
        <div className="p-4">
          <button
            type="button"
            role="switch"
            aria-checked={projectSidebarLayout}
            onClick={() => updateProjectSidebarLayout(!projectSidebarLayout)}
            className="flex w-full items-center justify-between gap-4 rounded-md border border-border bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <span>
              <span className="block text-sm font-medium text-foreground">
                Vertical project sidebar
              </span>
              <span className="block text-xs text-muted-foreground">
                Show projects in a left sidebar instead of tabs across the top.
              </span>
            </span>
            <span
              className={cn(
                "relative h-5 w-9 shrink-0 rounded-full border border-border transition-colors",
                projectSidebarLayout ? "bg-primary" : "bg-muted"
              )}
              aria-hidden="true"
            >
              <span
                className={cn(
                  "absolute top-1/2 size-4 -translate-y-1/2 rounded-full bg-background shadow-sm transition-transform",
                  projectSidebarLayout ? "translate-x-4" : "translate-x-0.5"
                )}
              />
            </span>
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <PanelRight className="size-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Right sidebar
            </h3>
            <p className="text-xs text-muted-foreground">
              Reveal hidden project tools from the right edge of the window.
            </p>
          </div>
        </div>
        <div className="p-4">
          <button
            type="button"
            role="switch"
            aria-checked={edgeReveal}
            onClick={() => updateEdgeReveal(!edgeReveal)}
            className="flex w-full items-center justify-between gap-4 rounded-md border border-border bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <span>
              <span className="block text-sm font-medium text-foreground">
                Edge reveal
              </span>
              <span className="block text-xs text-muted-foreground">
                When the right sidebar is hidden, move your mouse to the right
                edge to open it.
              </span>
            </span>
            <span
              className={cn(
                "relative h-5 w-9 shrink-0 rounded-full border border-border transition-colors",
                edgeReveal ? "bg-primary" : "bg-muted"
              )}
              aria-hidden="true"
            >
              <span
                className={cn(
                  "absolute top-1/2 size-4 -translate-y-1/2 rounded-full bg-background shadow-sm transition-transform",
                  edgeReveal ? "translate-x-4" : "translate-x-0.5"
                )}
              />
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
