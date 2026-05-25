import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const CYCLE = ["light", "dark", "system"] as const

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const next = CYCLE[(CYCLE.indexOf(theme) + 1) % CYCLE.length]

  const Icon =
    theme === "light" ? Sun : theme === "dark" ? Moon : Monitor
  const label =
    theme === "light" ? "Light" : theme === "dark" ? "Dark" : "System"

  return (
    <div className="flex items-center pr-1 [-webkit-app-region:no-drag]">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() => setTheme(next)}
              aria-label={`Theme: ${label}. Click to switch.`}
              className="grid size-5 place-items-center rounded-sm text-foreground transition-colors hover:bg-foreground/15"
            >
              <Icon className="size-3.5" />
            </button>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </div>
  )
}
