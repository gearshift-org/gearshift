import { cn } from "@/lib/utils"

const ORA_DOTS_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

type Props = {
  className?: string
  label?: string
}

export function AgentSpinner({
  className,
  label = "Coding agent working",
}: Props) {
  // The braille frames live in a vertical reel that's scrolled with a
  // `transform: translateY` step animation (see .gs-agent-spinner in index.css).
  // Transform animations run on the compositor thread, so the spinner keeps
  // ticking even when the main thread is blocked (e.g. a terminal fit/reflow on
  // project switch) — unlike a JS interval or a CSS `content` animation, which
  // both freeze during main-thread work.
  return (
    <span
      aria-label={label}
      title={label}
      className={cn(
        "gs-agent-spinner relative inline-block size-[18px] shrink-0 overflow-hidden rounded-[5px] text-center font-mono text-sm leading-none",
        className,
      )}
    >
      <span className="gs-agent-spinner-reel" aria-hidden>
        {ORA_DOTS_FRAMES.map((frame, i) => (
          <span key={i}>{frame}</span>
        ))}
      </span>
    </span>
  )
}
