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

Terminal panes detect supported coding agents by asking the Electron main process to inspect the PTY shell's child process tree. GearShift passes each terminal a `GEARSHIFT_SESSION_ID` and `GEARSHIFT_AGENT_SOCKET` so supported lifecycle hooks can report status back over a local Unix socket. Agent-specific hooks and plugins are normalized into three GearShift lifecycle events: `start`, `stop`, and `needs_attention`.

The renderer combines lifecycle hooks, process detection, terminal title changes, and terminal output cues to show project-level activity. Background completions can surface as in-app or desktop notifications.

### Agent-native session IDs

In addition to GearShift's own per-pane `GEARSHIFT_SESSION_ID` (a UUID we generate and inject at PTY spawn), each lifecycle hook also reports the **agent's own session ID** — e.g. the UUID Claude writes to `~/.claude/projects/<cwd>/<session-id>.jsonl`. This is the id needed to later resume a conversation (`claude --resume <id>`, OpenCode session restore, pi session file, etc.).

The id rides the existing hook wire format as a trailing field:

```
agent|GEARSHIFT_SESSION_ID|event|body|agentSessionId
```

`parseAgentHookPayload` in `electron/agentHooks.ts` parses it; payloads without the field (older 3–4 part messages) still parse with `agentSessionId` left empty. From there it flows `onAgentEvent` → `TerminalView` (a sticky `agentSessionIdRef` merges it onto every emitted status) → `AppShell` (sticky: a missing id never clobbers a saved one) → persisted on the pane as `agentSessionId` in `state.json` (`gearshift.projects`).

Where each agent's id is sourced (all in `electron/agentHooks.ts`):

| Agent | Source | Notes |
|-------|--------|-------|
| **Claude** | bash hook reads stdin JSON, greps `"session_id"` | Reliable. Hook JSON includes `session_id` on every event. |
| **Codex** | same bash hook (`"session_id"` grep) | Best-effort — works if Codex's hook JSON uses the same key. |
| **OpenCode** | plugin's `event.properties.sessionID` / `info.id` (the root, non-child session) | Reliable. Format `ses_…`. |
| **pi** | `ctx.sessionManager.getSessionId()` on the handler context (NOT the event payload) | pi events carry no session id; it lives on the `ExtensionContext`. Confirmed via pi's `dist/core/extensions/types.d.ts` → `ExtensionContext.sessionManager: ReadonlySessionManager`. |

The shared bash hook reads a **bounded** slice of stdin (`head -c 65536`) so capturing the id on every event (including `start`/`UserPromptSubmit`) never blocks on huge `Stop` payloads. The id is only populated once an agent fires its first `start` hook (i.e. on prompt submit) — merely opening the TUI does not set it.

## GitHub Pull Requests

The changes panel shows pull request status beside the branch picker when the GitHub CLI is installed and available. GearShift checks the current branch with `gh pr list`; if an open pull request exists, it opens that PR. If no PR exists and the branch is pushed upstream, GearShift opens GitHub's pull request creation page.
