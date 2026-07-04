import * as React from "react"
import { PanelTop, History, Files, MessageSquare } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import {
  loadAutoHideTitleBar,
  saveAutoHideTitleBar,
  loadOpenFilesInOwnTab,
  saveOpenFilesInOwnTab,
  loadHistoryRetentionEnabled,
  saveHistoryRetentionEnabled,
  loadHistoryRetentionDays,
  saveHistoryRetentionDays,
  loadProjectSidebarChatEnabled,
  saveProjectSidebarChatEnabled,
  HISTORY_RETENTION_DEFAULT_DAYS,
  HISTORY_RETENTION_MIN_DAYS,
} from "@/lib/projects"
import { cn } from "@/lib/utils"
import { store } from "@/lib/store"
import { Input } from "@/components/ui/input"

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
  const [autoHideTitleBar, setAutoHideTitleBar] = React.useState(() =>
    loadAutoHideTitleBar()
  )
  const [openFilesInOwnTab, setOpenFilesInOwnTab] = React.useState(() =>
    loadOpenFilesInOwnTab()
  )
  const [retentionEnabled, setRetentionEnabled] = React.useState(() =>
    loadHistoryRetentionEnabled()
  )
  const [retentionDays, setRetentionDays] = React.useState(() =>
    String(loadHistoryRetentionDays())
  )
  const [projectSidebarChat, setProjectSidebarChat] = React.useState(() =>
    loadProjectSidebarChatEnabled()
  )
  React.useEffect(
    () =>
      store.onReady(() => {
        setAutoHideTitleBar(loadAutoHideTitleBar())
        setOpenFilesInOwnTab(loadOpenFilesInOwnTab())
        setRetentionEnabled(loadHistoryRetentionEnabled())
        setRetentionDays(String(loadHistoryRetentionDays()))
        setProjectSidebarChat(loadProjectSidebarChatEnabled())
      }),
    []
  )

  const updateAutoHideTitleBar = (enabled: boolean) => {
    setAutoHideTitleBar(enabled)
    saveAutoHideTitleBar(enabled)
  }

  const updateOpenFilesInOwnTab = (enabled: boolean) => {
    setOpenFilesInOwnTab(enabled)
    saveOpenFilesInOwnTab(enabled)
  }

  const updateRetentionEnabled = (enabled: boolean) => {
    setRetentionEnabled(enabled)
    saveHistoryRetentionEnabled(enabled)
  }

  const updateProjectSidebarChat = (enabled: boolean) => {
    setProjectSidebarChat(enabled)
    saveProjectSidebarChatEnabled(enabled)
  }

  const commitRetentionDays = (raw: string) => {
    const parsed = Math.floor(Number(raw))
    const next =
      raw.trim() !== "" && Number.isFinite(parsed)
        ? Math.max(HISTORY_RETENTION_MIN_DAYS, parsed)
        : HISTORY_RETENTION_DEFAULT_DAYS
    setRetentionDays(String(next))
    saveHistoryRetentionDays(next)
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
          icon={MessageSquare}
          label="Show space chat in sidebar"
          description="Show the Chat entry below the space switcher in the project sidebar."
          checked={projectSidebarChat}
          onChange={updateProjectSidebarChat}
        />
        <SettingToggle
          icon={Files}
          label="Open each commit in its own tab"
          description="Open every commit in a new tab instead of reusing one commit preview tab. File, diff, and dev previews always reuse one tab."
          checked={openFilesInOwnTab}
          onChange={updateOpenFilesInOwnTab}
        />
        <SettingToggle
          icon={History}
          label="Auto-delete chat history"
          description="Automatically prune stored chat messages older than the chosen number of days."
          checked={retentionEnabled}
          onChange={updateRetentionEnabled}
        />
        {retentionEnabled ? (
          <div className="flex items-center gap-3 px-4 py-3 pl-11">
            <label
              htmlFor="history-retention-days"
              className="min-w-0 flex-1 text-sm text-foreground"
            >
              Keep messages for
            </label>
            <Input
              id="history-retention-days"
              inputMode="numeric"
              value={retentionDays}
              onChange={(e) =>
                setRetentionDays(e.target.value.replace(/\D/g, ""))
              }
              onBlur={(e) => commitRetentionDays(e.target.value)}
              className="w-14 text-right"
            />
            <span className="text-sm text-muted-foreground">days</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
