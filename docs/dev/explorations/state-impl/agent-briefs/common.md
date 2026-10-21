<!-- Template: copy to the session's scratchpad, replace <scratch> with the scratchpad path and
<this session's URL> with the session URL, and name the working branch. -->

# Ground rules for every agent working on a state-implementation phase (binding)

You are working in the repository at /home/user/serious-tavern (TypeScript npm-workspaces monorepo:
packages/shared, packages/engine, packages/node-ui, apps/server, apps/web).

- First read AGENTS.md in full (conventions and key contracts, they are binding). README.md is large
  (~136 KB): do NOT read it whole; read its table of contents (`grep -n '^#' README.md`) and only the
  sections relevant to your task. Never modify PLAN.md (read it only if your task needs the vision).
  Read only the parts of docs/dev/explorations/STATE-DESIGN-PROPOSAL-3.md the phase spec cites. For web
  layout work also read docs/dev/design/FRONTEND-LAYOUT.md.
- Environment: Linux with bash (AGENTS.md mentions Windows/PowerShell; ignore those shell specifics
  here). Dependencies are installed (`npm ci` was run). Chromium + Playwright are available
  (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers; never run "playwright install"; if needed launch with
  executablePath '/opt/pw-browsers/chromium').
- Stay on the current git branch (the session's designated working branch). Never switch branches, never push, never
  touch main, never rewrite history (no amend/rebase/reset of existing commits, no force anything).
- Never run anything against apps/server/data. For live checks, create a temp dir under
  <scratch>/live-<something>,
  run the server with that dir as cwd
  (`node /home/user/serious-tavern/node_modules/tsx/dist/cli.mjs /home/user/serious-tavern/apps/server/src/main.ts`
  with PORT set to a free port; the startup log always says 3001, ignore that), and delete the temp
  dir afterwards. Kill only processes you started, by PID. Never leave servers running.
- `npm run check` (biome + typecheck + tests + knip) must pass before every commit. `npm run fix`
  applies formatting.
- Commit messages: conventional style `type(scope): subject`, a short body explaining why, and exactly
  these trailer lines at the end (blank line before them):

  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  Co-Authored-By: <the attribution line your own harness gives you>
  Claude-Session: <this session's URL>

  Use `git commit -F <file>` with a message file in the scratch dir to keep the trailers exact.
- Data compatibility is sacred (alpha, user data preserved): schema changes additive with defaults,
  unknown fields kept.
- Keep files focused (roughly under 250 lines), follow existing patterns, delete dead code (knip).
- Scratch files go in <scratch>,
  never in the repo.
- AGENTS.md: update its key contracts when you add a contract (the orchestrator reviews these edits).
  README.md holds technical docs.
