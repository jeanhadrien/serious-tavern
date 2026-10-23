# AGENTS.md 

This file holds what applies to every task. Each area of the code has its own `AGENTS.md` with the contracts of that area. You are responsible to update them when making modifications. 

## Before you start
- `PLAN.md` is the vision. `docs/dev/ARCHITECTURE.md` is the overview of the code; `docs/dev/reference/` explains each area in detail (read the file for the area you touch). `README.md` should remain a short user-facing entry point.
- **Read the `AGENTS.md` of every area you will touch before you plan**, not only before you edit. An area's file loads on its own only once a file inside it is read, which can be too late for a plan. The areas:
  - `packages/shared/`, with `src/state/` (story state), `src/links/` (message links), `src/conversation/` (prompt messages, threads)
  - `packages/engine/`, with `src/nodes/` (node types), `src/nodes/llm/` (the LLM node), `src/providers/` (LLM adapter), `src/tools/` (tool loop)
  - `packages/node-ui/`
  - `apps/server/`, with `src/services/` (turns, runs, story state, alternatives, fork)
  - `apps/mcp/` (the MCP server for external agents)
  - `apps/web/`, with `src/pages/chat/`, `src/pages/chat/story/`, `src/pages/workflows/`, `src/pages/stateDefinitions/`
- Docs: `docs/*.md` are **user guides**; keep them in sync when user-visible behaviour changes. `docs/dev/` is **technical**: `ARCHITECTURE.md` (the overview), `reference/` (how each area works; update it with the code), `TOOLING.md`, `design/` (the agreed web layout and UX references, `FRONTEND-LAYOUT.md` and `FRONTEND-UX.md`), `plans/` (plans for work not built yet: once built, move what they decided into `reference/` and the `AGENTS.md` files, then delete them) and `explorations/` (research and design proposals).

## What this is
A chatbot web app. Each chat reply comes from a user-built workflow of nodes, edited visually in an n8n-style editor. The frontend is a **thin client**: all storage, secrets and workflow execution live in the backend.

The core model, used everywhere:
- **Turn:** one firing of a chat's reply list (a sent message, an empty send or a regenerate). Its id is the first run's `executionId`, and every message of the turn carries it.
- **Run:** one workflow execution inside a turn, with its own execution log (`runId`). The reply list runs top down; the **reply section** ends at the last workflow with a Chat Output, and the workflows below it form the **after section**, which runs after the reply in the same queue slot.
- **Story state:** per-chat state that turns write. It lives exactly as long as the replies of the turn that wrote it. The fold in shared is its only interpreter.
- **Message links:** a collection item may link to chat messages by id (that is how summaries work).
- **Alternatives** (regenerate, swipes): each alternative is an ordinary turn; the replies of the hidden ones carry `inactive: true`.
- **Fork:** a new chat copied from another, cut after a reply.
- **Chat settings** are per chat and declared by workflows; **app settings** are app-wide.

## Working conventions
- **Commits:** one feature per commit. Commit any pending changes before starting new work. `npm run check` must pass before every commit.
- **PLAN.md is owned by the user.** Don't modify or delete it unless asked.
- **Where knowledge goes:** a new convention, contract or gotcha goes into the `AGENTS.md` of the area where it would be broken (create one for a new area and list it above). This file only gets rules that hold everywhere. A rule about one module is often better as a comment in that module. Explanations of how the code works go to `docs/dev/reference/` (and `ARCHITECTURE.md` when the big picture changes), user-visible behaviour to the user guides in `docs/*.md`. Keep `README.md` minimal.
- **What an AGENTS.md line is for:** rules the code can't show by itself (invariants, "never", "only through", the reason behind a choice). Don't record where code lives: CodeGraph answers that.
- **Scope:** keep it modular and simple.

## Layout
npm workspaces, TypeScript strict, ESM, packages consumed as TS source.
- `packages/shared`: zod schemas, types and the pure rules every side shares. It is the single source of truth for front and back.
- `packages/engine`: graph validation, the wave-based parallel executor, Handlebars templating, node types, LLM adapters.
- `packages/node-ui`: node config forms generated from JSON Schema, custom panels, template hints.
- `apps/server`: Fastify 5 on port 3001 (run with `tsx`). File storage under `data/` (gitignored), AES-256-GCM secrets.
- `apps/mcp`: a stdio MCP server, a generic projection of the API contract that calls the running server over HTTP.
- `apps/web`: React 19 + Vite on port 5173, proxying `/api` to the server.

## Commands
- `npm run dev`: server and web together (`scripts/dev.mjs`). It takes the first free ports from 3001 and 5173, so several checkouts run side by side, and prints the URL. `DATA_DIR` picks the data folder; a **git worktree** defaults to the **main checkout's** `apps/server/data`.
- `npm run typecheck`, `npm test` (vitest, all packages), `npm run build` (typecheck and web build).
- **`npm run check`** runs Biome (format and lint, without writing), typecheck, tests and knip in about 7 seconds.
  - `npm run fix` applies Biome formatting and safe lint fixes.
  - knip reports unused files, exports and dependencies. Delete dead code; configure `knip.json` only for real false positives.
  - Tuned lint rules and their reasons are in `docs/dev/TOOLING.md`. Don't disable more rules without a reason.
  - Large mechanical reformats go in their own `style:` commit, which is added to `.git-blame-ignore-revs`.

Note: run tests sparringly as they are slow and long.

## Contracts that hold everywhere
- **A rule has one home.** When shared holds a rule (port compatibility, the story state fold, link status, the fork cut, `activeMessages`, settings resolution...), the engine, the server, node-ui and the web all call it. Never copy or re-implement it.
- **API contract:** `packages/shared/src/api/` holds the method, path and zod schemas (request and response) of every endpoint. It is the only definition of the API.
  - To add or change an endpoint, update the contract first. The server registers its route from the contract (`route(app, 'key', handler)`: a path is never written twice), parses its input with it and types its response from it; the web client uses the same types.
  - Don't declare request or response types locally, and don't put inline `z.object` schemas in routes.
  - A new endpoint also needs a decision in `apps/mcp/src/expose.ts` (expose or skip, forced by typecheck); give it a `description` written for an agent if it is exposed.
  - Server tests check responses against the contract schemas, and `app.test.ts` requires every contract endpoint to be exercised: a new contract entry, its route and its test land in the same commit.
- **API errors** are always `{ error: { code, message, details? } }`, through the global Fastify error handler. No stack traces in responses.
- **Data travels as data:** errors and validation issues carry ids (`nodeId`, `edgeId`, ...) in fields. Messages are plain language and never contain ids; never parse a message.
- **Ports are typed** (`text|number|boolean|object|array|messages|any`, default `any`). Compatibility rules live **only** in `canConnect` in shared and the conversion only in `coerceValue` beside it; the engine's validation, the executor's coercion and the editor's `isValidConnection` all use it. Add new types or rules there, with their table-driven tests.
- **Secrets are write-only:** the API only returns masked hints. The master key comes from env `SECRETS_KEY` or `data/.master.key`. Never log a secret, and never send a provider's key to any host but its `baseUrl`.
- **The chat is the active messages:** every reader of a session's messages that means "the chat" (history, rendering, counts, edits) goes through `activeMessages`, which leaves out the replies of hidden alternatives.
- **Data compatibility (alpha):** user data under `data/` is preserved across upgrades.
  - Schema changes are additive and backward compatible: unknown fields survive via `passthrough`, new optional fields use `.default()`/`.optional()`/`.catch()`, writes migrate on write (normalize with `safeParse` and defaults, keep unknown fields, no destructive rewrites).
  - JSON records (sessions, workflows, characters, ...) are **not parsed on read**: read them tolerantly through their read helpers, and give their new fields `.optional()`, not `.default()`, since a default never applies to a raw record.
  - A breaking change needs an explicit migration script plus a backup step.
  - Seeds only create what's missing: they never duplicate and never overwrite user-modified records.
  - Corrupt files are never deleted automatically.

## Gotchas
- **Never reset or delete `data/`**, and never run tests or scripts against `apps/server/data`. Tests use temp dirs. For live checks, run the server against a copy of the data. **`npm run dev` in a worktree uses the real data unless `DATA_DIR` is set**, so an agent always sets it to a copy (or an empty temp dir). The manual way:
  - Run `node <repo>/node_modules/tsx/dist/cli.mjs <repo>/apps/server/src/main.ts` with `DATA_DIR` set to the copy and `PORT` set to a free port. `node --import tsx` fails from a temp cwd because tsx doesn't resolve there.
  - Delete the copy afterwards: it holds the encrypted secrets and the master key.
- **Environment:** Windows/PowerShell.
  - Stop processes only by PID. Find them with `Get-NetTCPConnection -LocalPort 3001,5173 -State Listen`. Killing the npm/npx parent leaves node child processes running.
  - `&&` only chains native commands.
- **Windows 8.3 short paths:** `fs.watch` on a directory given by its short name (e.g. `C:\Users\JEANHA~1\...`, what `os.tmpdir()` returns here) kills the process with a libuv assertion. Watch `fs.promises.realpath(dir)`.
- **Case-only file name clashes:** on Windows, sibling files that differ only by case (`ModelPicker.tsx` and `modelPicker.ts`) fail typecheck with TS1261. Pick distinct names.
- **Git worktrees:** `@st/*` resolves through `node_modules/@st` links. Without the worktree's own links, the packages resolve to the main checkout, so tests and typecheck silently use the wrong `shared`. Create junctions for `shared`, `engine` and `node-ui` inside the worktree's `node_modules/@st`.
- **Nested worktrees break Biome:** a leftover worktree under `.claude/worktrees/` (it contains its own `biome.json`) makes `biome check .` fail on the main checkout with "nested root configuration". Remove finished worktrees: unlink their `node_modules/@st` junctions first (`[System.IO.Directory]::Delete(path, $false)`), then `git worktree remove`.
- **Tooling:** pnpm isn't installed; use npm. The user's Windows machine has no browser automation set up, so UI changes there need a manual check by the user. Cloud containers have Chromium and Playwright at `/opt/pw-browsers` (never run `playwright install`).
- **Line endings:** `.gitattributes` pins text files to LF (`* text=auto eol=lf`). Write new files with LF; don't mass-reformat unrelated files.

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
