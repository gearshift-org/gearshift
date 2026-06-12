import * as React from "react"
import { Bot, PanelTop } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { loadAutoHideTitleBar, saveAutoHideTitleBar } from "@/lib/projects"
import {
  DEFAULT_AI_COMMIT_PROMPT,
  useAiCommitPrompt,
} from "@/lib/aiCommitPrompt"
import { cn } from "@/lib/utils"
import { store } from "@/lib/store"
import { Button } from "@/components/ui/button"

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
  const {
    prompt: aiCommitPrompt,
    setPrompt: setAiCommitPrompt,
    resetPrompt: resetAiCommitPrompt,
    isDefault: aiCommitPromptIsDefault,
  } = useAiCommitPrompt()
  React.useEffect(
    () =>
      store.onReady(() => {
        setAutoHideTitleBar(loadAutoHideTitleBar())
      }),
    []
  )

  const updateAutoHideTitleBar = (enabled: boolean) => {
    setAutoHideTitleBar(enabled)
    saveAutoHideTitleBar(enabled)
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
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="flex items-start gap-3 border-b border-border px-4 py-3">
          <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium text-foreground">
              Commit with AI prompt
            </h3>
            <p className="text-xs text-muted-foreground">
              Sent to the remembered coding-agent terminal when you choose
              Commit with AI.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={resetAiCommitPrompt}
            disabled={aiCommitPromptIsDefault}
          >
            Reset
          </Button>
        </div>
        <div className="flex flex-col gap-2 p-4">
          <textarea
            value={aiCommitPrompt}
            onChange={(e) => setAiCommitPrompt(e.target.value)}
            rows={5}
            placeholder={DEFAULT_AI_COMMIT_PROMPT}
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <p className="text-xs text-muted-foreground">
            Leave it empty or reset to use the default prompt.
          </p>
        </div>
      </div>
    </div>
  )
}
