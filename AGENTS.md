# AGENTS.md — notes for AI agents working on this repo

Read `PLAN.md` for the vision and `README.md` for usage and architecture before making changes.
For web layout work, `docs/FRONTEND-LAYOUT.md` is the agreed design reference.

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
- **Scope:** keep it modular and simple. 

## Layout (npm workspaces, TypeScript strict, ESM, packages consumed as TS source)
- `packages/shared`: zod schemas and types (workflow, ports, `canConnect` compatibility and coercion rules). This is the single source of truth for both front and back.
- `packages/engine`: graph validation, wave-based parallel executor, templating (Handlebars runtime over the turn context: `{{input.x}}`, `{{trigger.message}}`, `{{history}}`, `{{#if}}`/`{{#each}}` blocks, `(eq …)` comparisons, no code eval). Node types live in `src/nodes/<type>/index.ts` and are registered in `registry.ts`.
  - `prepareWorkflow` (in `prepare.ts`) parses configs, resolves ports and snapshots resources **once**. `validateWorkflow` wraps it, and `executeWorkflow` accepts its result. Prepare again for each turn, and load node resources through the resolvers.
  - Execution failures carry `nodeId`/`nodeType` as data. Never parse error messages.
  - Validation returns structured `ValidationIssue`s (`{ message, edgeId?, nodeIds? }`), not bare strings. Messages are plain language and name nodes via `nodeDisplayName` (`Label #k (type)`); ids travel only in `edgeId`/`nodeIds`, never in the text. The `WORKFLOW_INVALID` error details are `{ workflowId, workflowName, issues }` (see `workflowInvalidDetailsSchema`); the web transport links the toast to the workflow and highlights the offending edge.
- `packages/node-ui`: config forms generated from JSON Schema, custom panels (`src/panels/`), template-variable hints.
  - Panels get catalogs (presets, characters, providers) and `renderLink` through a typed `context` prop. node-ui never imports react-router or the web API clients.
  - Array fields in any shape other than `{key,value}[]` are shown as read-only JSON.
  - The generic form shows a field's zod `.describe()` text as a hint, and a cleared number field is stored as unset (`undefined`), so optional numbers can fall back to a node's own default (Random's per-mode bounds).
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
  - `stores/`: shared list stores (`createListStore`, read with `useList`) for workflows, presets, characters, personas and sessions. They re-fetch on their change event. Pages read lists from them and never keep their own copies. After a local write, call `store.refresh()` to read your own write. Drafts and the open chat session stay local state that a list refresh never touches.
  - `layout/`: the three-column shell (design in `docs/FRONTEND-LAYOUT.md`).
    - `state.ts` is a pure reducer: slot rules, wide vs narrow editors, compact mode, phone mode (compact mode shown one column at a time: `mobile`, `pane`), dirty flags. `derive.ts` maps it to view placements and header icons. Change rules there, with tests, never in components.
    - `Shell.tsx` mounts **every view exactly once, in the fixed `VIEW_KEYS` order**. Moving a view only changes its `grid-area`, and hiding it sets `hidden`, so nothing remounts (streams, drafts, canvases survive). Never render a view conditionally or in a different position.
    - `useChat` lives in the shell, so it re-renders on every streamed token. Views that take no props are module-level constants (`STATIC_VIEWS`) so React skips them. Keep new views stable the same way, or memoize them.
    - Providers (`list:providers`, `editor:providers`) are a narrow editor with its list in **L**; characters and personas have theirs in R.
    - A resource's list (a side column) and its editor (M or its own column) are separate views that share an **editor store** (`stores/editorStore.ts`). The store holds the open id and dirty flag, plus the list's `open`/`discard` requests, which the editor applies through `useEditorCommands`. The draft itself stays inside the always-mounted editor. Views reach layout actions through `LayoutActions` context, and dirty flags reach the header dots via `useDirtySync`.
    - **The layout lives in the URL** (`/?session=…&left=…&wide=preset:<id>&right=character:<id>`, defaults omitted). A narrow editor open in L is `left=<name>:<id>` (only `provider:<id>` so far); `LayoutTarget.leftEditorOpen` and `LayoutUrl.leftId` are the L twins of the R fields, and `sameContent` compares both. The pure (de)serializers are in `layout/url.ts`, and `useLayoutUrl` syncs both directions. Content changes `push`; tab switches and corrections `replace`. Build in-app links with `layoutHref`. Legacy paths (`/presets?id=…`, `/workflows?workflow=…&edge=…`, `/characters`, …) stay as inbound aliases in `layout/routes.ts`, because node-ui's "Edit preset" link still emits one. History navigation never discards a dirty draft or switches a streaming chat.
    - Live checks in the built-in browser pane: when the app window isn't in front, the pane has a 0px viewport, never paints, and ResizeObservers don't fire. Force a size with `resize_window`, and don't trust React Flow measurements or screenshots there.
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
- **LLM providers are records, not code:** a provider record (`providerSchema` in `packages/shared/src/provider.ts`) is a YAML file under `data/providers/`, stored by `ProviderRepository`, a thin subclass of the generic `YamlRepository<T>` that presets also use (`storage/yaml-repository.ts`: a `YamlCodec` supplies parse/serialize/label; the scan, stamping, locks and file naming are shared, so fix them there once).
  - Built-in providers (`builtInProviders`: OpenRouter with id/secret `openrouter`, abliteration.ai with id/secret `abliteration`) live in code, are never stored and are read-only (`409 PROVIDER_READ_ONLY` on PUT/DELETE). Adding one is a new array entry plus the server tests that list built-ins; check the backend's request schema first (abliteration.ai rejects unknown body fields). Stored ids are UUIDs, so a file claiming a built-in id is invalid by schema. Provider route params are `{ id: string }`, not `idParamsSchema`, because of that id. `services/providers.ts` merges built-in and stored records (`builtIn` flag) and strips client bookkeeping (`id`, timestamps, `builtIn`) from bodies.
  - The LLM node resolves its record through `ctx.resources.providers` (snapshotted by `prepareWorkflow`, built-in ids resolved by the engine itself), then picks the `LlmAdapter` for the record's `kind` from the `adapters` map and passes it the record. Unknown id is a node error; a set-but-missing `secret` is the "Missing <secret> secret" error; no `secret` means no key and no `Authorization` header. Never send a record's key to a host other than its `baseUrl`.
  - Tests inject fake LLMs by replacing the `openai-compatible` adapter (`useAdapter`/`restoreAdapter`: `packages/engine/src/test-providers.ts`, `apps/server/src/test-support/adapter.ts`), not by registering provider ids.
  - The single `openai-compatible` adapter (`providers/openai-compatible.ts`) is record-driven: `resolveWireSettings` (`providers/wire-settings.ts`) applies the first matching override per model. An override's `messageName: null` must win over the provider's value, so never resolve it with `??`. `extraBody` is merged last and wins over every computed field. Streamed `raw` always reports reasoning as `message.reasoning`, whatever wire field it came from. Don't add per-backend branches to the adapter; new wire differences become record fields (PLAN.md).
  - node-ui's provider dropdown takes `{ id, name }` and shows an "Unknown provider (id)" entry when the node's id has no record. User-facing guide: `docs/PROVIDERS.md` (keep it in sync when provider behaviour changes).
  - **Model lists:** `GET /api/providers/:id/models` goes through the adapter's optional `listModels` (`openai-compatible`: `GET <baseUrl>/models`, normalized by `normalizeModels` in `shared`, one generic path, no backend branches). `ModelCatalog` (`services/provider-models.ts`) caches in memory only. Its cache key is the whole record plus `SecretStore.revision`, never `updatedAt`: files edited by hand keep their old timestamp. Any new cache whose data depends on secrets should key on `revision` too. `missingSecretMessage` (engine) is the single source of the missing-secret text. The LLM node's model field stays a plain string; the picker (`ModelPicker`, pure logic in `modelOptions.ts`) only suggests, through `context.loadModels`.
- **Seeded workflows** ("Default Assistant", "Parallel demo") must keep validating. There's a test for this.
- **Data compatibility (alpha):** user data under `data/` is preserved across upgrades. Schema changes are additive and backward compatible: unknown fields survive via `passthrough`, new optional fields use `.default()`/`.optional()`/`.catch()`, writes migrate-on-write (normalize with `safeParse` + defaults, keep unknown fields, no destructive rewrites). If a breaking change is unavoidable, ship an explicit migration script plus a backup step. Seeds only create missing records and never overwrite user-modified ones. See README Data and secrets.
- **Session writes:** always go through the per-session lock and `update`, never `load → await → save`.
  - The same applies to every mutation of an existing record (characters, personas, avatars): use `update` or the entity lock. Plain `save` is only for creation. Secrets use one store-wide lock.
  - Locks (`storage/lock.ts`) are in-process and **not re-entrant**: never acquire the same key inside its own critical section, or it deadlocks.
  - Messages sent to one session are handled one after another; different sessions run concurrently.
  - Repository writes are atomic: they write a temp file, then rename it. The rename retries transient Windows `EPERM`/`EACCES`/`EBUSY` errors.
- **Recency ordering:** the preset, workflow and chat lists are ordered most-recent-first with the shared `compareRecent` comparator (`apps/web/src/pages/recentOrder.ts`: `updatedAt` desc, then `createdAt` desc, then name). Session `updatedAt` means last message activity: only sending a message advances it; message edit/delete and session metadata patches leave it unchanged.
- **Execution semantics:**
  - A workflow has exactly one Chat Input and **one or more** Chat Outputs. Only **sinks** (definitions with `sink: true`; Chat Output is the only one so far, State Write and Save Summary will be) and the nodes they depend on run; the rest are logged as `skipped` ('not needed by any output'). A sink alone doesn't make a workflow valid (at least one Chat Output is still required), and replies still come only from Chat Outputs. Descriptors carry `sink`.
  - Each Chat Output that runs appends one assistant message. Message order is deterministic: dependency first (output Y precedes X when Y's transitive upstream node set is a strict subset of X's, which covers outputs fed by a shared upstream node), then the `order` config only as a priority among outputs with no remaining predecessor, then node id. It never depends on which output finishes first.
  - The speaker name is taken from the connected `character` input if there is one, otherwise from the `name` config, otherwise the message has no name. Messages store a snapshot of `name` plus `characterId`.
  - If no output runs, the turn has no reply and the execution records a warning. On failure, the replies already completed are kept and returned in the error details.
  - `character` is a port data type. The Character node outputs either the session's character or a specific card. A character connected to an LLM node replaces the session character for that node's `{{character.*}}` macros and aliases. The preset input key `character` is reserved.
  - A connected output port that a node doesn't return is an error, unless the port is marked `optional` (Condition branches are).
  - On failure, the sibling nodes in the same wave are aborted and settled (status `cancelled`) before the error is thrown. The wait for them is bounded by their original deadline; work that ignores the abort is left running detached and ignored. After that, the execution log must never change.
  - `onEvent` observers can never change the outcome: their exceptions are swallowed.
  - `ctx.log(message)` appends to `nodes[id].logs` (ignored once the node settled, like `recordWire`). Nodes log what a user needs to debug a failure, e.g. Parse JSON's raw input, truncated to 500 characters.
  - **Randomness:** every run has a seed, `executeWorkflow`'s `seed` option or a `randomUUID()` the engine generates, recorded as `execution.seed`. Nodes draw random numbers only through `ctx.random()` (a deterministic sfc32 stream seeded by cyrb128 of `${seed}:${nodeId}`, `packages/engine/src/random.ts`), **never `Math.random`**: the same seed and node id give the same sequence, so a run's rolls can be reproduced from its log. The algorithm is pinned by a golden test; changing it breaks reproducing old runs. A later post-turn run must use a derived seed (e.g. `${seed}:post`), or nodes that run in both parts repeat the same rolls.
  - **Timeouts:** the executor applies a wall-clock deadline per node (`definition.timeoutMs`, default 30s). Nodes whose work is a network call own their real timeout (LLM providers use an idle timeout between stream chunks; http-request uses its `timeoutMs` config) and declare a 10 min `timeoutMs` as a backstop only.
- **Empty sends:** `content` may be empty (or omitted) on `sendMessage`/`streamTurn`. No user message is stored, `userMessage` is absent from the result and failure details, and the turn runs on the session history with `trigger.message` set to `''`. Whether that produces a reply is up to the workflow (empty text slots are dropped). Editing a message to empty stays rejected (`editMessageSchema`).
- **Streaming turns:** the web client sends messages through `POST /api/sessions/:id/messages/stream` (SSE, `turnEventSchema`); the plain `POST .../messages` stays for non-streaming callers.
  - Stop is `POST .../stop` only: the stream stays open and ends with `turn.error` `TURN_STOPPED`. Failed and stopped turns carry `turnFailureDetailsSchema` in `details` (saved user message, replies so far as `partial` rows, execution), so the client settles from the payload and never guesses with a refetch. Aborting the fetch is a fallback only; it is seen by the server as a `disconnect`.
  - `streamMessage` (`apps/web/src/api/turnStream.ts`) never toasts; `useChat` decides, via `notifyError`.
  - Local row bookkeeping lives in the pure helpers of `pages/chat/turnMessages.ts`. Rows with `status: 'streaming'` are local until the turn settles.
- **Editor:** never drop nodes. Unknown node types are kept as read-only placeholders and are saved unchanged.
- **Presets:** fixed entries that render to empty text are dropped, so a template entry holding only one variable disappears when that variable is empty.
  - **`displayName` vs `name`:** every entry's editor label is the required `displayName`. A message entry's optional `name` is a template rendered like `content`, trimmed, and sent as `PromptMessage.name` only when non-empty. Slots have no `name`. Name templates are validated like content (path `['entries', i, 'name']`); use `entryTemplates`/`entryUsesInput` from `shared` instead of reading `content` alone.
  - **Legacy rule:** an entry with `name` and no `displayName` is a pre-`displayName` entry: its `name` is the label and it has no message name. `upgradeLegacyPreset` (shared) applies this to **raw** data before schema validation, in the YAML loader (`presetCandidate`) and the JSON migration only. Never put it in the zod schema (`z.preprocess` erases the input type the web client relies on) or apply it to API write bodies. Files keep the old shape until their next save.
  - Entry types are `passthrough`, so a stray `name` key compiles anywhere. When building or copying entries, set `displayName`; a leftover `name` silently becomes a message name.
  - **Imported presets** carry a server-owned `source`. Client writes never set it, `PUT` on a preset with one returns 409 `PRESET_READ_ONLY`, and only `services/import/sync.ts` writes it, under `context.importLock`. New connectors implement `ImportConnector` in `services/import/`.
  - The stored `source.hash` covers the connector's `mapperVersion` as well as the file bytes. Any change to a mapper's output for the same input must bump `mapperVersion`, or Sync reports the files as unchanged and never applies it.
  - **Storage is YAML, not JSON:** presets live in `data/presets/<slug-of-name>.yaml` through `PresetRepository` (`storage/preset-repository.ts`). Identity is the `id` inside the file, never the filename. Users may edit or rename files while the server runs, so nothing is cached and every operation scans the directory.
    - Legacy `<id>.json` files are renamed to `.json.migrated` at startup after their YAML is verified. Never delete them.
    - Invalid files are skipped with a warning and never modified. A valid file without `id`/timestamps gets them stamped in place.
    - UUID entry and input ids are not stored: they are re-derived as `entry-<n>`/`input-<n>` on read, and depth-target slots get a readable label id. Never rely on UUID entry ids surviving a save.
    - Mutations go through the id lock and `update`, as with every repository.
  - **Live reload:** a debounced `fs.watch` on the presets directory feeds `GET /api/events` (SSE, `changeEventSchema` in the shared contract). Event `presets.changed` carries the currently invalid files. The watcher is started only from `main.ts` (`createApp(dir, { watch: true })`), never from `createContext`.
    - The web editor never overwrites a dirty draft and keeps the selected entry by position, because entry ids are re-derived on read.
    - New SSE routes that must not block `app.close()` end their streams in the Fastify `preClose` hook, not `onClose`.
- **Change events (`GET /api/events`):** besides `presets.changed`, the server emits `workflows|characters|personas|sessions.changed` (`{ type, id? }`).
  - They come from `NotifyingRepository` (`services/change-events.ts`), which wraps those repositories in `context.ts` and announces every successful save, update and delete. New write paths are covered automatically. A new record resource gets wrapped there too.
  - `repo.silent` is the raw repository. Chat turns write through it and publish one `sessions.changed` when the turn settles, never per token.
  - Tests that spy on a repository's `get` to pause inside `update` must spy on `.silent`.
  - On connect, every event type is sent once (id-less for records) so clients resync.
  - `providers.changed` has the presets shape (`invalidFiles`). It comes from the `data/providers/` watcher (`watchResourceFiles`, started with the preset one in `app.ts` only when `watch` is on) **and** from `services/providers.ts` after every API write (`publishFileChange`). Always publish with a fresh `listInvalid()`, never `[]`, or an API save clears the warning about a still-broken file. Tests of API-write events use an app without the watcher, which would announce each write twice.
  - Because provider API writes announce **before** the HTTP response, an editor's live sync can see its own save or delete before the response arrives. The provider editor classifies through that (`classifyProviderChange`: a dirty draft the disk already holds is a reload; its own delete is not "removed from disk"). Never assume the response comes first.
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
- **Prompt messages** have an optional `name`, passed through to the provider only when set. Preset message entries set it from their `name` template; messages slots carry the history's names. A future "speaker names" option on the history slot builds on this.
- **LLM node option** `mergeSystemMessages`: merges consecutive system messages that have no name, after rendering.
- **Wire log:** an LLM node logs what actually went over the wire in `nodes[id].wire` (`wireExchangeSchema`: `url`, `method`, redacted `headers`, the exact `body` object given to `fetch`, `status`, `response`; a stream's chunks are folded under the backend's own field names).
  - Adapters report it through `ChatOptions.onWire` (the node passes `ctx.recordWire`): once before `fetch`, again with the response. Each report replaces the last, so a failed call keeps what was sent.
  - Redaction happens **inside the adapter**, before the callback (`providers/wire-log.ts`): credential-looking header names are masked and the secret value is scrubbed everywhere, including the adapter's thrown error messages (they reach `nodes[id].error` and toasts). Never hand an unredacted exchange out of the adapter.
  - The canonical `request` field exists only in older logs. Keep it parseable and displayed as a fallback.
  - Non-stream reasoning: after `chat`, the LLM node emits `ChatResponse.reasoning` as one `reasoningDelta`, so it reaches the chat like streamed reasoning. Never emit it on the stream path, or it doubles.

## Adding a node type
1. Create `packages/engine/src/nodes/<type>/index.ts` exporting a `NodeDefinition`: `type`, `label`, `category`, typed `inputs`/`outputs` with `dataType` and `description`, zod `configSchema`, `defaultConfig`, and `execute(ctx)`, which returns one key per output port.
   - Set `sink: true` only for nodes that must run even when no Chat Output depends on them (they write somewhere).
2. Register it in `registry.ts`.
3. Add tests in `nodes.test.ts`.
4. The UI picks it up automatically through `/api/node-types`. Add a custom panel in `node-ui` only if the generated form isn't enough.
   - If the definition has `resolvePorts`, its descriptor gets `dynamicPorts: true`, and the editor resolves inputs and outputs for it. Never add per-type branches in the web app.
   - After handles change, refresh React Flow's node internals.
   - Edges to ports that disappear are **pruned** (the connection is dropped) once the node's ports resolve without them. Pruning only happens when the ports resolved successfully: unknown types and failing resolvers keep their edges.
   - The same prune rule lives in the engine (`pruneInvalidEdges`) and runs on preset update and workflow save; the editor applies it when a dynamic node's ports re-resolve. Prune the handle, never the node.

## Gotchas
- **Alpha stage, user data is preserved:** never reset or delete `data/`; schema changes must be additive + backward compatible (see Key contracts). Corrupt JSON files are never auto-deleted (`list()` skips with a warning, `get()` throws with the file path).
- **Never run tests or scripts against `apps/server/data`.** Tests use temp dirs. For live checks, run the server from a temp cwd or against a copy of the data.
- **Seeds must be idempotent and non-destructive:** they only create what's missing, so restarts never duplicate anything and never overwrite user-modified records.
- **React Flow editor:** keep nodes and edges as **controlled state**. Don't rebuild them from workflow data on every render; that breaks dragging and selection. This was a past bug.
- **Environment:** Windows/PowerShell.
  - Stop processes only by PID. Find them with `Get-NetTCPConnection -LocalPort 3001,5173 -State Listen`.
  - Killing the npm/npx parent leaves node child processes running.
  - `&&` only chains native commands.
- **Git worktrees:** `@st/*` resolves through `node_modules/@st` links. Without the worktree's own links, the packages resolve to the main checkout, so tests and typecheck silently use the wrong `shared`. Create junctions for `shared`, `engine` and `node-ui` inside the worktree's `node_modules/@st`.
- **Windows 8.3 short paths:** `fs.watch` on a directory given by its short name (e.g. `C:\Users\JEANHA~1\...`, what `os.tmpdir()` returns here) kills the whole process with a libuv assertion. Watch `fs.promises.realpath(dir)`.
- **Nested worktrees break Biome:** a leftover worktree under `.claude/worktrees/` (it contains its own `biome.json`) makes `biome check .` fail on the main checkout with "nested root configuration". Remove finished worktrees: unlink their `node_modules/@st` junctions first (`[System.IO.Directory]::Delete(path, $false)`), then `git worktree remove`.
- **Tooling:** pnpm isn't installed; use npm. No browser or Playwright is set up yet, so UI changes need a manual check by the user.
- **Case-only file name clashes:** on Windows, sibling files differing only by case (`ModelPicker.tsx` and `modelPicker.ts`) fail typecheck with TS1261. Pick distinct names.
- **Contract coverage:** `app.test.ts` requires every contract endpoint to be exercised, so a new contract entry, its route and its test land in the same commit.
- **Comboboxes and Biome a11y:** options are `div role="option" tabIndex={-1}` inside a `div role="listbox"` (an `li` fails `noNoninteractiveElementToInteractiveRole`). Each option needs `onMouseDown={e => e.preventDefault()}`, or the input's blur closes the list before the click lands.
- **SSR panel tests** (`renderToStaticMarkup`) don't run effects: a hook's initial state must already be right without them.
- **Live server checks on a data copy:** run `node <repo>/node_modules/tsx/dist/cli.mjs <repo>/apps/server/src/main.ts` with the copy's parent as cwd (the server uses `./data`) and `PORT` set (the startup log always says 3001). `node --import tsx` fails from a temp cwd because tsx doesn't resolve there. Delete the copy afterwards: it holds the encrypted secrets and the master key.
- **Line endings:** `.gitattributes` pins text files to LF (`* text=auto eol=lf`). Write new files with LF; don't mass-reformat unrelated files.
- **Server integration tests that build a workflow by hand** must include exactly one `chat-input` node, even when its outputs are not wired to anything. `prepareWorkflow` rejects workflows with zero or multiple chat-input nodes before execution begins.
- **Verification:** for server changes, a quick live check is to start the server with `npx tsx src/index.ts` in `apps/server` and `curl.exe` the endpoints.

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
