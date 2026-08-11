import { useEffect, useMemo, useRef } from "react"

// Gives a bag of callbacks stable identities across renders.
//
// AppShell passes ~20 handlers down to the workspace, many of them inline
// arrows, so every one of them is a new function on every render — and AppShell
// re-renders constantly while an agent works (pane titles, agent status). That
// alone defeats React.memo on anything below it, which matters once several
// projects are open, since every project's panes stay mounted and would all
// re-render for a change in one of them.
//
// Each returned function forwards to the latest prop. `undefined` is preserved,
// so `!!onSomething` checks downstream still mean "was a handler provided";
// identities only change when that defined-ness flips.
type Handlers = Record<string, ((...args: never[]) => unknown) | undefined>

export function useStableHandlers<T extends Handlers>(handlers: T): T {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })

  const definedKeys = Object.keys(handlers)
    .filter((key) => handlers[key] !== undefined)
    .join(",")

  return useMemo(() => {
    const out = {} as Record<string, unknown>
    for (const key of definedKeys ? definedKeys.split(",") : []) {
      out[key] = (...args: never[]) => latest.current[key]?.(...args)
    }
    return out as T
  }, [definedKeys])
}
