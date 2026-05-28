import * as React from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { THEMES, type ThemeId, useTheme } from "@/components/theme-provider"
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

const THEME_IDS = Object.keys(THEMES) as ThemeId[]
const LIGHT_THEMES = THEME_IDS.filter((id) => THEMES[id].appearance === "light")
const DARK_THEMES = THEME_IDS.filter((id) => THEMES[id].appearance === "dark")

// Swatch colors per theme so variants are distinguishable at a glance. Values
// mirror the palettes in index.css.
const SWATCHES: Record<ThemeId, { bg: string; fg: string; accent: string }> = {
  light: { bg: "#f8f8f8", fg: "#403f53", accent: "#d9d9d9" },
  "light-cool": { bg: "#f5f7fa", fg: "#3a4252", accent: "#6b87b3" },
  "light-warm": { bg: "#faf8f4", fg: "#4a4338", accent: "#b89968" },
  "light-rose": { bg: "#faf6f7", fg: "#4a3a40", accent: "#c77b91" },
  "light-forest": { bg: "#f5f8f4", fg: "#384439", accent: "#5b9c63" },
  "light-violet": { bg: "#f8f6fb", fg: "#423a52", accent: "#8b6bc7" },
  "light-atom-one": { bg: "#fafafa", fg: "#383a42", accent: "#4078f2" },
  dark: { bg: "#191919", fg: "#d4d4d4", accent: "#007acc" },
  "dark-cool": { bg: "#171a1f", fg: "#d3d8e0", accent: "#4c8fd6" },
  "dark-warm": { bg: "#1c1a18", fg: "#d9d2c7", accent: "#c79a5b" },
  "dark-rose": { bg: "#1f1a1c", fg: "#e0d2d6", accent: "#d6849b" },
  "dark-forest": { bg: "#171a17", fg: "#d2dbd0", accent: "#6cc777" },
  "dark-violet": { bg: "#1b1820", fg: "#d8d2e0", accent: "#a98fd6" },
  "dark-atom-one": { bg: "#282c34", fg: "#abb2bf", accent: "#61afef" },
}

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

function ThemeGroup({
  label,
  icon: Icon,
  ids,
  active,
  onSelect,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  ids: ThemeId[]
  active: string
  onSelect: (id: ThemeId) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {ids.map((id) => {
          const isActive = active === id
          const swatch = SWATCHES[id]
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              aria-pressed={isActive}
              className={cn(
                "flex flex-col gap-3 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive && "border-ring bg-muted/60 ring-2 ring-ring/40",
              )}
            >
              <span
                className="flex h-10 items-center gap-1.5 rounded-md border border-border/60 px-2"
                style={{ backgroundColor: swatch.bg }}
              >
                <span
                  className="h-4 w-4 rounded-full"
                  style={{ backgroundColor: swatch.accent }}
                />
                <span
                  className="h-1.5 flex-1 rounded-full"
                  style={{ backgroundColor: swatch.fg, opacity: 0.5 }}
                />
              </span>
              <span className="text-sm font-medium text-foreground">
                {THEMES[id].label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
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
      <button
        type="button"
        onClick={() => setTheme("system")}
        aria-pressed={theme === "system"}
        className={cn(
          "flex items-center gap-3 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          theme === "system" && "border-ring bg-muted/60 ring-2 ring-ring/40",
        )}
      >
        <Monitor className="size-5 text-foreground" />
        <div>
          <span className="block text-sm font-medium text-foreground">System</span>
          <span className="text-xs text-muted-foreground">
            Match your operating system appearance.
          </span>
        </div>
      </button>

      <ThemeGroup
        label="Light"
        icon={Sun}
        ids={LIGHT_THEMES}
        active={theme}
        onSelect={setTheme}
      />
      <ThemeGroup
        label="Dark"
        icon={Moon}
        ids={DARK_THEMES}
        active={theme}
        onSelect={setTheme}
      />
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
                onValueChange={(family) => {
                  if (family) setFontFamily(fontStack(family))
                }}
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
