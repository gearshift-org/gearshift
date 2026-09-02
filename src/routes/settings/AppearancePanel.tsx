import * as React from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import {
  THEME_FAMILIES,
  type ThemeFamilyId,
  type ThemeId,
  type ThemeMode,
  useTheme,
} from "@/components/theme-provider"
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

const THEME_OPTION_VALUES = THEME_FAMILIES.map((family) => family.id)
const MODE_OPTIONS = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] satisfies Array<{ value: ThemeMode; label: string; icon: typeof Monitor }>

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
  "light-coffee": { bg: "#f4f1f0", fg: "#36221d", accent: "#d3694c" },
  "light-cursor": { bg: "#ffffff", fg: "#1f1f1f", accent: "#2f6fed" },
  dark: { bg: "#191919", fg: "#b2b2b2", accent: "#007acc" },
  "dark-cool": { bg: "#171a1f", fg: "#b1b6bd", accent: "#4c8fd6" },
  "dark-warm": { bg: "#1c1a18", fg: "#b7b1a7", accent: "#c79a5b" },
  "dark-rose": { bg: "#1f1a1c", fg: "#bdb1b5", accent: "#d6849b" },
  "dark-forest": { bg: "#171a17", fg: "#b0b8af", accent: "#6cc777" },
  "dark-violet": { bg: "#1b1820", fg: "#b6b1bd", accent: "#a98fd6" },
  "dark-atom-one": { bg: "#282c34", fg: "#939aa6", accent: "#61afef" },
  "dark-atom-one-dark": { bg: "#282c34", fg: "#939aa6", accent: "#528bff" },
  "dark-nebula-pandas": { bg: "#27273a", fg: "#d6d1dc", accent: "#97ee91" },
  "dark-night-owl": { bg: "#011627", fg: "#b0bac8", accent: "#80a4c2" },
  "dark-palenight": { bg: "#292d3e", fg: "#a4abba", accent: "#7e57c2" },
  "dark-material-color": { bg: "#212121", fg: "#c9d7d7", accent: "#82aaff" },
  "dark-monokai-pro": { bg: "#2d2a2e", fg: "#d7d6d5", accent: "#78dce8" },
  "dark-claude": { bg: "#262624", fg: "#a6a49c", accent: "#d97757" },
  "dark-coffee": { bg: "#292423", fg: "#ceb5b0", accent: "#f09177" },
  "dark-cursor": { bg: "#181818", fg: "#cccccc", accent: "#3b82f6" },
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
  const escaped = family.replace(/"/g, '\\"')
  return `"${escaped}", monospace`
}

function selectedFontFamily(
  fontFamily: string,
  choices: string[]
): string | undefined {
  return choices.find(
    (choice) => fontFamily === choice || fontFamily === fontStack(choice)
  )
}

function useLocalFontFamilies() {
  const [families, setFamilies] = React.useState<string[]>([])
  const queryLocalFonts = (
    window as Window & {
      queryLocalFonts?: () => Promise<LocalFontData[]>
    }
  ).queryLocalFonts
  const available = !!queryLocalFonts

  React.useEffect(() => {
    if (!queryLocalFonts) return

    let cancelled = false
    queryLocalFonts()
      .then((fonts) => {
        if (cancelled) return
        const next = Array.from(
          new Set(fonts.map((font) => font.family).filter(Boolean))
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
  label,
  className,
}: {
  label: string
  className?: string
}) {
  return <span className={cn("min-w-0 truncate", className)}>{label}</span>
}

function ThemeDropdowns({
  activeFamily,
  previewAppearance,
  onSelect,
}: {
  activeFamily: ThemeFamilyId
  previewAppearance: "light" | "dark"
  onSelect: (id: ThemeFamilyId) => void
}) {
  const selectedTheme =
    THEME_FAMILIES.find((family) => family.id === activeFamily) ??
    THEME_FAMILIES[0]
  const selectTheme = (value: string | null) => {
    const option = THEME_FAMILIES.find((item) => item.id === value)
    if (option) onSelect(option.id)
  }
  const selectedPreviewId = selectedTheme[previewAppearance]

  return (
    <div className="grid gap-1.5">
      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-foreground">Theme</span>
        <Combobox
          items={THEME_OPTION_VALUES}
          value={selectedTheme.id}
          onValueChange={selectTheme}
          autoHighlight
        >
          <ComboboxTrigger
            aria-label="Theme"
            className="flex h-8 w-full min-w-0 items-center gap-2 rounded-[var(--radius-input)] border border-border bg-background px-2.5 text-sm text-foreground transition-colors outline-none hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&>svg:last-child]:ml-auto"
          >
            <ThemePreviewTile id={selectedPreviewId} />
            <ThemeOptionLabel
              label={selectedTheme.label}
              className="flex-none"
            />
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
                const option = THEME_FAMILIES.find((item) => item.id === value)
                if (!option) return null
                const previewId = option[previewAppearance]
                return (
                  <ComboboxItem key={option.id} value={value}>
                    <ThemePreviewTile id={previewId} />
                    <ThemeOptionLabel label={option.label} />
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
  const { mode, resolvedTheme, setMode, themeFamily, setThemeFamily } =
    useTheme()
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
      Array.from(
        new Set([...COMMON_TERMINAL_FONTS, ...localFontFamilies])
      ).sort((a, b) => a.localeCompare(b)),
    [localFontFamilies]
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
      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-foreground">Mode</span>
        <ToggleGroup
          value={[mode]}
          onValueChange={(values) => {
            const next = values.at(-1)
            if (next) setMode(next as ThemeMode)
          }}
          variant="outline"
          spacing={0}
          className="w-full"
        >
          {MODE_OPTIONS.map((option) => {
            const Icon = option.icon
            return (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                className="flex-1"
              >
                <Icon data-icon="inline-start" />
                {option.label}
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>
      </label>

      <ThemeDropdowns
        activeFamily={themeFamily}
        previewAppearance={resolvedTheme}
        onSelect={setThemeFamily}
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
                  placeholder={
                    localFontsAvailable ? "Search fonts" : "Common fonts"
                  }
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
                disabled={
                  appearance.fontFamily === DEFAULT_TERMINAL_FONT_FAMILY
                }
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
                onChange={(e) =>
                  setFontSize(clampFontSize(e.target.valueAsNumber))
                }
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
