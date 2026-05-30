import * as React from "react"
import { PanelLeft, PanelRight, PanelTop } from "lucide-react"
import type { LucideIcon } from "lucide-react"
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

type SettingToggleProps = {
  icon: LucideIcon
  label: string
  description: string
  checked: boolean
  onChange: (enabled: boolean) => void
}

function SettingToggle({
  icon: Icon,
  label,
  description,
  checked,
  onChange,
}: SettingToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">
          {label}
        </span>
        <span className="block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border border-border transition-colors",
          checked ? "bg-primary" : "bg-muted"
        )}
        aria-hidden="true"
      >
        <span
          className={cn(
            "absolute top-1/2 size-4 -translate-y-1/2 rounded-full bg-background shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5"
          )}
        />
      </span>
    </button>
  )
}

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

      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
        <SettingToggle
          icon={PanelTop}
          label="Auto-hide title bar"
          description="Hide the title bar and traffic lights after a short delay. Hover the top edge to slide it back down."
          checked={autoHideTitleBar}
          onChange={updateAutoHideTitleBar}
        />
        <SettingToggle
          icon={PanelLeft}
          label="Vertical project sidebar"
          description="Show projects in a left sidebar instead of tabs across the top."
          checked={projectSidebarLayout}
          onChange={updateProjectSidebarLayout}
        />
        <SettingToggle
          icon={PanelRight}
          label="Right sidebar edge reveal"
          description="When the right sidebar is hidden, move your mouse to the right edge to open it."
          checked={edgeReveal}
          onChange={updateEdgeReveal}
        />
      </div>
    </div>
  )
}
