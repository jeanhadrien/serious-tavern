# AGENTS.md — notes for AI agents working on this repo

Read `PLAN.md` for the vision and `README.md` for usage and architecture before making changes.

## What this is
A chatbot web app. Each chat reply comes from a user-built workflow of nodes, edited visually in an n8n-style editor. The frontend is a **thin client**: all storage, secrets and workflow execution live in the backend.

## Workflow conventions
- **Orchestration:** the main assistant acts as the orchestrator. It delegates substantial coding to a coding sub-agent (gpt-6-sol), then **verifies the work itself** before reporting back.
- **Coding agents are not persistent.** Spawn a **fresh agent per task**; don't rely on or reuse an agent's memory from earlier tasks.
  - Each brief must be self-contained. Tell the agent to read `AGENTS.md`, `README.md` and `PLAN.md` first, and include the task spec, relevant file paths, constraints, verification commands and commit rules.
  - Any knowledge worth keeping goes into the repo (this file, README, code comments/tests), not into an agent's context.
  - After a task, the orchestrator updates this file with any new conventions, contracts or gotchas the agent discovered.
- **PLAN.md is owned by the orchestrator/user.** Coding agents must not modify or delete it; they update `README.md` for technical docs.
- **Commits:** commit each feature separately. Include the trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`. Commit any pending changes before starting new work.
- **Scope:** keep it modular and simple. Prefer no new dependencies; justify any you add.

## Layout (npm workspaces, TypeScript strict, ESM, packages consumed as TS source)
- `packages/shared`: zod schemas and types (workflow, ports, `canConnect` compatibility and coercion rules). This is the single source of truth for both front and back.
- `packages/engine`: graph validation, wave-based parallel executor, templating (`{{input.x}}`, `{{trigger.message}}`, `{{history}}`, no code eval). Node types live in `src/nodes/<type>/index.ts` and are registered in `registry.ts`.
- `packages/node-ui`: config forms generated from JSON Schema, custom panels, template-variable hints.
- **API contract:** `packages/shared/src/api/` holds zod schemas and types for the request and response of every endpoint. It is the only definition of the API.
  - To add or change an endpoint, update the contract first. The server parses its input with the contract and types its response from it; the web client uses the same types.
  - Server tests check that responses match the contract schemas.
  - Don't declare request or response types locally, and don't put inline `z.object` schemas in routes.
- `apps/server`: Fastify 5 on port 3001 (run with `tsx`). JSON-file storage under `data/` (gitignored, atomic writes). AES-256-GCM secrets.
  - `app.ts` only wires things together.
  - `context.ts` sets up the repositories and secrets; `errors.ts` has HttpError and the error handler.
  - `routes/<resource>.ts` holds thin handlers; the logic lives in `services/`: `chat.ts` (runs a message under the session lock), card import/export, preset preview.
- `apps/web`: React 19 + Vite on port 5173, proxying `/api` to the server.
  - `api/`: typed clients per resource, built on `transport.ts` (ApiError, toasts, `{silent:true}`). Pages call these clients, never raw paths.
  - `alerts/`: toast store and `<Toaster/>`.
  - `connection.ts`: `isValidConnection`.
  - `pages/<area>/`: components and hooks per page (chat, workflows, entities, presets). Keep files focused, roughly under 250 lines.

## Commands
- `npm run dev`: server and web together.
- `npm run typecheck`, `npm test` (vitest, all packages), `npm run build` (typecheck and web build).
- **`npm run check`** runs Biome (format and lint, without writing), typecheck, tests and knip, in about 7 seconds. It must pass before every commit.
  - `npm run fix` applies Biome formatting and safe lint fixes.
  - knip reports unused files, exports and dependencies. Delete dead code; configure `knip.json` only for real false positives.
  - Tuned lint rules and the reasons are in the README. Don't disable more rules without a reason.
  - Large mechanical reformats go in their own `style:` commit, and that commit is added to `.git-blame-ignore-revs`.
- All three must pass before committing.

## Key contracts (don't break)
- **API errors:** always `{ error: { code, message, details? } }`, via the global Fastify error handler. No stack traces in responses.
- **Web client:** non-2xx responses become an `ApiError` and are shown as a toast automatically. Pass `{ silent: true }` when handling the error inline. Raise UI notifications with `alerts.error|success|info|warning(...)`, which works outside React too.
- **Content-Type:** the client only sets `Content-Type: application/json` when there is a body. Fastify rejects an empty JSON body otherwise.
- **Ports are typed** (`text|number|boolean|object|array|messages|any`, default `any`).
  - Compatibility and coercion rules live **only** in `canConnect` in `shared`. The engine validation, the executor's coercion and the editor's `isValidConnection` all use it.
  - Add new types or rules there, together with their table-driven tests.
- **Secrets are write-only:** the API only returns masked hints. The OpenRouter key is the secret named `openrouter`. The master key comes from env `SECRETS_KEY` or `data/.master.key`.
- **Seeded workflows** ("Default Assistant", "Parallel demo") must keep validating. There's a test for this.
- **Session writes:** always go through the per-session lock and `update`, never `load → await → save`.
  - Messages sent to one session are handled one after another; different sessions run concurrently.
  - Repository writes are atomic: they write a temp file, then rename it.
- **Execution semantics:**
  - A workflow has exactly one Chat Input and **one or more** Chat Outputs. Only nodes that some Chat Output depends on run; the rest are logged as `skipped`.
  - Each Chat Output that runs appends one assistant message. Message order is deterministic: dependency order first, then the output's `order` config, then node id. It never depends on which output finishes first.
  - The speaker name is taken from the connected `character` input if there is one, otherwise from the `name` config, otherwise the message has no name. Messages store a snapshot of `name` plus `characterId`.
  - If no output runs, the turn has no reply and the execution records a warning. On failure, the replies already completed are kept and returned in the error details.
  - `character` is a port data type. The Character node outputs either the session's character or a specific card. A character connected to an LLM node replaces the session character for that node's `{{character.*}}` macros and aliases. The preset input key `character` is reserved.
  - A connected output port that a node doesn't return is an error, unless the port is marked `optional` (Condition branches are).
  - On failure, the sibling nodes in the same wave are aborted and settled (status `cancelled`) before the error is thrown. After that, the execution log must never change.
- **Editor:** never drop nodes. Unknown node types are kept as read-only placeholders and are saved unchanged.
- **Presets:** fixed entries that render to empty text are dropped, so a template entry holding only one variable disappears when that variable is empty.
- **Creating a session** requires a `workflowId`. Sessions also store `characterId` and `personaId`, which the server loads and passes to the executor.
- **Characters/personas:**
  - Card parsing and writing (PNG `tEXt` chunks `ccv3`, which takes precedence, then `chara`; V1/V2/V3 JSON) lives in `apps/server/src/card.ts` and runs on the server.
  - Export writes both `chara` (V2) and `ccv3` (V3), like SillyTavern.
  - Unknown card fields are kept in `extensions` so export round-trips.
- **Macros:** the macro registry in `packages/shared/src/macros.ts` is the single source of truth. The engine resolves macros through it, and the editor hints and preset warnings come from it. Never hand-write hint lists.
  - Macro names are namespaced by source: `{{character.<field>}}`, `{{persona.name|description}}`, `{{input.<key>}}`, `{{trigger.*}}`.
  - Short aliases: `{{char}}`, `{{user}}` (defaults to "User"), `{{description}}`, `{{personality}}`, `{{scenario}}`, and `{{persona}}` (the persona description).
  - `{{char.*}}`/`{{user.*}}` were removed on purpose. Don't add legacy `<BOT>`/`<USER>` or SillyTavern's extra macros unless asked.
  - Matching ignores case.
  - Unknown macros are **left as-is** and produce a preset warning.
  - A known macro with no value renders as empty text.
  - Macros also resolve inside character and persona fields, with protection against cycles.
  - Unknown `{{input.x}}` is a preset validation **error**.
- **Prompt behaviour is chosen by the user:** the engine never applies automatic SillyTavern rules (card system prompt overriding the main prompt, splitting examples at `<START>`, and so on). Users reference fields in their presets themselves.
- **Prompt messages** have an optional `name`, passed through to the provider only when set. This is groundwork for a future "speaker names" option on the history slot.
- **LLM node option** `mergeSystemMessages`: merges consecutive system messages that have no name, after rendering.

## Adding a node type
1. Create `packages/engine/src/nodes/<type>/index.ts` exporting a `NodeDefinition`: `type`, `label`, `category`, typed `inputs`/`outputs` with `dataType` and `description`, zod `configSchema`, `defaultConfig`, and `execute(ctx)`, which returns one key per output port.
2. Register it in `registry.ts`.
3. Add tests in `nodes.test.ts`.
4. The UI picks it up automatically through `/api/node-types`. Add a custom panel in `node-ui` only if the generated form isn't enough.

## Gotchas
- **POC stage, no data migrations:** the data in `apps/server/data` is disposable. On schema changes, don't write migrations; the data can be reset. The exception is `secrets.enc.json` and `.master.key`, which hold the user's API key and must be kept.
- **Never run tests or scripts against `apps/server/data`.** Tests use temp dirs. For live checks, run the server from a temp cwd or against a copy of the data.
- **Seeds must be idempotent:** they only create what's missing, so restarts never duplicate anything.
- **React Flow editor:** keep nodes and edges as **controlled state**. Don't rebuild them from workflow data on every render; that breaks dragging and selection. This was a past bug.
- **Environment:** Windows/PowerShell.
  - Stop processes only by PID. Find them with `Get-NetTCPConnection -LocalPort 3001,5173 -State Listen`.
  - Killing the npm/npx parent leaves node child processes running.
  - `&&` only chains native commands.
- **Tooling:** pnpm isn't installed; use npm. No browser or Playwright is set up yet, so UI changes need a manual check by the user.
- **Verification:** for server changes, a quick live check is to start the server with `npx tsx src/index.ts` in `apps/server` and `curl.exe` the endpoints.
