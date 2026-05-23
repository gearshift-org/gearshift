import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "@tanstack/react-router"
import { QueryClient } from "@tanstack/react-query"
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"

import "@xterm/xterm/css/xterm.css"
import "./index.css"
import { router } from "./router"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip"

// SWR-style caching: keep stale data visible across project switches and
// background-refresh; we use file-watcher events + manual invalidation, so
// disable automatic refetches on focus/reconnect.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // gcTime must be >= persister maxAge so entries survive long enough to
      // be hydrated on next launch.
      gcTime: 24 * 60 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
    },
  },
})

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "gearshift-query-cache-v1",
})

// Mouse back/forward buttons navigate router history.
window.addEventListener("auxclick", (e) => {
  if (e.button === 3) {
    e.preventDefault()
    router.history.back()
  } else if (e.button === 4) {
    e.preventDefault()
    router.history.forward()
  }
})
window.addEventListener("mouseup", (e) => {
  if (e.button === 3 || e.button === 4) e.preventDefault()
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 24 * 60 * 60_000 }}
    >
      <ThemeProvider>
        <TooltipProvider delay={200}>
          <RouterProvider router={router} />
        </TooltipProvider>
      </ThemeProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
)
