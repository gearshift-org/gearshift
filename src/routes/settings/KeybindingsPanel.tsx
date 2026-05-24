import * as React from "react"
import { useKeybindings } from "@/lib/keybindings/useKeybindings"
import { ACTIONS, type ActionId } from "@/lib/keybindings/registry"
import { KeyChip } from "@/components/keybindings/KeyChip"
import { KeyCapture } from "@/components/keybindings/KeyCapture"
import { Button } from "@/components/ui/button"

export function KeybindingsPanel() {
  const { bindings, setBinding, resetBinding, resetAll, conflicts } =
    useKeybindings()
  const [editingId, setEditingId] = React.useState<ActionId | null>(null)
  const [pendingPerRow, setPendingPerRow] = React.useState<Record<string, string>>({})

  const isDefault = (id: ActionId) => {
    const action = ACTIONS.find((a) => a.id === id)
    return action?.defaultAccelerator === bindings[id]
  }

  const conflictLabel = (id: ActionId): string | null => {
    const acc = bindings[id]
    const others = (conflicts.get(acc) ?? []).filter((x) => x !== id)
    if (others.length === 0) return null
    return others
      .map((oid) => ACTIONS.find((a) => a.id === oid)?.label ?? oid)
      .join(", ")
  }

  const candidateConflict = (id: ActionId, acc: string): string | null => {
    const collisions = ACTIONS.filter(
      (a) => a.id !== id && bindings[a.id] === acc,
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
            <tr className="text-left text-xs uppercase text-muted-foreground">
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Shortcut</th>
              <th className="px-3 py-2 font-medium text-right">&nbsp;</th>
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
                    {editing ? (
                      <div className="flex flex-col gap-1">
                        <KeyCapture
                          initial={bindings[action.id]}
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
                              acc,
                            )
                            if (conflictWith) {
                              setPendingPerRow((p) => ({
                                ...p,
                                [action.id]: acc,
                              }))
                              return
                            }
                            setBinding(action.id, acc)
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
                    ) : (
                      <KeyChip accelerator={bindings[action.id]} />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-2">
                      {!editing ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingId(action.id)}
                        >
                          Edit
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
