import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"

const CLI_NAME = "gearshift"

async function isWritableDir(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dir)
    if (!stat.isDirectory()) return false
    await fs.access(dir, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function shimContent(target: string, appVersion: string): string {
  return `#!/bin/sh
# Installed by GearShift ${appVersion}
exec ${shellQuote(target)} "$@"
`
}

async function writeShim(linkPath: string, target: string, appVersion: string) {
  const next = shimContent(target, appVersion)
  try {
    const stat = await fs.lstat(linkPath)
    if (stat.isSymbolicLink()) {
      await fs.unlink(linkPath)
    } else {
      const current = await fs.readFile(linkPath, "utf8")
      if (current === next) return false
    }
  } catch {
    // Missing or unreadable: overwrite below when possible.
  }
  await fs.writeFile(linkPath, next, "utf8")
  await fs.chmod(linkPath, 0o755)
  return true
}

export async function ensureCliInstalled(opts: {
  appVersion: string
  isPackaged: boolean
  resourcesPath: string
  mainDir: string
}): Promise<{ ok: boolean; path?: string; updated?: boolean; error?: string }> {
  if (process.platform !== "darwin") return { ok: false, error: "unsupported-platform" }

  const target = opts.isPackaged
    ? path.join(opts.resourcesPath, "bin", CLI_NAME)
    : path.resolve(opts.mainDir, "../bin", CLI_NAME)

  try {
    await fs.access(target, fs.constants.X_OK)
  } catch {
    return { ok: false, error: `cli target not executable: ${target}` }
  }

  const preferredGlobalDirs = ["/opt/homebrew/bin", "/usr/local/bin"]
  const writableGlobal = await Promise.all(preferredGlobalDirs.map(isWritableDir))
  const globalDir = preferredGlobalDirs.find((_, index) => writableGlobal[index])
  const installDir = globalDir ?? path.join(os.homedir(), ".local", "bin")

  try {
    await fs.mkdir(installDir, { recursive: true })
    const cliPath = path.join(installDir, CLI_NAME)
    const updated = await writeShim(cliPath, target, opts.appVersion)
    return { ok: true, path: cliPath, updated }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
