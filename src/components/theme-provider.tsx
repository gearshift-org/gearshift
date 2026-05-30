/* eslint-disable react-refresh/only-export-components */
import * as React from "react"
import { store } from "@/lib/store"

type ResolvedTheme = "dark" | "light"

type ThemeDefinition = {
  label: string
  appearance: ResolvedTheme
}

// Registry of selectable themes. `system` is handled separately (it follows the
// OS and resolves to the default light/dark palette).
export const THEMES = {
  light: { label: "Default", appearance: "light" },
  "light-cool": { label: "Cool", appearance: "light" },
  "light-warm": { label: "Warm", appearance: "light" },
  "light-rose": { label: "Rosé", appearance: "light" },
  "light-forest": { label: "Forest", appearance: "light" },
  "light-violet": { label: "Violet", appearance: "light" },
  "light-atom-one": { label: "Atom One", appearance: "light" },
  "light-claude": { label: "Claude", appearance: "light" },
  dark: { label: "Default", appearance: "dark" },
  "dark-cool": { label: "Cool", appearance: "dark" },
  "dark-warm": { label: "Warm", appearance: "dark" },
  "dark-rose": { label: "Rosé", appearance: "dark" },
  "dark-forest": { label: "Forest", appearance: "dark" },
  "dark-violet": { label: "Violet", appearance: "dark" },
  "dark-atom-one": { label: "Atom One", appearance: "dark" },
  "dark-claude": { label: "Claude", appearance: "dark" },
} as const satisfies Record<string, ThemeDefinition>

export type ThemeId = keyof typeof THEMES
type Theme = ThemeId | "system"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
  disableTransitionOnChange?: boolean
}

type ThemeProviderState = {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)"
const THEME_VALUES: Theme[] = [...(Object.keys(THEMES) as ThemeId[]), "system"]

const ThemeProviderContext = React.createContext<
  ThemeProviderState | undefined
>(undefined)

function isTheme(value: string | null): value is Theme {
  if (value === null) {
    return false
  }

  return THEME_VALUES.includes(value as Theme)
}

function getSystemTheme(): ResolvedTheme {
  if (window.matchMedia(COLOR_SCHEME_QUERY).matches) {
    return "dark"
  }

  return "light"
}

function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? getSystemTheme() : THEMES[theme].appearance
}

function applyThemeClass(theme: Theme, resolvedTheme: ResolvedTheme) {
  const root = document.documentElement
  root.classList.remove("light", "dark")
  root.classList.add(resolvedTheme)
  // `system` maps to the base light/dark palette; explicit themes map to their
  // own `[data-theme]` palette block (the defaults reuse `:root`/`.dark`).
  root.dataset.theme = theme === "system" ? resolvedTheme : theme
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
  defaultTheme = "system",
  storageKey = "theme",
  disableTransitionOnChange = true,
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    const storedTheme = store.get(storageKey)
    if (isTheme(storedTheme)) {
      return storedTheme
    }

    return defaultTheme
  })

  // Re-sync once the on-disk snapshot finishes hydrating (async).
  React.useEffect(
    () =>
      store.onReady(() => {
        const storedTheme = store.get(storageKey)
        if (isTheme(storedTheme)) setThemeState(storedTheme)
      }),
    [storageKey],
  )
  const [resolvedTheme, setResolvedTheme] = React.useState<ResolvedTheme>(() =>
    resolveTheme(theme)
  )

  const setTheme = React.useCallback(
    (nextTheme: Theme) => {
      store.set(storageKey, nextTheme)
      setThemeState(nextTheme)
    },
    [storageKey]
  )

  const applyTheme = React.useCallback(
    (nextTheme: Theme) => {
      const nextResolvedTheme = resolveTheme(nextTheme)
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
    applyTheme(theme)

    if (theme !== "system") {
      return undefined
    }

    const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY)
    const handleChange = () => {
      applyTheme("system")
    }

    mediaQuery.addEventListener("change", handleChange)

    return () => {
      mediaQuery.removeEventListener("change", handleChange)
    }
  }, [theme, applyTheme])

  React.useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) {
        return
      }

      if (event.key !== storageKey) {
        return
      }

      if (isTheme(event.newValue)) {
        setThemeState(event.newValue)
        return
      }

      setThemeState(defaultTheme)
    }

    window.addEventListener("storage", handleStorageChange)

    return () => {
      window.removeEventListener("storage", handleStorageChange)
    }
  }, [defaultTheme, storageKey])

  const value = React.useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
    }),
    [theme, resolvedTheme, setTheme]
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
