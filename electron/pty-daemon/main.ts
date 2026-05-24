// Standalone daemon entry. Spawned by the Electron main process via
// process.execPath with ELECTRON_RUN_AS_NODE=1 so it runs as plain Node
// using the same V8/ABI node-pty was built against.

import { Server } from "./server"

const DAEMON_VERSION = "1"

function parseArgs(argv: string[]): { socket: string; bufferBytes?: number } {
  let socket: string | undefined
  let bufferBytes: number | undefined
  for (const arg of argv) {
    if (arg.startsWith("--socket=")) socket = arg.slice("--socket=".length)
    else if (arg.startsWith("--buffer-bytes=")) {
      const n = Number.parseInt(arg.slice("--buffer-bytes=".length), 10)
      if (Number.isFinite(n) && n > 0) bufferBytes = n
    }
  }
  if (!socket) throw new Error("--socket=PATH is required")
  return { socket, bufferBytes }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const server = new Server({
    socketPath: args.socket,
    daemonVersion: DAEMON_VERSION,
    bufferCap: args.bufferBytes,
  })
  await server.listen()
  process.stderr.write(
    `[pty-daemon] listening on ${args.socket} (v${DAEMON_VERSION}, pid=${process.pid})\n`,
  )
  const shutdown = async (signal: NodeJS.Signals) => {
    process.stderr.write(`[pty-daemon] ${signal} received, shutting down\n`)
    try {
      await server.close()
    } finally {
      process.exit(0)
    }
  }
  process.on("SIGINT", () => void shutdown("SIGINT"))
  process.on("SIGTERM", () => void shutdown("SIGTERM"))
  process.on("SIGHUP", () => {
    process.stderr.write(`[pty-daemon] SIGHUP ignored (detached)\n`)
  })
}

void main().catch((err) => {
  process.stderr.write(
    `[pty-daemon] failed to start: ${(err as Error).stack ?? err}\n`,
  )
  process.exit(1)
})
