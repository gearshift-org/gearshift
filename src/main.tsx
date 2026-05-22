import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "@tanstack/react-router"
import { WorkerPoolContextProvider } from "@pierre/diffs/react"

import "@xterm/xterm/css/xterm.css"
import "./index.css"
import { router } from "./router"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip"

const diffsWorkerPoolOptions = {
  workerFactory: () =>
    new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), {
      type: "module",
    }),
  poolSize: 4,
}

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
    <WorkerPoolContextProvider
      poolOptions={diffsWorkerPoolOptions}
      highlighterOptions={{}}
    >
      <ThemeProvider>
        <TooltipProvider delay={200}>
          <RouterProvider router={router} />
        </TooltipProvider>
      </ThemeProvider>
    </WorkerPoolContextProvider>
  </StrictMode>,
)
