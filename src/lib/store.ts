// Async-hydrated key/value store. Cache starts empty so the UI can paint
// immediately; the JSON snapshot is fetched in parallel via IPC, and
// `onReady` consumers re-sync their state once it lands. Writes update the
// snapshot and persist (debounced, 250ms) through the main process. Falls back to
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

  // Debounced for real. A running agent updates pane titles and agent status
  // repeatedly, and each of those calls saveProjects() -> set(), so an
  // immediate write meant copying the whole snapshot and structured-cloning it
  // across IPC many times a second on the renderer's main thread — the same
  // thread that has to echo the user's keystrokes.
  const PERSIST_DEBOUNCE_MS = 250
  let persistTimer: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    if (persistTimer !== undefined) {
      clearTimeout(persistTimer)
      persistTimer = undefined
    }
    if (!ready) return
    void api.write({ ...cache })
  }

  const persist = () => {
    // Suppress writes until hydration completes — initial useState empties
    // would otherwise clobber the on-disk snapshot.
    if (!ready) return
    if (persistTimer !== undefined) return
    persistTimer = setTimeout(flush, PERSIST_DEBOUNCE_MS)
  }

  // Never lose the trailing write on quit/reload.
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flush)
    window.addEventListener("beforeunload", flush)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush()
    })
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
