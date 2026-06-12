import * as React from "react"
import { useKeybindings } from "@/lib/keybindings/useKeybindings"
import { ACTIONS, type ActionId } from "@/lib/keybindings/registry"
import { KeyChip } from "@/components/keybindings/KeyChip"
import { KeyCapture } from "@/components/keybindings/KeyCapture"
import { Button } from "@/components/ui/button"

function sameAccelerators(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

export function KeybindingsPanel() {
  const {
    bindings,
    addBinding,
    removeBinding,
    resetBinding,
    resetAll,
    conflicts,
  } = useKeybindings()
  const [editingId, setEditingId] = React.useState<ActionId | null>(null)
  const [pendingPerRow, setPendingPerRow] = React.useState<
    Record<string, string>
  >({})

  const isDefault = (id: ActionId) => {
    const action = ACTIONS.find((a) => a.id === id)
    return action
      ? sameAccelerators([action.defaultAccelerator], bindings[id])
      : false
  }

  const conflictLabel = (id: ActionId): string | null => {
    const labels = new Set<string>()
    for (const acc of bindings[id]) {
      for (const other of conflicts.get(acc) ?? []) {
        if (other === id) continue
        labels.add(ACTIONS.find((a) => a.id === other)?.label ?? other)
      }
    }
    return labels.size > 0 ? [...labels].join(", ") : null
  }

  const candidateConflict = (id: ActionId, acc: string): string | null => {
    if (bindings[id].includes(acc))
      return "This action already uses that shortcut"
    const collisions = ACTIONS.filter(
      (a) => a.id !== id && bindings[a.id].includes(acc)
    )
    if (collisions.length === 0) return null
    return collisions.map((a) => a.label).join(", ")
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Keybindings</h2>
          <p className="text-sm text-muted-foreground">
            Customize global shortcuts. Press Cmd/Ctrl + a key to capture.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={resetAll}>
          Reset all to defaults
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left text-xs text-muted-foreground uppercase">
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Shortcuts</th>
              <th className="px-3 py-2 text-right font-medium">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {ACTIONS.map((action) => {
              const editing = editingId === action.id
              const conflict = conflictLabel(action.id)
              const pending = pendingPerRow[action.id]
              const pendingConflict = pending
                ? candidateConflict(action.id, pending)
                : null
              return (
                <tr
                  key={action.id}
                  className="border-t border-border align-middle"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground">
                      {action.label}
                    </div>
                    {conflict ? (
                      <div className="mt-0.5 text-xs text-destructive">
                        Conflicts with: {conflict}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {bindings[action.id].map((accelerator) => (
                          <span
                            key={accelerator}
                            className="inline-flex items-center gap-1"
                          >
                            <KeyChip accelerator={accelerator} />
                            <button
                              type="button"
                              onClick={() =>
                                removeBinding(action.id, accelerator)
                              }
                              className="rounded px-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                              aria-label={`Remove ${accelerator}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                      {editing ? (
                        <div className="flex flex-col gap-1">
                          <KeyCapture
                            modifiersOnly={action.modifiersOnly}
                            onCancel={() => {
                              setEditingId(null)
                              setPendingPerRow((p) => {
                                const rest = { ...p }
                                delete rest[action.id]
                                return rest
                              })
                            }}
                            onCommit={(acc) => {
                              const conflictWith = candidateConflict(
                                action.id,
                                acc
                              )
                              if (conflictWith) {
                                setPendingPerRow((p) => ({
                                  ...p,
                                  [action.id]: acc,
                                }))
                                return
                              }
                              addBinding(action.id, acc)
                              setEditingId(null)
                              setPendingPerRow((p) => {
                                const rest = { ...p }
                                delete rest[action.id]
                                return rest
                              })
                            }}
                          />
                          {pendingConflict ? (
                            <div className="text-xs text-destructive">
                              Cannot save — conflicts with: {pendingConflict}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-2">
                      {!editing ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingId(action.id)}
                        >
                          Add shortcut
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => resetBinding(action.id)}
                        disabled={isDefault(action.id)}
                      >
                        Reset
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
