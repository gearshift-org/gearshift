import { describe, expect, test } from "bun:test"
import { supportedAgentName } from "../electron/supportedAgentName"

describe("supportedAgentName", () => {
  test("detects grok from bare command", () => {
    expect(supportedAgentName("grok")).toBe("grok")
  })

  test("detects grok from install path", () => {
    expect(
      supportedAgentName(
        "/Users/me/.grok/bin/grok --always-approve"
      )
    ).toBe("grok")
  })

  test("detects existing agents unchanged", () => {
    expect(supportedAgentName("claude --resume abc")).toBe("claude")
    expect(supportedAgentName("codex resume abc")).toBe("codex")
    expect(supportedAgentName("opencode --session abc")).toBe("opencode")
    expect(supportedAgentName("pi --session abc")).toBe("pi")
  })

  test("returns undefined for plain shells", () => {
    expect(supportedAgentName("/bin/zsh -il")).toBeUndefined()
    expect(supportedAgentName("node server.js")).toBeUndefined()
  })
})