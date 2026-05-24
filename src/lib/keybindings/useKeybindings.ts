import * as React from "react"
import { store } from "@/lib/store"
import {
  ACTIONS,
  defaultBindings,
  matchesAccelerator,
  type ActionId,
  type BindingsMap,
} from "./registry"

const STORAGE_KEY = "gearshift.keybindings"
const bus = new EventTarget()
const CHANGE = "change"

type Overrides = Partial<BindingsMap>

function readOverrides(): Overrides {
  const raw = store.get(STORAGE_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Overrides
    if (parsed && typeof parsed === "object") return parsed
  } catch {
    // ignore
  }
  return {}
}

function writeOverrides(overrides: Overrides) {
  store.set(STORAGE_KEY, JSON.stringify(overrides))
  bus.dispatchEvent(new Event(CHANGE))
}

function mergeBindings(overrides: Overrides): BindingsMap {
  const out = defaultBindings()
  for (const a of ACTIONS) {
    const v = overrides[a.id]
    if (v) out[a.id] = v
  }
  return out
}

function pushMenuAccelerators(bindings: BindingsMap) {
  const menuApi = (window as unknown as { menuApi?: { updateAccelerators: (m: Record<string, string>) => Promise<unknown> } }).menuApi
  if (!menuApi) return
  const map: Record<string, string> = {}
  for (const a of ACTIONS) {
    if (a.scope === "electron-menu") map[a.id] = bindings[a.id]
  }
  void menuApi.updateAccelerators(map)
}

export function useKeybindings() {
  const [overrides, setOverrides] = React.useState<Overrides>(() => readOverrides())

  // Re-sync once store hydrates from disk.
  React.useEffect(() => {
    const off = store.onReady(() => {
      setOverrides(readOverrides())
    })
    return off
  }, [])

  // Cross-instance sync within renderer.
  React.useEffect(() => {
    const onChange = () => setOverrides(readOverrides())
    bus.addEventListener(CHANGE, onChange)
    return () => bus.removeEventListener(CHANGE, onChange)
  }, [])

  const bindings = React.useMemo(() => mergeBindings(overrides), [overrides])

  const setBinding = React.useCallback((id: ActionId, acc: string) => {
    const next = { ...readOverrides(), [id]: acc }
    writeOverrides(next)
    const action = ACTIONS.find((a) => a.id === id)
    if (action?.scope === "electron-menu") {
      pushMenuAccelerators(mergeBindings(next))
    }
  }, [])

  const resetBinding = React.useCallback((id: ActionId) => {
    const cur = readOverrides()
    if (!(id in cur)) return
    delete cur[id]
    writeOverrides(cur)
    const action = ACTIONS.find((a) => a.id === id)
    if (action?.scope === "electron-menu") {
      pushMenuAccelerators(mergeBindings(cur))
    }
  }, [])

  const resetAll = React.useCallback(() => {
    writeOverrides({})
    pushMenuAccelerators(defaultBindings())
  }, [])

  const findActionForEvent = React.useCallback(
    (e: KeyboardEvent): ActionId | null => {
      for (const a of ACTIONS) {
        if (matchesAccelerator(bindings[a.id], e)) return a.id
      }
      return null
    },
    [bindings],
  )

  const conflicts = React.useMemo(() => {
    const map = new Map<string, ActionId[]>()
    for (const a of ACTIONS) {
      const key = bindings[a.id]
      const arr = map.get(key) ?? []
      arr.push(a.id)
      map.set(key, arr)
    }
    // Keep only entries with > 1
    for (const [k, v] of map) {
      if (v.length < 2) map.delete(k)
    }
    return map
  }, [bindings])

  // On first mount, push current menu-scope accelerators to main so persisted
  // overrides survive relaunch.
  const pushedRef = React.useRef(false)
  React.useEffect(() => {
    if (pushedRef.current) return
    if (!store.isReady()) return
    pushedRef.current = true
    pushMenuAccelerators(bindings)
  }, [bindings])

  return {
    bindings,
    setBinding,
    resetBinding,
    resetAll,
    findActionForEvent,
    conflicts,
  }
}
