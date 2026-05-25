import * as React from "react"
import { X, Keyboard, Palette, SlidersHorizontal } from "lucide-react"
import { router } from "@/router"
import { cn } from "@/lib/utils"
import { KeybindingsPanel } from "./KeybindingsPanel"
import { AppearancePanel } from "./AppearancePanel"
import { GeneralPanel } from "./GeneralPanel"

type Section = "general" | "keybindings" | "appearance"

const SECTIONS: {
  id: Section
  label: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "keybindings", label: "Keybindings", icon: Keyboard },
  { id: "appearance", label: "Appearance", icon: Palette },
]

export function SettingsRoute() {
  const [section, setSection] = React.useState<Section>("general")

  const close = React.useCallback(() => {
    const idx = router.history.length
    if (idx > 1) router.history.back()
    else void router.navigate({ to: "/" })
  }, [])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const el = e.target as HTMLElement | null
        if (el?.dataset?.keycapture === "true") return
        e.preventDefault()
        close()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [close])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground">
      <div className="flex h-[34px] shrink-0 items-center border-b border-border bg-background [-webkit-app-region:drag]">
        <div className="w-[88px] shrink-0" />
        <h1 className="text-sm font-semibold text-foreground">Settings</h1>
        <div className="flex-1" />
        <div className="flex items-center pr-3 [-webkit-app-region:no-drag]">
          <button
            type="button"
            onClick={close}
            aria-label="Close settings"
            className="grid size-6 place-items-center rounded-sm text-foreground transition-colors hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-border bg-muted/20 p-3">
          {SECTIONS.map(({ id, label, icon: Icon }) => {
            const active = section === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted",
                  active && "bg-muted font-medium"
                )}
              >
                <Icon className="size-4 text-muted-foreground" />
                {label}
              </button>
            )
          })}
        </aside>
        <main className="min-w-0 flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-3xl">
            {section === "general" ? <GeneralPanel /> : null}
            {section === "keybindings" ? <KeybindingsPanel /> : null}
            {section === "appearance" ? <AppearancePanel /> : null}
          </div>
        </main>
      </div>
    </div>
  )
}
