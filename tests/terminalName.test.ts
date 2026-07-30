import { describe, expect, test } from "bun:test"
import { displayName } from "../src/components/layout/terminalName"
import type { TerminalTab } from "../src/components/layout/types"

function terminalTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
  return {
    kind: "terminal",
    id: "tab",
    name: "Terminal",
    panes: [
      {
        id: "pane",
        customName: "Pane name",
        agentSessionTitle: "Session title",
        autoTitle: "Auto title",
      },
    ],
    activePaneId: "pane",
    ...overrides,
  }
}

describe("terminal display names", () => {
  test("uses the active pane custom name for the terminal tab", () => {
    expect(displayName(terminalTab())).toBe("Pane name")
  })

  test("keeps an explicit tab name above the pane name", () => {
    expect(displayName(terminalTab({ customName: "Tab name" }))).toBe(
      "Tab name"
    )
  })
})
