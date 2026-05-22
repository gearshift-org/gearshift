import { ScrollArea } from "@/components/ui/scroll-area"
import type { TerminalTab } from "./types"

type Props = {
  terminal: TerminalTab | undefined
}

const MOCK_LINES = [
  "$ git status",
  "On branch main",
  "Your branch is up to date with 'origin/main'.",
  "",
  "Changes not staged for commit:",
  "  modified:   src/App.tsx",
  "  modified:   electron/main.ts",
  "",
]

export function TerminalPane({ terminal }: Props) {
  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex h-10 items-center border-b border-border px-4 text-xs text-muted-foreground">
        {terminal?.name ?? "No terminal"}
      </div>
      <ScrollArea className="flex-1">
        <pre className="px-4 py-3 font-mono text-xs leading-relaxed text-foreground/90">
          {MOCK_LINES.join("\n")}
          <span className="inline-block h-3.5 w-2 translate-y-0.5 animate-pulse bg-foreground/70" />
        </pre>
      </ScrollArea>
    </div>
  )
}
