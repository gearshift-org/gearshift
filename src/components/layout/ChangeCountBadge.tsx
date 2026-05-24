import { cn } from "@/lib/utils"

type Props = {
  count: number
  className?: string
}

export function ChangeCountBadge({ count, className }: Props) {
  return (
    <span
      className={cn(
        "grid h-3.5 min-w-3.5 place-items-center rounded-full bg-black px-1 text-[9px] leading-none font-semibold text-white tabular-nums dark:bg-white dark:text-black",
        className
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}
