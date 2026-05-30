# GearShift

GearShift is an Electron workspace app for developers who work across multiple local projects and terminal-based coding agents.

It brings project tabs, terminal panes, file previews, git changes, pull request shortcuts, and agent activity indicators into one desktop app.

## Status

GearShift is early-stage software. Expect rough edges, active changes, and macOS-first behavior while the project settles.

## Features

- Multi-project workspace with project tabs, split panes, and custom project avatars.
- File tree, file preview, Markdown rendering, and syntax-highlighted diffs.
- Git status, file changes, branch actions, and pull request shortcuts.
- Agent activity detection for supported CLI coding agents.
- Desktop and in-app notifications when background agent work finishes.
- Theme settings with twelve color variants (Default/Cool/Warm/Rosé/Forest/Violet in light and dark) plus System, appearance, and keybinding settings.

## Tech Stack

- Electron
- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- TanStack Router
- TanStack Query
- CodeMirror
- xterm.js
- Drizzle ORM with libSQL

## Requirements

- macOS is the primary supported platform right now.
- [Bun](https://bun.sh/) for dependency installation and scripts.
- Git for project status and diffs.
- Optional: [GitHub CLI](https://cli.github.com/) for pull request actions.
- Optional: `direnv` for project-specific GitHub CLI environments.

## Getting Started

Install dependencies:

```bash
bun install
```

Start the app in development mode:

```bash
bun run dev
```

Run type checking:

```bash
bun run typecheck
```

Run linting:

```bash
bun run lint
```

Create a production build:

```bash
bun run build
```

Create a local macOS app build without signing or notarization:

```bash
bun run dist
```

Create a local macOS DMG without signing or notarization:

```bash
bun run dist:dmg
```

## Project Structure

```text
electron/                 Electron main process, preload bridge, PTY daemon, and local data access
src/                      React renderer app
src/components/layout/    Main workspace, panes, terminal, files, git, and shell UI
src/components/ui/        Shared UI primitives
src/routes/settings/      Settings screens
src/lib/                  Renderer utilities, stores, project state, and keybindings
```

## Development Notes

- The app uses `vite-plugin-electron` so `bun run dev` starts the renderer and Electron together.
- Native modules are rebuilt after install through `electron-builder install-app-deps`.
- The app stores development data under `gearshift-dev` and production data under `com.gearshift`.
- The GitHub integration uses the local `gh` CLI. GearShift does not manage GitHub API tokens.
- If `direnv` is installed, GearShift evaluates the opened project's `.envrc` before running `gh`.

## Documentation

- [Architecture](docs/architecture.md)

## Contributing

Contributions are welcome.

Before opening a pull request:

1. Run `bun run typecheck`.
2. Run `bun run lint`.
3. Keep changes focused and include screenshots for UI changes when useful.
4. Update this README or related docs when behavior changes.

## License

No license has been added yet. Add a license before publishing this repository as open source.
