import type { TerminalTab } from "./types"

const SHELL_TITLE_RE = /^[^@:\s]+@[^:]+:(.+)$/
const PATH_LIKE_TITLE_RE = /^(~|\.{1,2}|\/)|\//

export function formatAutoTitle(title: string | undefined): string | undefined {
  const trimmed = title?.trim()
  if (!trimmed) return undefined

  const shellTitle = trimmed.match(SHELL_TITLE_RE)
  if (!shellTitle) return trimmed

  const shellValue = shellTitle[1]?.trim()
  if (!shellValue || !PATH_LIKE_TITLE_RE.test(shellValue)) return undefined

  return shellValue
}

export function displayName(t: TerminalTab): string {
  return t.customName?.trim() || formatAutoTitle(t.autoTitle) || t.name
}
