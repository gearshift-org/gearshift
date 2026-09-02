/* eslint-disable react-refresh/only-export-components */
import * as React from "react"
import { store } from "@/lib/store"

type ResolvedTheme = "dark" | "light"
export type ThemeMode = "system" | ResolvedTheme

type ThemeDefinition = {
  label: string
  appearance: ResolvedTheme
}

// Registry of concrete theme variants. Appearance settings choose a family
// plus a mode, then resolve to one of these light/dark IDs.
export const THEMES = {
  light: { label: "Default", appearance: "light" },
  "light-cool": { label: "Cool", appearance: "light" },
  "light-warm": { label: "Warm", appearance: "light" },
  "light-rose": { label: "Rosé", appearance: "light" },
  "light-forest": { label: "Forest", appearance: "light" },
  "light-violet": { label: "Violet", appearance: "light" },
  "light-atom-one": { label: "Atom One", appearance: "light" },
  "light-atom-one-light": { label: "Atom One Light", appearance: "light" },
  "light-nebula-pandas": { label: "Nebula Pandas", appearance: "light" },
  "light-night-owl": { label: "Night Owl", appearance: "light" },
  "light-palenight": { label: "Palenight", appearance: "light" },
  "light-material-color": { label: "Material Color", appearance: "light" },
  "light-monokai-pro": { label: "Monokai Pro", appearance: "light" },
  "light-claude": { label: "Claude", appearance: "light" },
  "light-coffee": { label: "Coffee Cream", appearance: "light" },
  "light-cursor": { label: "Cursor", appearance: "light" },
  dark: { label: "Default", appearance: "dark" },
  "dark-cool": { label: "Cool", appearance: "dark" },
  "dark-warm": { label: "Warm", appearance: "dark" },
  "dark-rose": { label: "Rosé", appearance: "dark" },
  "dark-forest": { label: "Forest", appearance: "dark" },
  "dark-violet": { label: "Violet", appearance: "dark" },
  "dark-atom-one": { label: "Atom One", appearance: "dark" },
  "dark-atom-one-dark": { label: "Atom One Dark", appearance: "dark" },
  "dark-nebula-pandas": { label: "Nebula Pandas", appearance: "dark" },
  "dark-night-owl": { label: "Night Owl", appearance: "dark" },
  "dark-palenight": { label: "Palenight", appearance: "dark" },
  "dark-material-color": { label: "Material Color", appearance: "dark" },
  "dark-monokai-pro": { label: "Monokai Pro", appearance: "dark" },
  "dark-claude": { label: "Claude", appearance: "dark" },
  "dark-coffee": { label: "Coffee", appearance: "dark" },
  "dark-cursor": { label: "Cursor", appearance: "dark" },
} as const satisfies Record<string, ThemeDefinition>

export type ThemeId = keyof typeof THEMES
type Theme = ThemeId | "system"

export type ThemeFamily = {
  id: string
  label: string
  light: ThemeId
  dark: ThemeId
}

export const THEME_FAMILIES = [
  { id: "default", label: "Default", light: "light", dark: "dark" },
  { id: "cool", label: "Cool", light: "light-cool", dark: "dark-cool" },
  { id: "warm", label: "Warm", light: "light-warm", dark: "dark-warm" },
  { id: "rose", label: "Rosé", light: "light-rose", dark: "dark-rose" },
  {
    id: "forest",
    label: "Forest",
    light: "light-forest",
    dark: "dark-forest",
  },
  {
    id: "violet",
    label: "Violet",
    light: "light-violet",
    dark: "dark-violet",
  },
  {
    id: "atom-one",
    label: "Atom One",
    light: "light-atom-one",
    dark: "dark-atom-one",
  },
  {
    id: "atom-one-dark",
    label: "Atom One Dark",
    light: "light-atom-one-light",
    dark: "dark-atom-one-dark",
  },
  {
    id: "nebula-pandas",
    label: "Nebula Pandas",
    light: "light-nebula-pandas",
    dark: "dark-nebula-pandas",
  },
  {
    id: "night-owl",
    label: "Night Owl",
    light: "light-night-owl",
    dark: "dark-night-owl",
  },
  {
    id: "palenight",
    label: "Palenight",
    light: "light-palenight",
    dark: "dark-palenight",
  },
  {
    id: "material-color",
    label: "Material Color",
    light: "light-material-color",
    dark: "dark-material-color",
  },
  {
    id: "monokai-pro",
    label: "Monokai Pro",
    light: "light-monokai-pro",
    dark: "dark-monokai-pro",
  },
  {
    id: "claude",
    label: "Claude",
    light: "light-claude",
    dark: "dark-claude",
  },
  {
    id: "coffee",
    label: "Coffee",
    light: "light-coffee",
    dark: "dark-coffee",
  },
  {
    id: "cursor",
    label: "Cursor",
    light: "light-cursor",
    dark: "dark-cursor",
  },
] as const satisfies readonly ThemeFamily[]

export type ThemeFamilyId = (typeof THEME_FAMILIES)[number]["id"]

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
  disableTransitionOnChange?: boolean
}

type ThemeProviderState = {
  mode: ThemeMode
  theme: ThemeId
  themeFamily: ThemeFamilyId
  resolvedTheme: ResolvedTheme
  setMode: (mode: ThemeMode) => void
  setTheme: (theme: Theme) => void
  setThemeFamily: (family: ThemeFamilyId) => void
}

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)"
const THEME_VALUES: Theme[] = [...(Object.keys(THEMES) as ThemeId[]), "system"]
const THEME_MODE_VALUES: ThemeMode[] = ["system", "light", "dark"]

const ThemeProviderContext = React.createContext<
  ThemeProviderState | undefined
>(undefined)

function isTheme(value: string | null): value is Theme {
  if (value === null) {
    return false
  }

  return THEME_VALUES.includes(value as Theme)
}

function isThemeMode(value: string | null): value is ThemeMode {
  if (value === null) return false
  return THEME_MODE_VALUES.includes(value as ThemeMode)
}

function isThemeFamilyId(value: string | null): value is ThemeFamilyId {
  if (value === null) return false
  return THEME_FAMILIES.some((family) => family.id === value)
}

function findThemeFamily(familyId: ThemeFamilyId) {
  return (
    THEME_FAMILIES.find((family) => family.id === familyId) ?? THEME_FAMILIES[0]
  )
}

function themeIdForFamily(
  familyId: ThemeFamilyId,
  appearance: ResolvedTheme
): ThemeId {
  const family = findThemeFamily(familyId)
  return family[appearance]
}

function themeFamilyForTheme(themeId: ThemeId): ThemeFamilyId {
  return (
    THEME_FAMILIES.find(
      (family) => family.light === themeId || family.dark === themeId
    )?.id ?? THEME_FAMILIES[0].id
  )
}

function getSystemTheme(): ResolvedTheme {
  if (window.matchMedia(COLOR_SCHEME_QUERY).matches) {
    return "dark"
  }

  return "light"
}

function resolveMode(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? getSystemTheme() : mode
}

function applyThemeClass(theme: ThemeId, resolvedTheme: ResolvedTheme) {
  const root = document.documentElement
  root.classList.remove("light", "dark")
  root.classList.add(resolvedTheme)
  root.dataset.theme = theme
  // Keep the native window background in sync with the theme. During a native
  // resize, macOS exposes new window area before Chromium paints it and fills
  // it with the window's background color — a mismatched color (e.g. the dark
  // boot color under a light theme) flashes at the edges and reads as shaking.
  requestAnimationFrame(() => {
    const bg = getComputedStyle(document.body).backgroundColor
    if (bg) window.appWindow?.setWindowBackgroundColor?.(bg).catch(() => null)
  })
}

type ThemeSettings = {
  mode: ThemeMode
  family: ThemeFamilyId
}

function settingsFromTheme(theme: Theme, defaultTheme: Theme): ThemeSettings {
  if (theme === "system") {
    return {
      mode: "system",
      family:
        defaultTheme === "system"
          ? THEME_FAMILIES[0].id
          : themeFamilyForTheme(defaultTheme),
    }
  }

  return {
    mode: THEMES[theme].appearance,
    family: themeFamilyForTheme(theme),
  }
}

function modeStorageKey(storageKey: string) {
  return `${storageKey}.mode`
}

function familyStorageKey(storageKey: string) {
  return `${storageKey}.family`
}

function readThemeSettings(
  storageKey: string,
  defaultTheme: Theme
): ThemeSettings {
  const storedMode = store.get(modeStorageKey(storageKey))
  const storedFamily = store.get(familyStorageKey(storageKey))

  if (isThemeMode(storedMode) && isThemeFamilyId(storedFamily)) {
    return { mode: storedMode, family: storedFamily }
  }

  const legacyTheme = store.get(storageKey)
  if (isTheme(legacyTheme)) return settingsFromTheme(legacyTheme, defaultTheme)

  return settingsFromTheme(defaultTheme, defaultTheme)
}

function writeThemeSettings(storageKey: string, settings: ThemeSettings) {
  store.set(modeStorageKey(storageKey), settings.mode)
  store.set(familyStorageKey(storageKey), settings.family)
}

function disableTransitionsTemporarily() {
  const style = document.createElement("style")
  style.appendChild(
    document.createTextNode(
      "*,*::before,*::after{-webkit-transition:none!important;transition:none!important}"
    )
  )
  document.head.appendChild(style)

  return () => {
    window.getComputedStyle(document.body)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        style.remove()
      })
    })
  }
}

export function ThemeProvider({
  children,
  defaultTheme = "dark-claude",
  storageKey = "theme",
  disableTransitionOnChange = true,
  ...props
}: ThemeProviderProps) {
  const [settings, setSettings] = React.useState<ThemeSettings>(() =>
    readThemeSettings(storageKey, defaultTheme)
  )

  // Re-sync once the on-disk snapshot finishes hydrating (async).
  React.useEffect(
    () =>
      store.onReady(() => {
        setSettings(readThemeSettings(storageKey, defaultTheme))
      }),
    [defaultTheme, storageKey]
  )
  const [resolvedTheme, setResolvedTheme] = React.useState<ResolvedTheme>(() =>
    resolveMode(settings.mode)
  )

  const setMode = React.useCallback(
    (mode: ThemeMode) => {
      setSettings((prev) => {
        const next = { ...prev, mode }
        writeThemeSettings(storageKey, next)
        return next
      })
    },
    [storageKey]
  )

  const setThemeFamily = React.useCallback(
    (family: ThemeFamilyId) => {
      setSettings((prev) => {
        const next = { ...prev, family }
        writeThemeSettings(storageKey, next)
        return next
      })
    },
    [storageKey]
  )

  const setTheme = React.useCallback(
    (nextTheme: Theme) => {
      setSettings((prev) => {
        const next =
          nextTheme === "system"
            ? { ...prev, mode: "system" as const }
            : settingsFromTheme(nextTheme, defaultTheme)
        writeThemeSettings(storageKey, next)
        return next
      })
    },
    [defaultTheme, storageKey]
  )

  const applyTheme = React.useCallback(
    (nextSettings: ThemeSettings) => {
      const nextResolvedTheme = resolveMode(nextSettings.mode)
      const nextTheme = themeIdForFamily(nextSettings.family, nextResolvedTheme)
      const restoreTransitions = disableTransitionOnChange
        ? disableTransitionsTemporarily()
        : null

      applyThemeClass(nextTheme, nextResolvedTheme)
      setResolvedTheme(nextResolvedTheme)

      if (restoreTransitions) {
        restoreTransitions()
      }
    },
    [disableTransitionOnChange]
  )

  React.useLayoutEffect(() => {
    applyTheme(settings)

    if (settings.mode !== "system") {
      return undefined
    }

    const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY)
    const handleChange = () => {
      applyTheme(settings)
    }

    mediaQuery.addEventListener("change", handleChange)

    return () => {
      mediaQuery.removeEventListener("change", handleChange)
    }
  }, [settings, applyTheme])

  React.useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) {
        return
      }

      if (
        event.key !== storageKey &&
        event.key !== modeStorageKey(storageKey) &&
        event.key !== familyStorageKey(storageKey)
      ) {
        return
      }

      setSettings(readThemeSettings(storageKey, defaultTheme))
    }

    window.addEventListener("storage", handleStorageChange)

    return () => {
      window.removeEventListener("storage", handleStorageChange)
    }
  }, [defaultTheme, storageKey])

  const theme = themeIdForFamily(settings.family, resolvedTheme)

  const value = React.useMemo(
    () => ({
      mode: settings.mode,
      theme,
      themeFamily: settings.family,
      resolvedTheme,
      setMode,
      setTheme,
      setThemeFamily,
    }),
    [
      settings.mode,
      settings.family,
      theme,
      resolvedTheme,
      setMode,
      setTheme,
      setThemeFamily,
    ]
  )

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = React.useContext(ThemeProviderContext)

  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }

  return context
}
