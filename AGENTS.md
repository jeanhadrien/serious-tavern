# AGENTS.md — notes for AI agents working on this repo

Read `PLAN.md` for the vision and `README.md` for usage and architecture before making changes.

## What this is
A chatbot web app. Each chat reply comes from a user-built workflow of nodes, edited visually in an n8n-style editor. The frontend is a **thin client**: all storage, secrets and workflow execution live in the backend.

## Workflow conventions
- **Orchestration:** the main assistant acts as the orchestrator. It delegates substantial coding to a coding sub-agent (gpt-6-sol), then **verifies the work itself** before reporting back.
- **PLAN.md is owned by the orchestrator/user.** Coding agents must not modify or delete it; they update `README.md` for technical docs.
- **Commits:** commit each feature separately. Include the trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`. Commit any pending changes before starting new work.
- **Scope:** keep it modular and simple. Prefer no new dependencies; justify any you add.

## Layout (npm workspaces, TypeScript strict, ESM, packages consumed as TS source)
- `packages/shared`: zod schemas and types (workflow, ports, `canConnect` compatibility and coercion rules). This is the single source of truth for both front and back.
- `packages/engine`: graph validation, wave-based parallel executor, templating (`{{input.x}}`, `{{trigger.message}}`, `{{history}}`, no code eval). Node types live in `src/nodes/<type>/index.ts` and are registered in `registry.ts`.
- `packages/node-ui`: config forms generated from JSON Schema, custom panels, template-variable hints.
- `apps/server`: Fastify 5 on port 3001 (run with `tsx`). JSON-file storage under `data/` (gitignored, atomic writes). AES-256-GCM secrets. Global error handler.
- `apps/web`: React 19 + Vite on port 5173, proxying `/api` to the server.
  - `api.ts`: API client; throws `ApiError`.
  - `alerts/`: toast store and `<Toaster/>`.
  - `connection.ts`: `isValidConnection`.
  - `pages/`: Chat, Workflows (the editor), Settings.

## Commands
- `npm run dev`: server and web together.
- `npm run typecheck`, `npm test` (vitest, all packages), `npm run build` (typecheck and web build).
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
- **Creating a session** requires a `workflowId`.

## Adding a node type
1. Create `packages/engine/src/nodes/<type>/index.ts` exporting a `NodeDefinition`: `type`, `label`, `category`, typed `inputs`/`outputs` with `dataType` and `description`, zod `configSchema`, `defaultConfig`, and `execute(ctx)`, which returns one key per output port.
2. Register it in `registry.ts`.
3. Add tests in `nodes.test.ts`.
4. The UI picks it up automatically through `/api/node-types`. Add a custom panel in `node-ui` only if the generated form isn't enough.

## Gotchas
- **React Flow editor:** keep nodes and edges as **controlled state**. Don't rebuild them from workflow data on every render; that breaks dragging and selection. This was a past bug.
- **Environment:** Windows/PowerShell.
  - Stop processes only by PID. Find them with `Get-NetTCPConnection -LocalPort 3001,5173 -State Listen`.
  - Killing the npm/npx parent leaves node child processes running.
  - `&&` only chains native commands.
- **Tooling:** pnpm isn't installed; use npm. No browser or Playwright is set up yet, so UI changes need a manual check by the user.
- **Verification:** for server changes, a quick live check is to start the server with `npx tsx src/index.ts` in `apps/server` and `curl.exe` the endpoints.
