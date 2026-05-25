import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

const ORA_DOTS_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const ORA_DOTS_INTERVAL_MS = 80

type Props = {
  className?: string
  label?: string
}

export function AgentSpinner({
  className,
  label = "Coding agent working",
}: Props) {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => {
      setFrame((current) => (current + 1) % ORA_DOTS_FRAMES.length)
    }, ORA_DOTS_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [])

  return (
    <span
      aria-label={label}
      title={label}
      className={cn(
        "inline-grid size-3 shrink-0 place-items-center font-mono text-[11px] leading-none text-orange-500 dark:text-orange-400",
        className,
      )}
    >
      {ORA_DOTS_FRAMES[frame]}
    </span>
  )
}
