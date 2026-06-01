#!/usr/bin/env node
import { existsSync } from "node:fs"
import { access, chmod, mkdir, rm, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { join } from "node:path"
import { homedir } from "node:os"

const PRODUCT_NAME = "GearShift"
const APP_NAME = `${PRODUCT_NAME}.app`
const APPLICATIONS_APP = `/Applications/${APP_NAME}`
const APP_ID = "com.gearshift"
const CLI_TARGET = `${APPLICATIONS_APP}/Contents/Resources/bin/gearshift`
const CLI_NAME = "gearshift"

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options,
    })
    child.on("error", reject)
    child.on("exit", (code, signal) => {
      if (code === 0) resolve()
      else {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed${
              signal ? ` (${signal})` : ` with exit code ${code}`
            }`,
          ),
        )
      }
    })
  })
}

async function isWritableDir(dir) {
  try {
    await access(dir)
    await access(dir, 2)
    return true
  } catch {
    return false
  }
}

function shellQuote(value) {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

async function installCli() {
  const preferred = ["/opt/homebrew/bin", "/usr/local/bin"]
  const writable = await Promise.all(preferred.map(isWritableDir))
  const installDir = preferred.find((_, i) => writable[i]) ?? join(homedir(), ".local", "bin")
  await mkdir(installDir, { recursive: true })
  const link = join(installDir, CLI_NAME)

  await chmod(CLI_TARGET, 0o755)
  await rm(link, { force: true })
  await writeFile(link, `#!/bin/sh\nexec ${shellQuote(CLI_TARGET)} "$@"\n`, "utf8")
  await chmod(link, 0o755)

  console.log(`Installed CLI: ${link}`)
  if (installDir.startsWith(homedir())) {
    console.log(`Add ${installDir} to PATH if \`${CLI_NAME}\` is not found.`)
  }
}

async function tryRun(command, args) {
  try {
    await run(command, args, { stdio: "ignore" })
  } catch {
    // Best effort only.
  }
}

function capture(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    })
    let out = ""
    child.stdout.on("data", (chunk) => {
      out += chunk
    })
    child.on("error", () => resolve(""))
    child.on("exit", (code) => resolve(code === 0 ? out.trim() : ""))
  })
}

async function isAppRunning() {
  const pids = await capture("pgrep", ["-x", PRODUCT_NAME])
  return pids.length > 0
}

async function waitForAppExit(timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (!(await isAppRunning())) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return !(await isAppRunning())
}

async function stopRunningApp() {
  if (!(await isAppRunning())) return

  console.log(`Stopping ${PRODUCT_NAME} before installing...`)
  await tryRun("osascript", ["-e", `tell application id "${APP_ID}" to quit`])
  await tryRun("osascript", ["-e", `tell application "${PRODUCT_NAME}" to quit`])

  if (await waitForAppExit(5000)) return

  console.log(`${PRODUCT_NAME} did not quit in time; forcing it to stop...`)
  await tryRun("pkill", ["-x", PRODUCT_NAME])
  if (await waitForAppExit(3000)) return

  await tryRun("pkill", ["-9", "-x", PRODUCT_NAME])
  if (!(await waitForAppExit(3000))) {
    throw new Error(`Could not stop running ${PRODUCT_NAME}. Close it manually and retry.`)
  }
}

function findBuiltApp() {
  const candidates = [
    join(process.cwd(), "release", "mac-arm64", APP_NAME),
    join(process.cwd(), "release", "mac", APP_NAME),
  ]
  return candidates.find((candidate) => existsSync(candidate))
}

async function main() {
  if (process.platform !== "darwin") {
    throw new Error("install:app currently only supports macOS.")
  }

  await stopRunningApp()

  const builtApp = findBuiltApp()
  if (!builtApp) {
    throw new Error(`Could not find built ${APP_NAME} in release/mac-arm64 or release/mac.`)
  }

  console.log(`Installing ${APP_NAME} to /Applications...`)
  await rm(APPLICATIONS_APP, { recursive: true, force: true })
  await run("ditto", [builtApp, APPLICATIONS_APP])

  console.log(`Installed ${APPLICATIONS_APP}`)

  await installCli()
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
