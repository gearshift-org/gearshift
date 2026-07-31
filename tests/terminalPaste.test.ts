import { describe, expect, test } from "bun:test"
import { prepareAgentPaste } from "../src/lib/terminalPaste"

describe("agent terminal paste", () => {
  test("removes trailing returns so paste cannot submit", () => {
    expect(prepareAgentPaste("pasted text\r\n", "<newline>")).toBe(
      "pasted text"
    )
  })

  test("converts internal line breaks to non-submitting enters", () => {
    expect(prepareAgentPaste("first\r\nsecond\nthird", "<newline>")).toBe(
      "first<newline>second<newline>third"
    )
  })
})
