import { describe, expect, test } from "bun:test"
import { tabIdAfterClose } from "../src/lib/tabNavigation"
import type { WorkspaceTab } from "../src/components/layout/types"

const terminal = (id: string): WorkspaceTab => ({
  kind: "terminal",
  id,
  name: id,
  panes: [{ id: `${id}-pane` }],
  activePaneId: `${id}-pane`,
})

const filePreview = (id: string): WorkspaceTab => ({
  kind: "file",
  id,
  name: "README.md",
  path: "README.md",
  preview: true,
})

const diffPreview = (id: string): WorkspaceTab => ({
  kind: "diff",
  id,
  name: "README.md",
  path: "README.md",
  staged: false,
  preview: true,
})

describe("tab close navigation", () => {
  test.each([filePreview("file"), diffPreview("diff")])(
    "returns from a $kind preview to the last active terminal",
    (preview) => {
      const tabs = [terminal("first"), terminal("last-used"), preview]

      expect(tabIdAfterClose(tabs, preview.id, preview.id, "last-used")).toBe(
        "last-used"
      )
    }
  )

  test("falls back to the neighboring tab when the remembered terminal is gone", () => {
    const tabs = [terminal("remaining"), filePreview("file")]

    expect(tabIdAfterClose(tabs, "file", "file", "closed-terminal")).toBe(
      "remaining"
    )
  })

  test("keeps the active tab when closing a background tab", () => {
    const tabs = [terminal("active"), filePreview("file")]

    expect(tabIdAfterClose(tabs, "active", "file", "active")).toBe("active")
  })
})
