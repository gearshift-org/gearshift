import { RotateCcw, TerminalSquare } from "lucide-react"
import { AgentIcon } from "@/components/layout/AgentIcon"
import {
  AGENT_TERMINAL_FULL_ACCESS_OPTIONS,
  AGENT_TERMINAL_LABELS,
  AGENT_TERMINAL_NAMES,
  useAgentTerminalOptions,
} from "@/lib/agentTerminalOptions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function AgentsPanel() {
  const { options, setAgentOptions, resetOptions, hasCustomOptions } =
    useAgentTerminalOptions()

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Agents</h2>
        <p className="text-sm text-muted-foreground">
          Set default launch options for coding-agent terminals.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="flex items-start gap-3 border-b border-border px-4 py-3">
          <TerminalSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium text-foreground">
              Agent launch options
            </h3>
            <p className="text-xs text-muted-foreground">
              These flags are appended when a new agent terminal starts. The
              placeholders show each agent's full-access option.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={resetOptions}
            disabled={!hasCustomOptions}
          >
            <RotateCcw data-icon="inline-start" />
            Reset
          </Button>
        </div>
        <div className="flex flex-col divide-y divide-border">
          {AGENT_TERMINAL_NAMES.map((agentName) => (
            <label
              key={agentName}
              className="flex items-center gap-3 px-4 py-3"
            >
              <span className="flex w-28 shrink-0 items-center gap-2 text-sm font-medium text-foreground">
                <AgentIcon agent={agentName} className="size-4" />
                {AGENT_TERMINAL_LABELS[agentName]}
              </span>
              <Input
                value={options[agentName]}
                onChange={(event) =>
                  setAgentOptions(agentName, event.target.value)
                }
                placeholder={AGENT_TERMINAL_FULL_ACCESS_OPTIONS[agentName]}
                aria-label={`${AGENT_TERMINAL_LABELS[agentName]} launch options`}
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
