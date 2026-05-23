import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import electron from "vite-plugin-electron/simple"

export default defineConfig({
  // Pinned so the renderer's localStorage origin stays stable across `bun dev`
  // restarts — Vite would otherwise drift to 5174+ if the prior port hadn't
  // freed, and projects (stored per-origin) would appear to vanish.
  server: { port: 5173, strictPort: true },
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            rollupOptions: {
              external: ["node-pty", "electron", "@parcel/watcher"],
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, "electron/preload.ts"),
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
