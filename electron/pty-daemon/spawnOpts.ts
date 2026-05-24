import * as os from "os"

export interface BuildOptions {
  cwd?: string
  cols?: number
  rows?: number
  theme?: "light" | "dark"
}

export interface ResolvedOpenOptions {
  shell: string
  args: string[]
  cwd: string
  cols: number
  rows: number
  env: Record<string, string>
}

function defaultShell(): string {
  if (process.platform === "win32") {
    return process.env.COMSPEC ?? "powershell.exe"
  }
  return process.env.SHELL ?? "/bin/zsh"
}

export function buildOpenOptions(opts: BuildOptions): ResolvedOpenOptions {
  const shell = defaultShell()
  // `-l` makes zsh/bash a login shell so /etc/zprofile and ~/.zprofile run.
  // Critical for packaged .app launches (Finder/Spotlight) where the OS
  // hands us a sparse PATH and Homebrew's PATH setup lives in zprofile.
  const args = process.platform === "win32" ? [] : ["-l"]
  // Claim to be kitty so TUIs trust modern terminal signals (kitty CSI-u keys,
  // theme detection). COLORFGBG seeds light/dark at shell startup; live theme
  // reaction happens via DEC private mode 2031 in the renderer (see TerminalView).
  const colorFgBg = opts.theme === "light" ? "0;15" : "15;0"
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    COLORFGBG: colorFgBg,
    TERM_PROGRAM: "kitty",
  }
  return {
    shell,
    args,
    cwd: opts.cwd ?? os.homedir(),
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    env,
  }
}
