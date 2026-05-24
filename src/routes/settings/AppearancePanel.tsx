import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

type Choice = "light" | "dark" | "system"

const CHOICES: { value: Choice; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
]

export function AppearancePanel() {
  const { theme, setTheme } = useTheme()

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
    </div>
  )
}
