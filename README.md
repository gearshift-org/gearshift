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

### CLI agent activity

Terminal panes detect supported coding agents (`claude`, `codex`, `opencode`,
`pi`, and `gemini`) by asking the Electron main process to inspect the PTY
shell's child process tree. GearShift auto-installs local lifecycle hooks for
Claude Code and Codex, plus an OpenCode plugin, and passes each terminal a
`GEARSHIFT_SESSION_ID` and `GEARSHIFT_AGENT_SOCKET`. Those integrations send
stop/notification events back to GearShift over a local Unix socket so the busy
indicator can end on real agent completion instead of a brief quiet pause. Pi
and Gemini stay on the fallback path until they expose a stable hook API.

The renderer still combines the "agent is running" signal with agent-specific
activity cues: changing title/spinner signals for Claude Code and Codex, and
terminal output as a fallback for OpenCode, Pi, and Gemini after their process
is confirmed. Activity is ignored until the user submits input while the agent
is already running, so the launch command itself does not light the project tab.
Output immediately after terminal resize, app refocus, or project/tab activation
is also ignored because TUIs often redraw in those moments. Echoed output from
normal typing is briefly ignored until the user submits with Enter. General
terminal output is ignored for the title-based agents so idle redraws, prompts,
and background output do not light the project tab. A longer quiet grace period
prevents the busy dot from flickering off during short model pauses when hook
events are missing or delayed. When any pane in a project is actively working,
the project tab shows a small orange animated dot after the avatar. If a
background project's agent finishes, the orange dot becomes a bouncing green dot
until that project is visited. While the app is focused, finishing away from the
active project shows a bottom-right in-app notification that opens the project
and terminal when clicked. If the app is not focused or is hidden, an agent
finishing in any project uses a desktop notification instead. A short completion
sound plays at 50% volume whenever an agent finishes.
Idle agents stay hidden. Inactive project and tab panes stay mounted and
attached to the DOM; they are hidden with opacity so terminal canvases do not
have to detach and re-attach during normal navigation.

### GitHub pull requests

The Changes pane shows pull request status beside the branch picker when the
GitHub CLI (`gh`) is installed and available. GearShift checks the current
branch with `gh pr list`; if an open pull request exists, it shows the PR
number and opens it in GitHub. If no PR exists and the branch is already pushed
to an upstream remote, it shows a Create PR action that opens GitHub's PR
creation page.

No GitHub API token is managed by the app. Authentication stays with the
GitHub CLI, so users should run `gh auth login` if GitHub reports an auth
error. When `direnv` is installed, GearShift evaluates the opened project's
`.envrc` environment before running `gh`, including `.envrc` files inherited
from parent directories. This lets different projects use different GitHub
accounts or tokens without changing the global GitHub CLI account.
