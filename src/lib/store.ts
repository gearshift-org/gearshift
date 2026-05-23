// Sync key/value store backed by a JSON file in Electron's userData (via the
// preload bridge). Falls back to localStorage when no Electron bridge exists
// (pure-web/dev). The renderer hydrates a snapshot once at boot so callers can
// keep using localStorage-style sync getters; writes update the snapshot and
// persist (debounced) through the main process.

export type Store = {
  get: (key: string) => string | null
  set: (key: string, value: string) => void
  remove: (key: string) => void
}

function createStore(): Store {
  const api = typeof window !== "undefined" ? window.stateApi : undefined
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
    }
  }

  const cache: Record<string, string> = { ...api.readSync() }

  let writeTimer: number | undefined
  const persist = () => {
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
  }
}

export const store: Store = createStore()
