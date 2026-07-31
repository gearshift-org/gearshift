<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:
- Run `bunx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `bunx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

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
