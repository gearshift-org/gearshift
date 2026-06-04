# Architecture

This document explains the main runtime systems in GearShift.

## Filesystem Watcher

Each open project subscribes to a recursive native watcher via [`@parcel/watcher`](https://www.npmjs.com/package/@parcel/watcher) in `electron/main.ts`. One subscription is created per `watchId`, keyed off a renderer request from `fs:watchProject`.

The watcher is intentionally noisy at the OS level but quiet at the IPC level:

- Ignored at the source: base globs like `**/.git/**` and `**/.DS_Store`, plus every line of the project's `.gitignore`, converted to globs by `gitignoreToGlobs`.
- Debounced in main: events are collected into a `Set<string>` per watch and flushed after 150 ms as one `fs:changed` IPC event.
- Native module handling: `@parcel/watcher` is marked external in `vite.config.ts` so the bundler does not inline its prebuilt binaries.

## Changes Panel Refresh

`src/components/layout/RightSidebar.tsx` keeps `git status` and diffs in sync with disk using four paths:

1. Initial load on mount, `cwd` change, and active project change.
2. Watcher-driven refresh after `fs:changed` IPC events.
3. Polling backstop for file changes missed by the watcher.
4. Immediate React Query refetch when a terminal agent transitions from working to completed.

All refresh requests funnel through one serialized callback so concurrent refreshes do not stack. Inactive projects skip watcher subscriptions and polling to keep background work low.

Stage, unstage, and discard actions optimistically patch the visible changes list immediately. Watcher and polling refreshes are held during the action, and the optimistic overlay is only removed after a real `git status` refresh confirms the new state, so stale in-flight refreshes cannot flash a file back to the old section.

## CLI Agent Activity

Terminal panes detect supported coding agents by asking the Electron main process to inspect the PTY shell's child process tree. GearShift passes each terminal a `GEARSHIFT_SESSION_ID` and `GEARSHIFT_AGENT_SOCKET` so supported lifecycle hooks can report status back over a local Unix socket. Agent-specific hooks and plugins are normalized into three GearShift lifecycle events: `start`, `stop`, and `needs_attention`.

The renderer combines lifecycle hooks, process detection, terminal title changes, and terminal output cues to show project-level activity. Background completions can surface as in-app or desktop notifications.

### Chat history redaction

User prompts are captured in `electron/inputCapture.ts` and saved through `electron/db/chatDb.ts`. `appendMessage` redacts likely secrets before writing to `chat.db`, and history reads redact again before returning rows so older stored messages are not shown with raw secrets. The redactor masks credential-looking fields (`password`, `api_key`, `token`, etc.), `Authorization` headers, and common key formats with `********`. Stored history bodies are capped at 500 characters, and users can delete individual history items or clear a whole session/project.

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

### Agent session titles

The stored `agentSessionId` is used to resolve a human-readable **session title** that becomes the pane/tab name. `electron/agentSessionTitle.ts` (`getAgentSessionTitle`, exposed over IPC as `term:agentSessionTitle`) locates the agent's session file by id and returns a title in two tiers:

| Agent | Title source |
|-------|--------------|
| **Claude** | last `"type":"ai-title"` line in `~/.claude/projects/<cwd>/<id>.jsonl` |
| **OpenCode** | `"title"` field in `~/.local/share/opencode/storage/session/<projectID>/<id>.json` |
| **Codex** | first real user message in `~/.codex/sessions/**/rollout-…-<id>.jsonl` (skips the injected `AGENTS.md`/instructions envelope) |
| **pi** | first user message in `~/.pi/agent/sessions/<cwd>/<ts>_<id>.jsonl` |
| **Gemini** | first user message in `~/.gemini/tmp/<hash>/logs.json` whose `sessionId` matches |

Lookups find the file by id suffix (`findFileById` matches `<id><ext>`, covering exact names plus codex's `-<id>` and pi's `_<id>` separators), read a bounded slice, and return `null` on any failure. `TerminalView` fetches the title on `start`/`stop` hook events, folds it into the agent status (sticky ref), and it persists per pane as `agentSessionTitle`. The title precedence in `terminalName.ts` is: **`customName` (explicit user name) → `agentSessionTitle` → formatted TUI window title (`autoTitle`) → agent display name → fallback**. So a user-set name always wins; otherwise the agent's own title replaces the generic TUI title (e.g. "✳ Claude Code").

## GitHub Pull Requests

The changes panel shows pull request status beside the branch picker when the GitHub CLI is installed and available. GearShift checks the current branch with `gh pr list`; if an open pull request exists, it opens that PR. If no PR exists and the branch is pushed upstream, GearShift opens GitHub's pull request creation page.

## PTY daemon & terminating sessions

Terminals are owned by a detached `pty-daemon` (`electron/pty-daemon/server.ts`) that outlives the app window so sessions survive reloads. Each session is a `node-pty` PTY whose master fd is only released when node-pty fires `onExit`, which only happens once the **slave side hits EOF** — i.e. once every process holding the PTY open has died.

**Why sessions must be killed by process group:** node-pty's `pty.kill()` only signals the shell (`this.pid`). But coding agents spawn long-lived children (MCP servers, etc.) in the same process group. Signalling the shell alone leaves those children alive, the slave never EOFs, `onExit` never fires, and **the master fd leaks**. Enough leaked fds exhaust the system PTY table (`kern.tty.ptmx_max`, 511 on macOS) and every app — not just GearShift — then fails to allocate a PTY ("cannot allocate pty device").

`terminateSession` is the single teardown path used by tab-close, the 24h idle sweep, and daemon shutdown. node-pty calls `setsid`, so the shell's pid is the process-group leader; we signal the whole group with `process.kill(-pid, "SIGHUP")`, then `SIGKILL` as a fallback after a short grace if the session hasn't exited. **Never replace this with a bare `pty.kill()`** — that reintroduces the fd leak.

To diagnose a suspected leak: `lsof | grep -c ptmx` (count held PTY master fds) vs. the number of live shells. A large gap means fds are leaking; restarting the daemon frees them immediately.
