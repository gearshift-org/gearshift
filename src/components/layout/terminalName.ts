import type { TerminalTab, WorkspaceTab } from "./types"

// Strip leading sparkle/asterisk-style glyphs that some TUIs (e.g. Claude Code)
// prepend to their window title — we already render a dedicated agent icon
// next to the title, so the duplicate decorative glyph looks like garbage.
// Covers ASCII *, common Unicode sparkles, asterisk variants, and the Braille
// spinner range (U+2800–U+28FF) that Claude Code cycles through while busy.
const LEADING_SPARKLE_RE =
  /^[∗✱✳✴✵✶✷✸✹✺✻✼✽✢✣✤✥✦✧✨✩✪✫✬✭✮✯✰☄⚝⁂⁎⁕٭⁂*⠀-⣿]+\s*/
// Some agents emit "<sparkle> · <title>" — after the sparkle is stripped we'd
// be left with a leading separator. Strip those too.
const LEADING_SEPARATOR_RE = /^[·•‧⋅∙・⸱⸳◦●○◇◆▪▫►▶–—−‒|]\s*/
const SHELL_TITLE_RE = /^[^@:\s]+@[^:]+:(.+)$/

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

export function displayName(t: TerminalTab): string {
  return t.customName?.trim() || formatAutoTitle(t.autoTitle) || t.name
}

/** Display name for any workspace tab kind. */
export function tabDisplayName(t: WorkspaceTab): string {
  if (t.kind === "terminal") return displayName(t)
  return t.name
}
