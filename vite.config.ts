import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import electron from "vite-plugin-electron"

export default defineConfig({
  // Pinned so the renderer's localStorage origin stays stable across `bun dev`
  // restarts — Vite would otherwise drift to 5174+ if the prior port hadn't
  // freed, and projects (stored per-origin) would appear to vanish.
  server: { port: 5173, strictPort: true },
  plugins: [
    react(),
    tailwindcss(),
    electron([
      {
        entry: "electron/main.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: [
                "node-pty",
                "electron",
                "electron-updater",
                "electron-log",
                "@parcel/watcher",
                "@libsql/client",
              ],
            },
          },
        },
      },
      {
        entry: "electron/preload.ts",
        onstart({ reload }) {
          // Restart the renderer when the preload changes during dev.
          reload()
        },
        vite: {
          build: {
            outDir: "dist-electron",
            // Force CJS — Electron's sandboxed preload can't load ESM.
            // Without this, the project's "type": "module" makes vite emit
            // ESM by default and the preload fails with "Cannot use import
            // statement outside a module". Use .cjs (not .mjs) so Node and
            // Electron treat the file as CommonJS regardless of the
            // surrounding package.json type.
            lib: {
              entry: "electron/preload.ts",
              formats: ["cjs"],
              fileName: () => "preload.cjs",
            },
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
      {
        // PTY daemon: spawned by the main process via ELECTRON_RUN_AS_NODE,
        // so it must be plain Node-compatible. CJS to side-step the project
        // package.json "type": "module" inheritance — gives a .cjs file
        // Node always treats as CommonJS regardless of nearest package.json.
        entry: "electron/pty-daemon/main.ts",
        vite: {
          build: {
            outDir: "dist-electron/pty-daemon",
            emptyOutDir: true,
            lib: {
              entry: "electron/pty-daemon/main.ts",
              formats: ["cjs"],
              fileName: () => "main.cjs",
            },
            rollupOptions: {
              external: ["node-pty"],
            },
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
