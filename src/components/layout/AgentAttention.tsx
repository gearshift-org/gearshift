import { cn } from "@/lib/utils"

type Props = {
  className?: string
  label?: string
}

/**
 * Bouncing amber dot shown when a coding agent is blocked waiting on the user
 * (a permission/approval prompt or idle prompt). Visually distinct from the
 * orange working spinner and the emerald "done" dot.
 */
export function AgentAttention({
  className,
  label = "Coding agent needs attention",
}: Props) {
  return (
    <span
      aria-label={label}
      title={label}
      className={cn(
        "relative grid size-2.5 shrink-0 place-items-center",
        className,
      )}
    >
      <span className="gs-status-bounce relative size-1.5 rounded-full bg-amber-500 shadow-[0_0_0_1px_rgba(255,255,255,0.35)] dark:shadow-[0_0_0_1px_rgba(0,0,0,0.45)]" />
    </span>
  )
}
