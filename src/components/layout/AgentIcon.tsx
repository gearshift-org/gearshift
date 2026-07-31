import { cn } from "@/lib/utils"
import type { RuntimeAgentName } from "./types"
import { AGENT_SVG } from "./agentIcons"

/**
 * Renders an agent's brand icon inline so it picks up `currentColor`. Returns
 * null for agents without an icon, so callers can fall back to a default.
 */
export function AgentIcon({
  agent,
  className,
}: {
  agent: RuntimeAgentName | undefined
  className?: string
}) {
  const svg = agent ? AGENT_SVG[agent] : undefined
  if (!svg) return null
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 place-items-center [&>svg]:size-full",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
