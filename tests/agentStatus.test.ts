import { describe, expect, test } from "bun:test"
import {
  detectAgentOutputFallbackSignal,
  detectAgentTitleFallbackSignal,
  projectAgentState,
  terminalAgentState,
  terminalTabAgentState,
} from "../src/lib/agentStatus"
import { toStoredAgentStatus } from "../src/lib/projects"
import {
  mergeRuntimeAgentName,
  type Project,
  type TerminalTab,
} from "../src/components/layout/types"

function terminalTab(
  statuses: TerminalTab["panes"][number]["agentStatus"][]
): TerminalTab {
  const panes = statuses.map((agentStatus, index) => ({
    id: `pane-${index}`,
    ...(agentStatus ? { agentStatus } : {}),
  }))
  return {
    kind: "terminal",
    id: "tab",
    name: "Terminal",
    panes,
    activePaneId: panes[0]?.id ?? "pane-0",
  }
}

function project(tab: TerminalTab, flags: Partial<Project> = {}): Project {
  return {
    id: "project",
    name: "Project",
    path: "/tmp/project",
    spaceId: "default",
    tabs: [tab],
    activeTabId: tab.id,
    ...flags,
  }
}

describe("agent status semantics", () => {
  test("maps runtime flags to semantic states", () => {
    expect(terminalAgentState(undefined)).toBe("unknown")
    expect(terminalAgentState({ running: false, working: false })).toBe(
      "unknown"
    )
    expect(terminalAgentState({ running: true, working: false })).toBe("idle")
    expect(terminalAgentState({ running: true, working: true })).toBe("working")
    expect(
      terminalAgentState({
        running: true,
        working: true,
        needsAttention: true,
      })
    ).toBe("blocked")
    expect(
      terminalAgentState({ running: true, working: false, completed: true })
    ).toBe("done")
  })

  test("rolls terminal tabs up by attention priority", () => {
    expect(
      terminalTabAgentState(
        terminalTab([
          { running: true, working: true },
          { running: true, working: false, needsAttention: true },
        ])
      )
    ).toBe("blocked")

    expect(
      terminalTabAgentState(
        terminalTab([
          { running: true, working: false, completed: true },
          { running: true, working: true },
        ])
      )
    ).toBe("working")
  })

  test("includes project-level away markers in rollups", () => {
    expect(
      projectAgentState(
        project(terminalTab([{ running: false, working: false }]), {
          agentDone: true,
        })
      )
    ).toBe("done")

    expect(
      projectAgentState(
        project(terminalTab([{ running: true, working: true }]), {
          agentNeedsAttention: true,
        })
      )
    ).toBe("blocked")
  })

  test("ignores stale project markers when no terminal pane remains", () => {
    expect(
      projectAgentState({
        id: "project",
        name: "Project",
        path: "/tmp/project",
        spaceId: "default",
        tabs: [],
        activeTabId: "",
        agentDone: true,
        agentNeedsAttention: true,
      })
    ).toBe("unknown")
  })
})

describe("agent fallback signals", () => {
  test("detects codex title states", () => {
    expect(detectAgentTitleFallbackSignal("codex", "Action Required")).toBe(
      "blocked"
    )
    expect(detectAgentTitleFallbackSignal("codex", "\u2801 Working")).toBe(
      "working"
    )
    expect(detectAgentTitleFallbackSignal("codex", "Codex")).toBe("idle")
  })

  test("detects claude title states", () => {
    expect(detectAgentTitleFallbackSignal("claude", "\u2801 Thinking")).toBe(
      "working"
    )
    expect(detectAgentTitleFallbackSignal("claude", "\u2733 Claude")).toBe(
      "idle"
    )
  })

  test("detects strong output blockers", () => {
    expect(
      detectAgentOutputFallbackSignal(
        "claude",
        "\x1b[31mDo you want to proceed?\x1b[0m esc to cancel 1. Yes 2. No"
      )
    ).toBe("blocked")
    expect(detectAgentOutputFallbackSignal("codex", "ordinary output")).toBe(
      null
    )
  })

  test("detects opencode question menus as blockers", () => {
    expect(
      detectAgentOutputFallbackSignal(
        "opencode",
        "Which country would you like to choose?\n1. Japan\n2. Italy\n6. Type your own answer\n↑↓ select  enter submit  esc dismiss"
      )
    ).toBe("blocked")
  })
})

describe("runtime agent identity", () => {
  test("keeps grok when claude hooks mislabel an active grok session", () => {
    expect(mergeRuntimeAgentName("grok", "claude", true)).toBe("grok")
    expect(mergeRuntimeAgentName("grok", undefined, true)).toBe("grok")
  })

  test("allows agent changes when the session is no longer running", () => {
    expect(mergeRuntimeAgentName("grok", undefined, false)).toBeUndefined()
    expect(mergeRuntimeAgentName("claude", "codex", false)).toBe("codex")
  })
})

describe("agent status persistence", () => {
  test("does not persist live states across restarts", () => {
    expect(
      toStoredAgentStatus(
        {
          running: true,
          working: true,
        },
        { sessionActive: true }
      )
    ).toBeUndefined()

    expect(
      toStoredAgentStatus(
        {
          running: true,
          working: false,
          needsAttention: true,
        },
        { sessionActive: true }
      )
    ).toBeUndefined()
  })

  test("persists all agent status markers only while the terminal session is active", () => {
    const status = {
      running: true,
      working: false,
      completed: true,
      completedAt: 200,
      needsAttention: true,
      workStartedAt: 100,
      lastSubmitAt: 150,
    }

    expect(toStoredAgentStatus(status, { sessionActive: true })).toEqual({
      completed: true,
      completedAt: 200,
      workStartedAt: 100,
      lastSubmitAt: 150,
    })

    // Stopped/removed sessions drop the entire status subset (done, timestamps).
    expect(
      toStoredAgentStatus(status, { sessionActive: false })
    ).toBeUndefined()
    expect(toStoredAgentStatus(status)).toBeUndefined()
  })
})
