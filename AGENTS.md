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
- `packages/engine`: graph validation, wave-based parallel executor, templating (Handlebars runtime over the turn context: `{{input.x}}`, `{{trigger.message}}`, `{{history}}`, `{{#if}}`/`{{#each}}` blocks, `(eq …)` comparisons, no code eval). Node types live in `src/nodes/<type>/index.ts` and are registered in `registry.ts`.
  - `prepareWorkflow` (in `prepare.ts`) parses configs, resolves ports and snapshots resources **once**. `validateWorkflow` wraps it, and `executeWorkflow` accepts its result. Prepare again for each turn, and load node resources through the resolvers.
  - Execution failures carry `nodeId`/`nodeType` as data. Never parse error messages.
  - Validation returns structured `ValidationIssue`s (`{ message, edgeId?, nodeIds? }`), not bare strings. Messages are plain language and name nodes via `nodeDisplayName` (`Label #k (type)`); ids travel only in `edgeId`/`nodeIds`, never in the text. The `WORKFLOW_INVALID` error details are `{ workflowId, workflowName, issues }` (see `workflowInvalidDetailsSchema`); the web transport links the toast to the workflow and highlights the offending edge.
- `packages/node-ui`: config forms generated from JSON Schema, custom panels (`src/panels/`), template-variable hints.
  - Panels get catalogs (presets, characters, providers) and `renderLink` through a typed `context` prop. node-ui never imports react-router or the web API clients.
  - Array fields in any shape other than `{key,value}[]` are shown as read-only JSON.
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
  - `pages/<area>/`: components and hooks per page (chat, workflows, entities, presets). Keep files focused, roughly under 250 lines. Page components take explicit, minimal props interfaces (not a whole hook result); the page file is a thin composition.
  - `components/`: shared UI pieces (e.g. `IconButton`). Page-specific styles live next to the page (e.g. `pages/chat/chat.css`), not in `style.css`.
  - Icons: `lucide-react` only. Icon-only buttons need `aria-label` and `title`.
  - Markdown: `react-markdown` + `remark-gfm` with `skipHtml`. Never render raw HTML from message content (no `rehype-raw`).
  - Message edit/delete (`PATCH`/`DELETE /api/sessions/:id/messages/:messageId`) change stored content only and never re-run the workflow.

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
  - The same applies to every mutation of an existing record (characters, personas, avatars): use `update` or the entity lock. Plain `save` is only for creation. Secrets use one store-wide lock.
  - Locks (`storage/lock.ts`) are in-process and **not re-entrant**: never acquire the same key inside its own critical section, or it deadlocks.
  - Messages sent to one session are handled one after another; different sessions run concurrently.
  - Repository writes are atomic: they write a temp file, then rename it. The rename retries transient Windows `EPERM`/`EACCES`/`EBUSY` errors.
- **Execution semantics:**
  - A workflow has exactly one Chat Input and **one or more** Chat Outputs. Only nodes that some Chat Output depends on run; the rest are logged as `skipped`.
  - Each Chat Output that runs appends one assistant message. Message order is deterministic: dependency order first, then the output's `order` config, then node id. It never depends on which output finishes first.
  - The speaker name is taken from the connected `character` input if there is one, otherwise from the `name` config, otherwise the message has no name. Messages store a snapshot of `name` plus `characterId`.
  - If no output runs, the turn has no reply and the execution records a warning. On failure, the replies already completed are kept and returned in the error details.
  - `character` is a port data type. The Character node outputs either the session's character or a specific card. A character connected to an LLM node replaces the session character for that node's `{{character.*}}` macros and aliases. The preset input key `character` is reserved.
  - A connected output port that a node doesn't return is an error, unless the port is marked `optional` (Condition branches are).
  - On failure, the sibling nodes in the same wave are aborted and settled (status `cancelled`) before the error is thrown. The wait for them is bounded by their original deadline; work that ignores the abort is left running detached and ignored. After that, the execution log must never change.
  - `onEvent` observers can never change the outcome: their exceptions are swallowed.
- **Editor:** never drop nodes. Unknown node types are kept as read-only placeholders and are saved unchanged.
- **Presets:** fixed entries that render to empty text are dropped, so a template entry holding only one variable disappears when that variable is empty.
- **Creating a session** requires a `workflowId`. Sessions also store `characterId` and `personaId`, which the server loads and passes to the executor.
- **Characters/personas:**
  - Card parsing and writing (PNG `tEXt` chunks `ccv3`, which takes precedence, then `chara`; V1/V2/V3 JSON) lives in `apps/server/src/card.ts` and runs on the server.
  - Export writes both `chara` (V2) and `ccv3` (V3), like SillyTavern.
  - Unknown card fields are kept in `extensions` so export round-trips.
- **Templates are Handlebars:** preset content and template-taking node configs are rendered with the `handlebars` runtime (`noEscape: true`) over a data object built from the turn context. Blocks (`{{#if}}`, `{{#each}}`), `{{else}}`, subexpression comparisons (`{{#if (eq character.name "x")}}`), and `{{! comments}}` are supported; the exact syntax and helper list are documented in the README.
  - The macro registry in `packages/shared/src/macros.ts` still defines every available path, and the helper list lives next to it. Preset validation walks the parsed AST, so editor hints and warnings stay in sync with what renders. Never hand-write hint lists.
  - Macro names are namespaced by source: `{{character.<field>}}`, `{{persona.name|description}}`, `{{input.<key>}}`, `{{trigger.*}}`.
  - Short aliases: `{{char}}`, `{{user}}` (defaults to "User"), `{{description}}`, `{{personality}}`, `{{scenario}}`, and `{{persona}}` (the persona description).
  - `{{char.*}}`/`{{user.*}}` were removed on purpose. Don't add legacy `<BOT>`/`<USER>` or SillyTavern's extra macros unless asked.
  - Templates are **case-sensitive** (stock Handlebars resolution).
  - Unknown macros render as **empty text** (stock Handlebars). Unknown paths in enabled entries still produce a preset warning.
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
   - If the definition has `resolvePorts`, its descriptor gets `dynamicPorts: true`, and the editor resolves inputs and outputs for it. Never add per-type branches in the web app.
   - After handles change, refresh React Flow's node internals.
   - Edges to ports that disappear are **pruned** (the connection is dropped) once the node's ports resolve without them. Pruning only happens when the ports resolved successfully: unknown types and failing resolvers keep their edges.
   - The same prune rule lives in the engine (`pruneInvalidEdges`) and runs on preset update and workflow save; the editor applies it when a dynamic node's ports re-resolve. Prune the handle, never the node.

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
- **Line endings:** the repo has no `.gitattributes`, so on Windows with `core.autocrlf=true` checkouts land as CRLF and repo-wide `biome check` fails on files nobody touched. Don't reformat unrelated files to fix it; normalize line endings only in files your own commit touches.
- **Verification:** for server changes, a quick live check is to start the server with `npx tsx src/index.ts` in `apps/server` and `curl.exe` the endpoints.

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
