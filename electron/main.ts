import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu } from "electron"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import * as pty from "node-pty"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

const ptys = new Map<string, pty.IPty>()

function defaultShell(): string {
  if (process.platform === "win32") return process.env.COMSPEC || "powershell.exe"
  return process.env.SHELL || "/bin/zsh"
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"))
  }
}

function sendToFocused(channel: string) {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win) return
  win.webContents.send(channel)
}

function buildMenu() {
  const isMac = process.platform === "darwin"
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Terminal",
          accelerator: "CmdOrCtrl+T",
          click: () => sendToFocused("app:new-terminal"),
        },
        {
          label: "Close Terminal",
          accelerator: "CmdOrCtrl+W",
          click: () => sendToFocused("app:close-terminal"),
        },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  buildMenu()

  ipcMain.handle("clipboard:hasImage", () => {
    try {
      return !clipboard.readImage().isEmpty()
    } catch {
      return false
    }
  })

  ipcMain.handle("dialog:openProject", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: "Open Project",
      properties: ["openDirectory", "createDirectory"],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(
    "term:create",
    async (
      event,
      opts: { cwd: string; cols?: number; rows?: number },
    ) => {
      const id = randomUUID()
      const proc = pty.spawn(defaultShell(), [], {
        name: "xterm-color",
        cwd: opts.cwd,
        cols: opts.cols ?? 80,
        rows: opts.rows ?? 24,
        env: process.env as Record<string, string>,
      })
      ptys.set(id, proc)

      const sender = event.sender
      proc.onData((chunk) => {
        if (sender.isDestroyed()) return
        sender.send(`term:data:${id}`, chunk)
      })
      proc.onExit((info) => {
        if (!sender.isDestroyed()) {
          sender.send(`term:exit:${id}`, info)
        }
        ptys.delete(id)
      })

      return { id }
    },
  )

  ipcMain.on("term:write", (_e, id: string, data: string) => {
    ptys.get(id)?.write(data)
  })

  ipcMain.on("term:resize", (_e, id: string, cols: number, rows: number) => {
    try {
      ptys.get(id)?.resize(cols, rows)
    } catch {
      // ignore resize errors on dead PTYs
    }
  })

  ipcMain.on("term:kill", (_e, id: string) => {
    const proc = ptys.get(id)
    if (!proc) return
    try {
      proc.kill()
    } catch {
      // ignore
    }
    ptys.delete(id)
  })

  createWindow()
})

app.on("before-quit", () => {
  for (const proc of ptys.values()) {
    try {
      proc.kill()
    } catch {
      // ignore
    }
  }
  ptys.clear()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
