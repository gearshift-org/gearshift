import type { RuntimeAgentName } from "./types"
import claudeRaw from "@/assets/agents/claude.svg?raw"
import codexRaw from "@/assets/agents/codex.svg?raw"
import grokRaw from "@/assets/agents/grok.svg?raw"
import opencodeRaw from "@/assets/agents/opencode.svg?raw"
import piRaw from "@/assets/agents/pi.svg?raw"

// Brand glyphs for the agents we have icons for. The SVGs use
// fill="currentColor", so they inherit the surrounding text color.
export const AGENT_SVG: Partial<Record<RuntimeAgentName, string>> = {
  claude: claudeRaw,
  codex: codexRaw,
  grok: grokRaw,
  opencode: opencodeRaw,
  pi: piRaw,
}

export function hasAgentIcon(agent: RuntimeAgentName | undefined): boolean {
  return !!agent && agent in AGENT_SVG
}