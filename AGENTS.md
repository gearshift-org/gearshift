# AGENTS.md

## Package Manager

- Use Bun for all dependency and script commands.
- Use `bun install` to install dependencies.
- Use `bun add <package>` and `bun remove <package>` to change dependencies.
- Use `bun run <script>` for package scripts.
- Keep `bun.lock` updated.
- Do not create or update `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`.

## Commits

- Use Conventional Commit prefixes for all commit messages.
- Choose the prefix that matches the change: `feat:`, `fix:`, `chore:`, `docs:`, `style:`, `refactor:`, `perf:`, `test:`, or `build:`.
- Add a scope when it improves clarity, for example `fix(git): suppress missing repo warnings`.
- Keep the subject imperative, lowercase after the prefix, and under 72 characters when practical.
