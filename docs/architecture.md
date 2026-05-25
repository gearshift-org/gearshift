# Architecture

This document explains the main runtime systems in GearShift.

## Filesystem Watcher

Each open project subscribes to a recursive native watcher via [`@parcel/watcher`](https://www.npmjs.com/package/@parcel/watcher) in `electron/main.ts`. One subscription is created per `watchId`, keyed off a renderer request from `fs:watchProject`.

The watcher is intentionally noisy at the OS level but quiet at the IPC level:

- Ignored at the source: base globs like `**/.git/**` and `**/.DS_Store`, plus every line of the project's `.gitignore`, converted to globs by `gitignoreToGlobs`.
- Debounced in main: events are collected into a `Set<string>` per watch and flushed after 150 ms as one `fs:changed` IPC event.
- Native module handling: `@parcel/watcher` is marked external in `vite.config.ts` so the bundler does not inline its prebuilt binaries.

## Changes Panel Refresh

`src/components/layout/RightSidebar.tsx` keeps `git status` and diffs in sync with disk using three paths:

1. Initial load on mount, `cwd` change, and active project change.
2. Watcher-driven refresh after `fs:changed` IPC events.
3. Polling backstop for file changes missed by the watcher.

All refresh requests funnel through one serialized callback so concurrent refreshes do not stack. Inactive projects skip watcher subscriptions and polling to keep background work low.

## CLI Agent Activity

Terminal panes detect supported coding agents by asking the Electron main process to inspect the PTY shell's child process tree. GearShift passes each terminal a `GEARSHIFT_SESSION_ID` and `GEARSHIFT_AGENT_SOCKET` so supported lifecycle hooks can report status back over a local Unix socket.

The renderer combines lifecycle hooks, process detection, terminal title changes, and terminal output cues to show project-level activity. Background completions can surface as in-app or desktop notifications.

## GitHub Pull Requests

The changes panel shows pull request status beside the branch picker when the GitHub CLI is installed and available. GearShift checks the current branch with `gh pr list`; if an open pull request exists, it opens that PR. If no PR exists and the branch is pushed upstream, GearShift opens GitHub's pull request creation page.
