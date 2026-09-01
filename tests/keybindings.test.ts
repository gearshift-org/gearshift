import { describe, expect, test } from "bun:test"
import {
  defaultBindings,
  matchesAccelerator,
} from "../src/lib/keybindings/registry"

function keyEvent(key: string): KeyboardEvent {
  return {
    key,
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
  } as KeyboardEvent
}

describe("terminal split keybindings", () => {
  test("uses command brackets for next and previous split", () => {
    const bindings = defaultBindings()

    expect(bindings["terminal.nextSplit"]).toEqual(["CmdOrCtrl+]"])
    expect(bindings["terminal.previousSplit"]).toEqual(["CmdOrCtrl+["])
    expect(
      matchesAccelerator(bindings["terminal.nextSplit"][0], keyEvent("]"))
    ).toBe(true)
    expect(
      matchesAccelerator(bindings["terminal.previousSplit"][0], keyEvent("["))
    ).toBe(true)
  })
})
