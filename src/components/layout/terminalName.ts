import type {
  TerminalAgentName,
  TerminalPane,
  TerminalTab,
  WorkspaceTab,
} from "./types"

// Strip leading sparkle/asterisk-style glyphs that some TUIs (e.g. Claude Code)
// prepend to their window title — we already render a dedicated agent icon
// next to the title, so the duplicate decorative glyph looks like garbage.
// Covers ASCII *, common Unicode sparkles, asterisk variants, the Braille
// spinner range (U+2800–U+28FF) that Claude Code cycles through while busy, and
// the π glyph pi prepends (e.g. "π - wayfinder").
const LEADING_SPARKLE_RE =
  /^[∗✱✳✴✵✶✷✸✹✺✻✼✽✢✣✤✥✦✧✨✩✪✫✬✭✮✯✰☄⚝⁂⁎⁕٭⁂*πΠ⠀-⣿]+\s*/
// Some agents emit "<sparkle> · <title>" — after the sparkle is stripped we'd
// be left with a leading separator. Strip those too (incl. ASCII hyphen, e.g.
// pi's "π - <cwd>").
const LEADING_SEPARATOR_RE = /^[·•‧⋅∙・⸱⸳◦●○◇◆▪▫►▶–—−‒|-]\s*/
const SHELL_TITLE_RE = /^[^@:\s]+@[^:]+:(.+)$/

function agentDisplayName(agentName: TerminalAgentName | undefined): string | undefined {
  switch (agentName) {
    case "claude":
      return "Claude"
    case "codex":
      return "Codex"
    case "opencode":
      return "OpenCode"
    case "pi":
      return "Pi"
    default:
      return undefined
  }
}

export function formatAutoTitle(title: string | undefined): string | undefined {
  if (!title) return undefined
  let trimmed = title.trim()
  while (true) {
    const next = trimmed
      .replace(LEADING_SPARKLE_RE, "")
      .replace(LEADING_SEPARATOR_RE, "")
    if (next === trimmed) break
    trimmed = next
  }
  trimmed = trimmed.trim()
  if (!trimmed) return undefined
  const shellTitle = trimmed.match(SHELL_TITLE_RE)
  return shellTitle?.[1]?.trim() || trimmed
}

export function agentActivityTitleSignal(
  title: string | undefined,
): string | undefined {
  if (!title) return undefined
  const match = title.trim().match(LEADING_SPARKLE_RE)
  return match?.[0]?.trim() || undefined
}

export function hasAgentActivityTitleSignal(title: string | undefined): boolean {
  return !!agentActivityTitleSignal(title)
}

export function displayName(t: TerminalTab): string {
  // Explicit user-set name always wins.
  if (t.customName?.trim()) return t.customName.trim()
  const activePane =
    t.panes.find((p) => p.id === t.activePaneId) ?? t.panes[0]
  // Agent session title (AI title / first prompt) preferred over the raw TUI
  // window title, which is usually just the agent name.
  const sessionTitle = activePane?.agentSessionTitle?.trim()
  if (sessionTitle) return sessionTitle
  const autoFromPane = formatAutoTitle(activePane?.autoTitle)
  return autoFromPane || agentDisplayName(activePane?.agentStatus?.agentName) || t.name
}

/** Display name for any workspace tab kind. */
export function tabDisplayName(t: WorkspaceTab): string {
  if (t.kind === "terminal") return displayName(t)
  return t.name
}

/** Display name for a single pane within a split terminal tab. */
export function paneDisplayName(
  pane: TerminalPane,
  index: number,
): string {
  if (pane.customName?.trim()) return pane.customName.trim()
  const sessionTitle = pane.agentSessionTitle?.trim()
  if (sessionTitle) return sessionTitle
  const auto = formatAutoTitle(pane.autoTitle)
  if (auto) return auto
  const agentName = agentDisplayName(pane.agentStatus?.agentName)
  if (agentName) return agentName
  return `Pane ${index + 1}`
}
