import * as React from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  DEFAULT_TERMINAL_FONT_SIZE,
  clampFontSize,
  useTerminalAppearance,
} from "@/lib/terminalAppearance"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"

type Choice = "light" | "dark" | "system"

const CHOICES: { value: Choice; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
]

const COMMON_TERMINAL_FONTS = [
  "SF Mono",
  "Menlo",
  "Monaco",
  "Cascadia Code",
  "Fira Code",
  "JetBrains Mono",
  "Source Code Pro",
  "Roboto Mono",
  "Consolas",
]

type LocalFontData = {
  family: string
}

function fontStack(family: string): string {
  const escaped = family.replace(/"/g, "\\\"")
  return `"${escaped}", monospace`
}

function selectedFontFamily(fontFamily: string, choices: string[]): string | undefined {
  return choices.find(
    (choice) => fontFamily === choice || fontFamily === fontStack(choice),
  )
}

function useLocalFontFamilies() {
  const [families, setFamilies] = React.useState<string[]>([])
  const [available, setAvailable] = React.useState(false)

  React.useEffect(() => {
    const queryLocalFonts = (window as Window & {
      queryLocalFonts?: () => Promise<LocalFontData[]>
    }).queryLocalFonts
    if (!queryLocalFonts) return

    setAvailable(true)
    let cancelled = false
    queryLocalFonts()
      .then((fonts) => {
        if (cancelled) return
        const next = Array.from(
          new Set(fonts.map((font) => font.family).filter(Boolean)),
        ).sort((a, b) => a.localeCompare(b))
        setFamilies(next)
      })
      .catch(() => setFamilies([]))

    return () => {
      cancelled = true
    }
  }, [])

  return { available, families }
}

export function AppearancePanel() {
  const { theme, setTheme } = useTheme()
  const {
    appearance,
    setFontFamily,
    setFontSize,
    resetFontFamily,
    resetFontSize,
  } = useTerminalAppearance()
  const { available: localFontsAvailable, families: localFontFamilies } =
    useLocalFontFamilies()
  const fontChoices = React.useMemo(
    () =>
      Array.from(new Set([...COMMON_TERMINAL_FONTS, ...localFontFamilies])).sort(
        (a, b) => a.localeCompare(b),
      ),
    [localFontFamilies],
  )
  const selectedFont = selectedFontFamily(appearance.fontFamily, fontChoices)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Appearance</h2>
        <p className="text-sm text-muted-foreground">
          Choose how GearShift looks. System matches your operating system.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {CHOICES.map(({ value, label, icon: Icon }) => {
          const active = theme === value
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              aria-pressed={active}
              className={cn(
                "flex flex-col items-start gap-2 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active && "border-ring bg-muted/60 ring-2 ring-ring/40",
              )}
            >
              <Icon className="size-5 text-foreground" />
              <span className="text-sm font-medium text-foreground">{label}</span>
            </button>
          )
        })}
      </div>
      <div className="mt-2 rounded-lg border border-border bg-background">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Terminal</h3>
          <p className="text-xs text-muted-foreground">
            Customize the integrated terminal font, similar to VS Code.
          </p>
        </div>
        <div className="flex flex-col gap-4 p-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-foreground">
              Font family
            </span>
            <div className="flex gap-2">
              <input
                value={appearance.fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                placeholder={DEFAULT_TERMINAL_FONT_FAMILY}
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <Combobox
                items={fontChoices}
                value={selectedFont}
                onValueChange={(family) => setFontFamily(fontStack(family))}
                autoHighlight
              >
                <ComboboxInput
                  placeholder={localFontsAvailable ? "Search fonts" : "Common fonts"}
                  className="w-48"
                />
                <ComboboxContent>
                  <ComboboxEmpty>No fonts found.</ComboboxEmpty>
                  <ComboboxList>
                    {(family) => (
                      <ComboboxItem key={family} value={family}>
                        {family}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetFontFamily}
                disabled={appearance.fontFamily === DEFAULT_TERMINAL_FONT_FAMILY}
              >
                Reset
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">
              Type a custom CSS font stack, or pick an installed/common font.
            </span>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-foreground">
              Font size
            </span>
            <div className="flex gap-2">
              <input
                type="number"
                min={8}
                max={32}
                step={1}
                value={appearance.fontSize}
                onChange={(e) => setFontSize(clampFontSize(e.target.valueAsNumber))}
                className="h-8 w-24 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetFontSize}
                disabled={appearance.fontSize === DEFAULT_TERMINAL_FONT_SIZE}
              >
                Reset
              </Button>
            </div>
          </label>
        </div>
      </div>
    </div>
  )
}
