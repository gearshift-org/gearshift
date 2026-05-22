# React + TypeScript + Vite + shadcn/ui

This is a template for a new Vite project with React, TypeScript, and shadcn/ui.

## Adding components

To add components to your app, run the following command:

```bash
npx shadcn@latest add button
```

This will place the ui components in the `src/components` directory.

## Using components

To use the components in your app, import them as follows:

```tsx
import { Button } from "@/components/ui/button"
```

## Architecture

### Filesystem watcher

Each open project subscribes to a recursive native watcher via
[`@parcel/watcher`](https://www.npmjs.com/package/@parcel/watcher) in
`electron/main.ts`. One subscription per `watchId`, keyed off a renderer
request from `fs:watchProject`.

The watcher is intentionally noisy at the OS level but quiet at the IPC
level:

- **Ignored at the source** — base globs (`**/.git/**`, `**/.DS_Store`)
  plus every line of the project's `.gitignore`, converted to globs by
  `gitignoreToGlobs`. The `.git/**` filter is load-bearing: `git status`
  writes to `.git/index`, and without the filter the watcher would
  feedback-loop with the renderer's refresh.
- **Debounced in main** — events are collected into a `Set<string>` per
  watch, flushed 150 ms after the last event as a single `fs:changed`
  IPC.
- **Native module** — marked external in `vite.config.ts` so the bundler
  doesn't inline its prebuilt binaries. `electron-builder install-app-deps`
  rebuilds it against Electron's Node ABI on `postinstall`.

### Changes pane refresh

`src/components/layout/ChangesPane.tsx` keeps `git status` + `git diffAll`
in sync with disk using three paths:

1. **Initial load** — on mount, on `cwd` change, and whenever the project
   becomes active (`isActive` flips true). The only path that shows the
   "Loading changes…" spinner.
2. **Watcher → debounced refresh** — `fs:changed` IPC schedules a refresh
   `REFRESH_DEBOUNCE_MS` (350 ms) after the last event.
3. **Polling backstop** — `setInterval` calls refresh every
   `POLL_INTERVAL_MS` (4 s), or `POLL_INTERVAL_LARGE_MS` (10 s) when the
   changeset exceeds `LARGE_CHANGESET_THRESHOLD` (300 files). Catches
   anything the watcher misses (external git operations, terminal
   commands, etc.).

All three paths funnel through a single `runRefresh` callback that
serializes via `inFlightRef` + `pendingRef`. Concurrent refreshes can
never stack — a new request while one is in flight just sets the pending
flag, which kicks off exactly one follow-up when the current call
finishes.

Inactive projects (mounted in other tabs but not focused) skip both the
watcher subscription and polling — only the active project pays the cost.
