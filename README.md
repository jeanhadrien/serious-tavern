# Serious Tavern

A single-user chat app where each conversation runs a visual, reusable workflow. TypeScript/ESM throughout; no account system or streaming in this MVP.

See [Plan & Vision](PLAN.md) for the product vision and planned next steps.

## Run

Requires Node.js 24 and npm. Run `npm install`, then `npm run dev`. Open the Vite URL shown in the terminal (normally http://127.0.0.1:5173). The API runs on http://127.0.0.1:3001; Vite proxies `/api`. Run `npm run check` before committing and `npm run build` to verify the production bundle.

Create a chat and choose a workflow. The seeded **Default Assistant** uses the Default preset and requires an `openrouter` secret in Settings. **Parallel demo** makes two HTTP calls to httpbin.org and needs network access. To try a local echo without keys, make a workflow with Chat Input `message` → Chat Output `value`.

## Tooling

Run these commands from the repository root; the configuration covers all npm workspaces:

| Command | Purpose |
| --- | --- |
| `npm run check` | The single pre-commit command for agents and contributors: Biome formatting/lint checks (no writes), then TypeScript checks, all Vitest tests, and Knip. Stops at the first failing step. |
| `npm run lint` | Check lint rules only, without writing files. |
| `npm run format` | Apply Biome formatting. |
| `npm run fix` | Apply formatting and Biome's safe lint fixes. Does not enable unsafe fixes. |
| `npm run knip` | Find unused source files, exports, types, and dependencies across workspaces. |
| `npm run build` | Typecheck and build the production web bundle. |

Biome uses the recommended lint preset, two-space indentation, single-quoted JavaScript/TypeScript strings, semicolons, and a 120-column target. Import organizing and other assists are **disabled** to avoid noisy import-order changes. Generated output, `node_modules`, data directories, coverage, Playwright reports/results, TypeScript build metadata, and the lockfile are excluded. `AGENTS.md` and `PLAN.md` are owned by the orchestrator and excluded from automated changes.

Rule tuning intentionally keeps this tooling adoption behavior-preserving:

- `noNonNullAssertion` and `noExplicitAny` are off: existing validated graph lookups and flexible node/provider boundaries should not be rewritten just to satisfy stylistic checks.
- `useExhaustiveDependencies` is off: changing existing effect dependencies or callback identities can change fetching and editor state behavior; that needs a separate React-focused change.
- `noArrayIndexKey` is off: changing keys in existing ordered lists could alter component identity and state.
- `useButtonType`, `useAltText`, `noStaticElementInteractions`, `noLabelWithoutControl`, and `useAriaPropsSupportedByRole` are off: retrofitting form defaults, image descriptions, labels, and keyboard/ARIA interactions belongs in a dedicated accessibility pass, not mechanical lint adoption. Other recommended accessibility rules remain enabled.
- `noDescendingSpecificity` is off: the existing stylesheet deliberately layers page/component overrides; reordering selectors could change rendering.
- `noUnsafeOptionalChaining` is off **only in `apps/web/src/api.test.ts`**: those assertions inspect mock calls immediately after awaiting the corresponding requests. The rule remains enabled for application code.

Two existing `useOptionalChain` warnings are retained rather than applying fixes Biome classifies as unsafe.

Knip explicitly lists server startup, the web entry and Vite config, package entry points (including the shared `./ports` subpath), and test files. Its project patterns are scoped to source/config files, so live data and generated outputs are not scanned. Package entry exports are intentional workspace APIs, and tests/configs are independent roots, not dead application files. No dependency or symbol ignore list is needed. Knip may print harmless redundancy hints because its plugins also infer the explicit entry points; these do not fail `check`.

The initial Knip cleanup removed only the unused internal server `pngSignature` alias and three unused alert-barrel type re-exports (`Alert`, `AlertOptions`, `AlertLevel`); their underlying type definitions remain. No unused files or dependencies were found.

The mechanical formatting commit is listed in `.git-blame-ignore-revs`. To hide that churn in local blame:

```powershell
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

## Architecture

- `packages/shared`: entity models plus the endpoint contract in `src/api/` (body, params, query, response schemas and inferred `ApiBody`, `ApiParams`, `ApiQuery`, `ApiResponse` types). The contract covers sessions/messages/executions, workflows/validation, presets/preview, characters/personas/import/export/avatars, node types/dynamic ports/providers, secrets and the common error envelope. Binary upload/download schemas describe bytes, not JSON; card extension values and error details intentionally remain `unknown`.
- `packages/engine`: validated DAG executor, event callback, template helper, preset renderer, provider registry, node registry, and individual node implementations in `src/nodes/<type>/index.ts`. Internal `text.ts` centralizes compact node/template serialization and pretty JSON/transcript coercion shared by execution and presets; their distinct formatting remains intentional. Nodes backward-reachable from **any** Chat Output execute (the union of their dependencies); other nodes are logged as skipped. Independent ready nodes execute concurrently; condition branches skip and merges ignore skipped inputs.
- `packages/node-ui`: JSON-Schema-driven config form and optional custom panels.
- `apps/server`: `app.ts` assembles Fastify parsers, errors and resource routes; `context.ts` wires repositories, secrets and seed initialization. `routes/` parses shared contract schemas and types Fastify replies with `ApiResponse`; `services/` owns locked chat execution, preset preview and character/persona imports/exports. `errors.ts` centralizes HTTP errors and missing-entity checks. `storage/` and `secrets/` retain atomic JSON writes, per-session locking and encryption. `card.ts` and `uploads.ts` handle card/image transport. The server owns all data and secrets.
- `apps/web`: React/Vite chat, React Flow workflow editor, Presets, Characters, Personas, and Settings. `api/transport.ts` owns fetch, `ApiError`, JSON headers and automatic/silent toasts. Per-resource clients in `api/` use the shared request/response types; pages call methods such as `sessionsApi.sendMessage(id, body)` rather than declaring payloads or constructing route strings. The UI does not execute workflows.

Frontend notifications live in `apps/web/src/alerts/`. Import `alerts` and call `alerts.error(message)`, `.success`, `.info`, or `.warning` from any module; React components can use `useAlerts()`. API failures toast automatically unless a request uses `{ silent: true }` to handle an error inline.

`pages/workflows/` contains controlled canvas/editor hooks, the node view, palette, toolbar, configuration panel and tested canvas conversion model (including read-only unknown-node placeholders). `pages/presets/` retains its existing list/editor/entry/preview components.

`pages/entities/` shares list/detail/avatar/drop components and draft/CRUD/import state between the character and persona pages, with separate field editors and validation/import notifications.

`Chat.tsx` is a thin composition of focused components in `pages/chat/`: `ChatSidebar`, `ChatHeader` (including shared character/persona selectors), `MessageList`, `ChatMessageView`, `MessageContent`, `MessageActions`, `MessageEditor`, `Composer`, and `ExecutionDetails`. `useChat` owns session/loading/send state; `useMessageActions` owns persisted edits/deletions. `useStickToBottom` tracks proximity to the bottom and observes content resizing (including images and execution details). Chat-only styles live in `pages/chat/chat.css`; the reusable accessible `IconButton` and its styles live in `components/`.

### Chat controls and rendering

- The composer grows up to 200px before scrolling. **Enter** sends, **Shift+Enter** adds a newline, and IME composition never submits. Sending retains/restores composer focus. While sending or mutating a message, the composer is read-only and sends/actions/context changes/chat navigation are disabled; workflow execution shows animated pending dots (respecting reduced-motion preferences).
- Both user and assistant bubbles render Markdown, including GFM tables, lists, blockquotes, inline code and fenced code. Links open in a new tab with `rel="noopener noreferrer"`. Raw HTML is skipped and unsafe link protocols are rejected by the Markdown renderer; no `rehype-raw` is enabled. Soft line breaks are kept visible with scoped `white-space: pre-line` on Markdown paragraphs/list items rather than another plugin dependency; code uses its own whitespace rules.
- User bubbles use the selected session persona's name/avatar, falling back to “You” and a user icon. Assistant bubbles preserve each reply's speaker snapshot and character avatar, or show “Assistant” with a bot icon. Consecutive outputs remain separate bubbles with their own identities.
- Opening a conversation scrolls to its bottom. New messages and content resizes stick only when the reader was within 96px of the bottom; scrolling back through history opts out until the reader returns near the bottom.
- Hover or keyboard-focus a bubble to expose **Edit/Delete** icon buttons (always visible on touch devices). Editing is inline: **Ctrl/Cmd+Enter** saves, **Escape** cancels, and whitespace-only content cannot be saved. Deletion requires a small inline confirmation. Both actions work on either role and never re-run a workflow or alter message attribution/execution metadata. Changes affect history used by subsequent turns, not saved execution logs.

Web-only dependencies: **`lucide-react`** supplies tree-shakable SVG icons without runtime CSS; **`react-markdown`** renders Markdown safely as React elements; **`remark-gfm`** adds tables, strikethrough, task lists and autolinks. No HTML-processing or syntax-highlighting plugin is added.

The scrollable history region intentionally has `tabIndex={0}` for keyboard scrolling (a narrowly documented Biome suppression); icon-only buttons have accessible labels and titles.

To add a node type: (1) create `packages/engine/src/nodes/<type>/index.ts` exporting a `NodeDefinition` with Zod config, typed ports (`dataType`, optional `description`), defaults and `execute(ctx)`; (2) optionally add `resolvePorts(config, resources)` for instance-specific ports (resources provide read-only access to presets and character cards without importing server code), and declare `templateFields` for config fields accepting `{{...}}`; (3) register the definition in `packages/engine/src/registry.ts`; (4) optionally add a custom config panel. `/api/node-types/:type/ports` resolves dynamic ports for the editor; validation and execution use the same resolver. Resource lookups are cached for each execution so validation and execution use the same cards/presets.

### Chat Output and Character nodes

A valid workflow has **exactly one Chat Input and one or more Chat Outputs**. Each successfully completed Chat Output appends one assistant message. An output skipped by a Condition branch appends nothing; a run where all outputs are skipped succeeds with no assistant messages and an execution warning.

**Chat Output** takes required `value` (`text`) and optional `character` (`character`) inputs. Its config has `template` (default `''` uses `value`; a nonempty template is rendered), `name` (optional free text, default `''`) and `order` (number, default `0`). Speaker precedence is the connected character's name, then the configured name, then an unnamed assistant. Merely selecting a session character does not automatically name outputs. Its `reply` (`text`) output remains connectable: `foo.reply → bar's LLM preset input → bar.value` chains two speakers inside one workflow run.

Produced messages use a dependency-respecting topological order: an output's upstream outputs come first; among dependency-ready outputs, smaller `order` wins, then node id (stable lexical comparison). Node finish times and canvas positions never decide message order. `order` controls message placement, not node scheduling.

**Character** emits a character card on its `character` output. Choose “Session character” (`source: 'session'`, the default) or a specific card (`source: 'card'`, `characterId`). A missing session character fails with an actionable error. Missing selected cards are validation errors. Connect a Character to Chat Output for speaker attribution, to LLM for local prompt context, or both.

The **LLM** has an optional `character` input in addition to preset inputs. A connected card replaces the session character only for that LLM's render context, including recursive `{{character.*}}` fields and aliases (`{{char}}`, `{{description}}`, `{{personality}}`, `{{scenario}}`). Without a connection, session behavior is unchanged. The preset input key `character` is reserved for this dedicated port; conflicting presets fail port resolution with an explicit error.

### Message API and partial failures

`POST /api/sessions/:id/messages` accepts `{ content }` and returns `{ userMessage, assistantMessages: [...], execution }`. The array may be empty. Assistant messages may have `name` and `characterId`; the name is snapshotted when the message is created, so renaming a card does not rename old messages. Older stored sessions without these fields still work. Both user and assistant messages reference their execution, allowing the UI to display warnings/errors even when no output ran.

| Method and path | Request | Success |
| --- | --- | --- |
| `PATCH /api/sessions/:id/messages/:messageId` | JSON `{ content: string }`, trimmed, minimum 1 character | `200` updated message: `{ id, role, content, createdAt, executionId?, name?, characterId? }` |
| `DELETE /api/sessions/:id/messages/:messageId` | No body | `204` with no response body |

Both parameters are UUIDs defined in the shared contract. Missing sessions or messages return `404` with `{ error: { code: 'NOT_FOUND', message: 'Session not found' | 'Message not found' } }`; invalid parameters or content return the standard validation `400` envelope. `services/messages.ts` mutates only the targeted message under the same `sessions.update` per-session lock as sending, updates the session's `updatedAt`, and retains all other messages and message fields. Concurrent API mutations wait for an in-flight workflow instead of racing its write; the UI also prevents these requests while busy.

The engine returns `{ replies: Array<{ nodeId, content, name?, characterId? }>, execution }`. On failure it throws `ExecutionFailure` with `.execution` and ordered `.replies` containing only completed outputs. The server keeps those replies in the locked session before returning HTTP 500 with `{ error: { code: 'WORKFLOW_EXECUTION_FAILED', message, details: { userMessage, assistantMessages, execution } } }`.

Error `details` uses the same shared schema as a successful message result. The chat client displays kept replies plus the error notification and execution details; named speakers show their snapshotted name and an available character avatar. Retrying sends a new user message, rather than rolling back the failed turn.

## Presets and LLM providers

A **preset** defines the final, ordered message list sent to an LLM. It has declared **inputs** (the values a workflow supplies) and an ordered list of discriminated **entries** (`message` or `slot`) that assembles those values with fixed prompts. Each input has an `id`, unique key, optional label and description, and type (`messages` or `text`). Every input becomes one correspondingly typed LLM input port named by its key; the port label defaults to the key. A `messages` input expands to its message list. A `text` input becomes one message using the slot's role (default `user`) and is skipped when empty. The same input may be placed by multiple slots.

An enabled **message** entry has a system/user/assistant role and templated content; it can use `{{input.<key>}}`, `{{trigger.message}}`, `{{trigger.sessionId}}`, `{{history}}`, and character/persona variables. Character and persona fields are also expanded when referenced, with recursive references guarded. Missing character fields render as empty text; `{{user}}` falls back to `User`. A **slot** places a declared input at its position in the final message list. Fixed messages that render to whitespace only are omitted, as are empty text-slot values. Inputs unused by any enabled slot or message template produce non-blocking warnings. Model and sampler settings belong to each LLM node. Preview and execution use the same renderer, and the preview accepts `{ preset, inputs?, sessionId? }` and returns `{ messages, warnings }`.

The **Default** preset declares `history` (`messages`, label “Chat history”) and `message` (`text`, label “User message”). Its ordered system entries are Main prompt (a short instruction plus `{{character.system_prompt}}`), Character description, Personality, Scenario, Persona (`{{persona.description}}`), and Example dialogue; then the history slot; then Post-history instructions; then the user-message slot. Each character/persona field is a separate variable-only entry, so empty fields produce no blank prompt messages. The character's first greeting is not included. The Default Assistant workflow connects Chat Input `history` and `message` to those LLM ports.

## Characters and Personas

Characters and personas are managed from the top-level **Characters** and **Personas** pages. Character cards store name, description, personality, scenario, first message, example dialogue, system and post-history prompts, alternate greetings, tags, creator metadata, extensions, and an optional avatar. The editor keeps the commonly used name, description, and personality fields prominent and places the rest under Advanced fields. Persona records contain a name, description, and optional avatar. JSON and avatar files are stored below `data/characters`, `data/personas`, and `data/avatars/`; uploads are limited to 20 MB per file.

Character JSON cards may be flat V1, V2 (`spec: "chara_card_v2"`), or V3 (`spec: "chara_card_v3"`). PNG cards are parsed and exported server-side using `chara` and `ccv3` tEXt metadata; when both exist, V3 is preferred. PNG character imports require embedded card metadata, while plain persona images create a persona named from the file name. PNG exports include both V2 and V3 card metadata and use the stored avatar or a generated placeholder.

The REST API exposes:

| Method and path | Purpose |
| --- | --- |
| `GET/POST /api/characters` | List or create a character |
| `GET/PUT/DELETE /api/characters/:id` | Read, update, or delete a character |
| `POST /api/characters/import` | Import one or more JSON cards or PNG cards as multipart files |
| `GET/PUT /api/characters/:id/avatar` | Retrieve or upload the character avatar |
| `GET /api/characters/:id/export?format=json\|png` | Export a character card |
| `GET/POST /api/personas` | List or create a persona |
| `GET/PUT/DELETE /api/personas/:id` | Read, update, or delete a persona |
| `POST /api/personas/import` | Create personas from uploaded images (embedded card metadata is used when available) |
| `GET/PUT /api/personas/:id/avatar` | Retrieve or upload the persona avatar |

Import endpoints return `{ imported, failed }` for multi-file uploads and use the standard `{ error: { code, message, details? } }` API error shape for invalid requests. Sessions store optional `characterId` and `personaId`; selecting them in Chat persists the context used by preset and node templates. New chats select the first available persona when one exists.

### Template macros

The registry in `@st/shared` is the single source for engine resolution, preset validation, and editor hints. Preset entries and common node templates support:

- `{{character.<field>}}`: `name`, `description`, `personality`, `scenario`, `first_mes`, `mes_example`, `creator_notes`, `system_prompt`, `post_history_instructions`, `creator`, and `character_version`.
- `{{persona.name}}` and `{{persona.description}}`.
- Short aliases: `{{char}}` → character name, `{{user}}` → persona name (or `User` when no persona is selected), `{{description}}`, `{{personality}}`, `{{scenario}}` → matching character fields, and `{{persona}}` → persona description.
- `{{input.<key>}}` (or `{{inputs.<key>}}`), `{{trigger.message}}`, `{{trigger.sessionId}}`, and `{{history}}`. Node scope roots (`input`, `inputs`, `trigger`) and nested paths remain supported; preset message inputs/history render as transcripts, while node templates use JSON for structured values.

Macro names, namespaces, fields, and input keys are **case-insensitive**, so `{{CHARACTER.Name}}` and `{{INPUT.MyKey}}` work. Input keys that differ only by casing are rejected in presets; for arbitrary node input objects, the first matching own key is used. Slots/port bindings still use their declared exact keys.

Unknown macros are **left verbatim** and produce non-blocking warnings in enabled preset messages. Known macros without a value render as empty text (only `{{user}}` has the `User` fallback). Unknown input references remain validation errors. Character and persona fields can contain macros themselves, expanded recursively with cycles resolving to empty text. `{{char.*}}` and `{{user.*}}` are no longer supported; use `character.*` and `persona.*`. Legacy `<BOT>`/`<USER>` and SillyTavern scripting macros are not supported.

Message placement defaults to **ordered**, at its position in the entry list. **Depth** placement references an enabled slot entry backed by a `messages` input and injects the message inside that slot's expanded conversation: depth 0 inserts *after* the last message, depth 1 inserts *before* the last message, and depths beyond the slot length clamp to the start. For example, history `[user: Hello, assistant: Hi]` plus a system note at depth 1 produces `[user: Hello, system: Note, assistant: Hi]`. Messages at the same depth preserve their order in the preset entry list. Changing/removing an input can make stale workflow edges invalid (shown red); validation catches stale handles.

The LLM node selects a **provider**, **model**, **preset**, temperature, max tokens and optional samplers (top-p, frequency/presence penalties, stop sequences). History is only supplied through a preset slot; it is never added implicitly. Its outputs are `text` and `raw`. Each execution log records provider, model, sampler parameters and the final messages sent, without recording API keys.

**Merge consecutive system messages** (`mergeSystemMessages`, default `false`) is an LLM node checkbox. When enabled, after preset rendering it joins each consecutive run of system messages without a `name` using `"\n\n"`. User/assistant messages and named system messages break a run and remain unchanged (even an explicitly empty name is treated as set). Request logs contain the actual merged messages sent to the provider. Preset preview remains the unmerged preset output because merging is a node-level setting.

Chat history and message inputs carry an optional string `name`. Chat Input, Memory in `messages` format, preset history previews and message slots preserve it (including through depth insertion and repeated slots); OpenRouter forwards it only when present. No speaker-name prefix is added to message content. A future per-slot option may control such prefixing; currently speaker names are metadata chosen through Chat Output.

Seeding uses stable IDs so concurrent initializers do not create duplicate Default presets or demo workflows. Seeds are added only when the corresponding store is empty.

To add a provider, implement `LlmProvider` in `packages/engine/src/providers/` with `id`, `label`, `secretName` and `chat(request, { apiKey, signal })`, returning `{ text, raw, usage? }`. Register the provider in the provider registry and import its module during startup (the existing OpenRouter implementation is an example). The request is provider-neutral; translate sampler names into your provider's API format. The provider picker is served by `/api/providers`, and the engine looks up the configured secret by `secretName`. Streaming can be added as a separate method in a future release.

## Ports & types

Ports declare `text`, `number`, `boolean`, `object`, `array`, `messages`, `character`, or `any` (legacy ports default to `any`). The same compatibility rule is used in the editor and executor:

| Output → input | Result |
| --- | --- |
| Same type, or `any` on either side | Pass through unchanged |
| `number`, `boolean`, `object`, `array` → `text` | Convert to text (objects/arrays as pretty JSON) |
| `messages` → `text` | Convert to a `role: content` transcript |
| `messages` → `array` | Pass through unchanged |
| `character` → `object` | Pass through unchanged (a character is an object) |
| `character` → `text` | Rejected; no implicit character serialization |
| All other differing types, including `text` → `number`/`boolean` | Rejected; no implicit parsing |

Memory's `history` output is `any` because its `format` setting can emit either text or messages. Hover over a port to see its type and description; compatible connections that convert data are dashed. Invalid saved edges remain visible in red for correction.

## Data and secrets

`data/` is gitignored. Workflows, presets, sessions and execution logs are separate JSON files written via temporary-file-and-rename. Persistence is behind a `Repository<T>` interface for a future database. Secrets are AES-256-GCM encrypted in `data/secrets.enc.json`; a 32-byte key comes from `SECRETS_KEY` (64 hex characters), or is generated in `data/.master.key` on first start. **Back up both encrypted secrets and the master key.** The secrets API returns only names and masked hints; key values can only be set or deleted. For a production deployment, provide `SECRETS_KEY`, restrict access to the server and data directory, and put authentication in front of the API.

Executions report node status, timing, outputs, errors and a `warnings` list (older logs default to an empty list). Nodes in a failed execution wave are aborted and allowed to settle before the failure is returned; siblings stopped by that abort have status `cancelled`, distinct from an unselected condition branch (`skipped`). Completed Chat Output replies are retained even if another node later fails; cancelled and skipped outputs produce no messages. After a failed wave settles, logs and replies no longer change. A required output port with outgoing edges must be returned by its node; an output declared `optional` may be omitted (Condition's mutually exclusive branch outputs are optional). Engine events are available for a future streaming transport. Message requests for one session are serialized through all completed replies or failure, so each prompt sees the prior exchange; different sessions can still execute concurrently. Workflow edits affect subsequent messages in all sessions bound to that workflow.
