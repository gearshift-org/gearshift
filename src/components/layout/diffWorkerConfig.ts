// Shared @pierre/diffs worker-pool config, used by every diff surface
// (SingleFileDiff, CommitDiff). Kept in its own module so the component files
// stay fast-refresh friendly (only-export-components).

export const diffsWorkerPoolOptions = {
  workerFactory: () =>
    new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), {
      type: "module",
    }),
  poolSize: 4,
}

// The worker pool tokenizes with the theme it's initialized with here — the
// per-render `theme` option on the viewer only drives CSS variables, not the
// syntax tokens. Use Atom One to match the code editor (oneDark).
export const diffsHighlighterOptions = {
  theme: { dark: "one-dark-pro", light: "one-light" },
} as const
