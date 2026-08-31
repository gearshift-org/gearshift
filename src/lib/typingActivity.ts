// Shared "the user is typing right now" signal.
//
// The renderer has one main thread. A coding agent writing files makes the
// project watcher fire, which invalidates the git status and file-tree
// queries, which re-renders the sidebar and the tree. Those refreshes are
// debounced, so they land the moment the agent's write burst pauses — which is
// very often the same moment the user starts typing their next prompt. The
// result is a keystroke that has to wait behind a sidebar re-render.
//
// None of that work is urgent: it feeds a file list and a change counter. This
// lets those call sites hold off until the user stops typing for a moment,
// without any of them needing to know about the terminal.

const TYPING_QUIET_MS = 250

let lastTypedAt = -Infinity

/** Call on every keystroke that goes into a terminal. */
export function markUserTyping(): void {
  lastTypedAt = performance.now()
}

export function isUserTyping(): boolean {
  return performance.now() - lastTypedAt < TYPING_QUIET_MS
}

/**
 * Run `task` once the user has been quiet for TYPING_QUIET_MS. Returns a
 * cancel function. If the user is already idle, `task` runs synchronously.
 */
export function runWhenNotTyping(task: () => void): () => void {
  if (!isUserTyping()) {
    task()
    return () => {}
  }
  let timer: number | undefined
  const check = () => {
    const remaining = TYPING_QUIET_MS - (performance.now() - lastTypedAt)
    if (remaining <= 0) {
      timer = undefined
      task()
      return
    }
    timer = window.setTimeout(check, remaining)
  }
  check()
  return () => {
    if (timer !== undefined) window.clearTimeout(timer)
  }
}
