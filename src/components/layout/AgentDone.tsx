import { cn } from "@/lib/utils"

type Props = {
  className?: string
  label?: string
}

/** Emerald dot shown after a coding agent finishes its latest task. */
export function AgentDone({ className, label = "Coding agent done" }: Props) {
  return (
    <span
      aria-label={label}
      title={label}
      className={cn(
        "relative grid size-2.5 shrink-0 place-items-center",
        className
      )}
    >
      <span className="gs-status-bounce relative size-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_1px_rgba(255,255,255,0.35)] dark:shadow-[0_0_0_1px_rgba(0,0,0,0.45)]" />
    </span>
  )
}
