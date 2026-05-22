import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

type Status = "M" | "A" | "D"

const MOCK_CHANGES: { path: string; status: Status }[] = [
  { path: "src/App.tsx", status: "M" },
  { path: "src/components/layout/AppShell.tsx", status: "A" },
  { path: "src/components/layout/TitleBar.tsx", status: "A" },
  { path: "electron/main.ts", status: "M" },
  { path: "package.json", status: "M" },
  { path: "old/legacy-thing.ts", status: "D" },
]

const MOCK_FILES = [
  "electron/",
  "  main.ts",
  "  preload.ts",
  "src/",
  "  App.tsx",
  "  main.tsx",
  "  components/",
  "    layout/",
  "      AppShell.tsx",
  "      TitleBar.tsx",
  "    ui/",
  "      button.tsx",
  "      tabs.tsx",
  "package.json",
  "vite.config.ts",
]

const STATUS_STYLES: Record<Status, string> = {
  M: "text-amber-500",
  A: "text-emerald-500",
  D: "text-red-500",
}

export function ChangesPane() {
  return (
    <div className="flex h-full flex-col bg-card">
      <Tabs defaultValue="changes" className="flex flex-1 flex-col gap-0">
        <div className="flex h-10 items-center border-b border-border px-3">
          <TabsList className="h-7">
            <TabsTrigger value="changes" className="text-xs">
              Changes
            </TabsTrigger>
            <TabsTrigger value="files" className="text-xs">
              Files
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="changes" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <ul className="divide-y divide-border/60">
              {MOCK_CHANGES.map((c) => (
                <li
                  key={c.path}
                  className="flex items-center gap-3 px-4 py-2 text-xs hover:bg-accent/40"
                >
                  <span
                    className={cn(
                      "w-4 text-center font-mono font-medium",
                      STATUS_STYLES[c.status],
                    )}
                  >
                    {c.status}
                  </span>
                  <span className="font-mono">{c.path}</span>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="files" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <pre className="px-4 py-3 font-mono text-xs leading-relaxed">
              {MOCK_FILES.join("\n")}
            </pre>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  )
}
