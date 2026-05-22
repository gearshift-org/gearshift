import type { TerminalTab } from "./types"

export function displayName(t: TerminalTab): string {
  return t.customName?.trim() || t.autoTitle?.trim() || t.name
}
