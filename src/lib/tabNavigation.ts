import type { WorkspaceTab } from "@/components/layout/types"

export function tabIdAfterClose(
  tabs: WorkspaceTab[],
  activeTabId: string,
  closingTabId: string,
  lastTerminalTabId?: string
): string {
  if (activeTabId !== closingTabId) return activeTabId

  const closingIndex = tabs.findIndex((tab) => tab.id === closingTabId)
  const closingTab = tabs[closingIndex]
  const remaining = tabs.filter((tab) => tab.id !== closingTabId)

  if (closingTab?.kind !== "terminal" && lastTerminalTabId) {
    const lastTerminal = remaining.find(
      (tab) => tab.kind === "terminal" && tab.id === lastTerminalTabId
    )
    if (lastTerminal) return lastTerminal.id
  }

  const nextIndex = Math.max(0, closingIndex - 1)
  return remaining[nextIndex]?.id ?? ""
}
