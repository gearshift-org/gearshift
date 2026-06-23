import * as React from "react"
import { Monitor } from "lucide-react"
import { type ThemeId, useTheme } from "@/components/theme-provider"
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
  ComboboxTrigger,
} from "@/components/ui/combobox"

type ThemePair = {
  label: string
  light: ThemeId
  dark: ThemeId
}

const THEME_PAIRS: ThemePair[] = [
  { label: "Default", light: "light", dark: "dark" },
  { label: "Cool", light: "light-cool", dark: "dark-cool" },
  { label: "Warm", light: "light-warm", dark: "dark-warm" },
  { label: "Rosé", light: "light-rose", dark: "dark-rose" },
  { label: "Forest", light: "light-forest", dark: "dark-forest" },
  { label: "Violet", light: "light-violet", dark: "dark-violet" },
  { label: "Atom One", light: "light-atom-one", dark: "dark-atom-one" },
  {
    label: "Atom One Dark",
    light: "light-atom-one-light",
    dark: "dark-atom-one-dark",
  },
  {
    label: "Nebula Pandas",
    light: "light-nebula-pandas",
    dark: "dark-nebula-pandas",
  },
  { label: "Night Owl", light: "light-night-owl", dark: "dark-night-owl" },
  { label: "Palenight", light: "light-palenight", dark: "dark-palenight" },
  {
    label: "Material Color",
    light: "light-material-color",
    dark: "dark-material-color",
  },
  {
    label: "Monokai Pro",
    light: "light-monokai-pro",
    dark: "dark-monokai-pro",
  },
  { label: "Claude", light: "light-claude", dark: "dark-claude" },
]

const THEME_OPTIONS = THEME_PAIRS.flatMap((pair) => [
  {
    id: pair.light,
    label: pair.label,
    appearance: "Light",
    value: `${pair.label} Light`,
  },
  {
    id: pair.dark,
    label: pair.label,
    appearance: "Dark",
    value: `${pair.label} Dark`,
  },
] satisfies Array<{
  id: ThemeId
  label: string
  appearance: string
  value: string
}>)
const THEME_OPTION_VALUES = THEME_OPTIONS.map((option) => option.value)

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
  "light-atom-one-light": { bg: "#fafafa", fg: "#383a42", accent: "#526fff" },
  "light-nebula-pandas": { bg: "#f8f6ff", fg: "#27273a", accent: "#6bc75f" },
  "light-night-owl": { bg: "#fbfbfb", fg: "#403f53", accent: "#2aa298" },
  "light-palenight": { bg: "#f7f7fb", fg: "#2f3354", accent: "#7e57c2" },
  "light-material-color": { bg: "#fafafa", fg: "#2e3235", accent: "#3b78e7" },
  "light-monokai-pro": { bg: "#faf4f2", fg: "#29242a", accent: "#1c8ca8" },
  "light-claude": { bg: "#faf9f5", fg: "#3d3d3a", accent: "#d97757" },
  dark: { bg: "#191919", fg: "#d4d4d4", accent: "#007acc" },
  "dark-cool": { bg: "#171a1f", fg: "#d3d8e0", accent: "#4c8fd6" },
  "dark-warm": { bg: "#1c1a18", fg: "#d9d2c7", accent: "#c79a5b" },
  "dark-rose": { bg: "#1f1a1c", fg: "#e0d2d6", accent: "#d6849b" },
  "dark-forest": { bg: "#171a17", fg: "#d2dbd0", accent: "#6cc777" },
  "dark-violet": { bg: "#1b1820", fg: "#d8d2e0", accent: "#a98fd6" },
  "dark-atom-one": { bg: "#282c34", fg: "#abb2bf", accent: "#61afef" },
  "dark-atom-one-dark": { bg: "#282c34", fg: "#abb2bf", accent: "#528bff" },
  "dark-nebula-pandas": { bg: "#27273a", fg: "#fcf6ff", accent: "#97ee91" },
  "dark-night-owl": { bg: "#011627", fg: "#d6deeb", accent: "#80a4c2" },
  "dark-palenight": { bg: "#292d3e", fg: "#bfc7d5", accent: "#7e57c2" },
  "dark-material-color": { bg: "#212121", fg: "#eeffff", accent: "#82aaff" },
  "dark-monokai-pro": { bg: "#2d2a2e", fg: "#fcfcfa", accent: "#78dce8" },
  "dark-claude": { bg: "#262624", fg: "#c2c0b6", accent: "#d97757" },
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
  const queryLocalFonts = (window as Window & {
    queryLocalFonts?: () => Promise<LocalFontData[]>
  }).queryLocalFonts
  const available = !!queryLocalFonts

  React.useEffect(() => {
    if (!queryLocalFonts) return

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
  }, [queryLocalFonts])

  return { available, families }
}

function ThemePreviewTile({ id }: { id: ThemeId }) {
  const swatch = SWATCHES[id]

  return (
    <span
      className="grid size-6 shrink-0 place-items-center rounded-md border border-border/60 text-[11px] font-semibold"
      style={{ backgroundColor: swatch.bg, color: swatch.accent }}
    >
      Aa
    </span>
  )
}

function ThemeOptionLabel({
  option,
  className,
}: {
  option: (typeof THEME_OPTIONS)[number]
  className?: string
}) {
  return (
    <span className={cn("min-w-0 truncate", className)}>
      {option.label}
      <span className="text-muted-foreground"> {option.appearance}</span>
    </span>
  )
}

function ThemeDropdowns({
  active,
  onSelect,
}: {
  active: string
  onSelect: (id: ThemeId) => void
}) {
  const activeTheme = THEME_OPTIONS.find((option) => option.id === active)
  const selectedTheme = activeTheme ?? THEME_OPTIONS[0]
  const selectTheme = (value: string | null) => {
    const option = THEME_OPTIONS.find((item) => item.value === value)
    if (option) onSelect(option.id)
  }

  return (
    <div className="grid gap-1.5">
      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-foreground">Theme</span>
        <Combobox
          items={THEME_OPTION_VALUES}
          value={selectedTheme.value}
          onValueChange={selectTheme}
          autoHighlight
        >
          <ComboboxTrigger
            aria-label="Theme"
            className="flex h-8 w-full min-w-0 items-center gap-2 rounded-[var(--radius-input)] border border-border bg-background px-2.5 text-sm text-foreground outline-none transition-colors hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&>svg:last-child]:ml-auto"
          >
            <ThemePreviewTile id={selectedTheme.id} />
            <ThemeOptionLabel option={selectedTheme} className="flex-none" />
          </ComboboxTrigger>
          <ComboboxContent align="start" className="p-0">
            <div className="border-b border-border/60 p-2">
              <ComboboxInput
                showTrigger={false}
                placeholder="Filter themes..."
                className="h-7 w-full text-xs"
              />
            </div>
            <ComboboxEmpty>No themes found.</ComboboxEmpty>
            <ComboboxList>
              {(value) => {
                const option = THEME_OPTIONS.find((item) => item.value === value)
                if (!option) return null
                return (
                  <ComboboxItem key={option.id} value={value}>
                    <ThemePreviewTile id={option.id} />
                    <ThemeOptionLabel option={option} />
                  </ComboboxItem>
                )
              }}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </label>
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

      <ThemeDropdowns active={theme} onSelect={setTheme} />
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
