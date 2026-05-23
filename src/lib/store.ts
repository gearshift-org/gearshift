// Async-hydrated key/value store. Cache starts empty so the UI can paint
// immediately; the JSON snapshot is fetched in parallel via IPC, and
// `onReady` consumers re-sync their state once it lands. Writes update the
// snapshot and persist (debounced) through the main process. Falls back to
// localStorage when no Electron bridge is available (pure-web preview).

export type Store = {
  get: (key: string) => string | null
  set: (key: string, value: string) => void
  remove: (key: string) => void
  isReady: () => boolean
  whenReady: () => Promise<void>
  onReady: (cb: () => void) => () => void
}

function createStore(): Store {
  const api = typeof window !== "undefined" ? window.stateApi : undefined

  // Web fallback: localStorage is already sync, so we're "ready" immediately.
  if (!api) {
    return {
      get: (k) => {
        try {
          return localStorage.getItem(k)
        } catch {
          return null
        }
      },
      set: (k, v) => {
        try {
          localStorage.setItem(k, v)
        } catch {
          // ignore
        }
      },
      remove: (k) => {
        try {
          localStorage.removeItem(k)
        } catch {
          // ignore
        }
      },
      isReady: () => true,
      whenReady: () => Promise.resolve(),
      onReady: (cb) => {
        cb()
        return () => {}
      },
    }
  }

  let cache: Record<string, string> = {}
  let ready = false
  const readyCbs = new Set<() => void>()

  const whenReady: Promise<void> = api.read().then(
    (data) => {
      cache = { ...data }
      ready = true
      for (const cb of readyCbs) cb()
      readyCbs.clear()
    },
    () => {
      // Read failed — mark ready anyway so the UI doesn't hang.
      ready = true
      for (const cb of readyCbs) cb()
      readyCbs.clear()
    },
  )

  let writeTimer: number | undefined
  const persist = () => {
    // Suppress writes until hydration completes — initial useState empties
    // would otherwise clobber the on-disk snapshot.
    if (!ready) return
    if (writeTimer) window.clearTimeout(writeTimer)
    writeTimer = window.setTimeout(() => {
      void api.write({ ...cache })
    }, 100)
  }

  return {
    get: (k) => (k in cache ? cache[k] : null),
    set: (k, v) => {
      cache[k] = v
      persist()
    },
    remove: (k) => {
      delete cache[k]
      persist()
    },
    isReady: () => ready,
    whenReady: () => whenReady,
    onReady: (cb) => {
      if (ready) {
        cb()
        return () => {}
      }
      readyCbs.add(cb)
      return () => readyCbs.delete(cb)
    },
  }
}

export const store: Store = createStore()
