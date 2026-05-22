import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { WorkerPoolContextProvider } from "@pierre/diffs/react"

import "@xterm/xterm/css/xterm.css"
import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"

const diffsWorkerPoolOptions = {
  workerFactory: () =>
    new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), {
      type: "module",
    }),
  poolSize: 4,
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkerPoolContextProvider
      poolOptions={diffsWorkerPoolOptions}
      highlighterOptions={{}}
    >
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </WorkerPoolContextProvider>
  </StrictMode>
)
