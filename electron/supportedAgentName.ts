import path from "node:path"
import type { TerminalAgentName } from "./agentHooks"

export type DetectedAgentName = TerminalAgentName | "grok"

/**
 * Recognize a coding-agent CLI from a process command line. Used when the user
 * submits a prompt (Enter) so chat history is tagged with the right agent, and
 * when polling the PTY tree for live agent status.
 */
export function supportedAgentName(command: string): DetectedAgentName | undefined {
  const lower = command.toLowerCase()
  const tokens = lower.trim().split(/\s+/)
  const basenames = tokens.map((token) =>
    path.basename(token).replace(/\.(js|ts|mjs|cjs)$/, "")
  )

  // Path-component matches let us recognize agents launched via their node/bun
  // wrappers, where the executable basename is just "node"/"bun" and only the
  // script path identifies the agent (e.g. node /…/@anthropic-ai/claude-code/cli.js).
  const hasPathSegment = (segment: string) =>
    tokens.some(
      (token) => token.includes(`/${segment}/`) || token.endsWith(`/${segment}`)
    )

  if (
    basenames.some((base) => base === "claude" || base === "claude-code") ||
    hasPathSegment("claude-code") ||
    hasPathSegment("@anthropic-ai/claude-code")
  ) {
    return "claude"
  }
  if (
    basenames.some((base) => base === "codex" || base === "codex-cli") ||
    hasPathSegment("codex") ||
    hasPathSegment("codex-cli") ||
    hasPathSegment("@openai/codex")
  ) {
    return "codex"
  }
  if (
    basenames.some((base) => base === "opencode") ||
    hasPathSegment("opencode") ||
    hasPathSegment("@opencode/cli") ||
    hasPathSegment("sst/opencode")
  ) {
    return "opencode"
  }
  if (
    basenames.some((base) => base === "pi") ||
    hasPathSegment("pi-coding-agent") ||
    hasPathSegment("@earendil-works/pi-coding-agent") ||
    hasPathSegment("@mariozechner/pi-coding-agent")
  ) {
    return "pi"
  }
  if (
    basenames.some((base) => base === "grok") ||
    hasPathSegment(".grok/bin") ||
    hasPathSegment("grok-build")
  ) {
    return "grok"
  }
  return undefined
}