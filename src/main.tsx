import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "@tanstack/react-router"

import "@xterm/xterm/css/xterm.css"
import "./index.css"
import { router } from "./router"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip"

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
    <ThemeProvider>
      <TooltipProvider delay={200}>
        <RouterProvider router={router} />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
)
