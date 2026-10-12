# Serious Tavern

A single-user chat app where each conversation runs a visual, reusable workflow. TypeScript/ESM throughout; no account system in this MVP.

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
- `apps/server`: `app.ts` assembles Fastify parsers, errors and resource routes; `context.ts` wires repositories, secrets and seed initialization. `routes/` parses shared contract schemas and types Fastify replies with `ApiResponse`; `services/` owns locked chat execution, preset preview, character/persona imports/exports and connector imports (`services/import/`). `errors.ts` centralizes HTTP errors and missing-entity checks. `storage/` and `secrets/` retain atomic JSON writes, per-session locking and encryption. `card.ts` and `uploads.ts` handle card/image transport. The server owns all data and secrets.
- `apps/web`: React/Vite chat, React Flow workflow editor, Presets, Characters, Personas, and Settings. Every tab stays mounted and inactive tabs are only hidden, so each tab keeps its open item, drafts and scroll position; pages refresh their shared catalogs when their tab becomes active again. `api/transport.ts` owns fetch, `ApiError`, JSON headers and automatic/silent toasts. Per-resource clients in `api/` use the shared request/response types; pages call methods such as `sessionsApi.sendMessage(id, body)` rather than declaring payloads or constructing route strings. The UI does not execute workflows.

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

### Streaming

Sending a message posts to `POST /api/sessions/:id/messages/stream`, which answers with server-sent events (`turn.start`, `node.delta`, `turn.complete`, `turn.error`; see `turnEventSchema`). The web client reads them in `api/turnStream.ts` and `useChat` applies them with the pure helpers in `pages/chat/turnMessages.ts`:
- The composer shows the user row immediately and appends one assistant row per streaming Chat Output as `node.delta` events arrive. The "Preparing a reply" indicator only shows until the first row exists.
- A collapsible **Reasoning** block appears above a message when the model emits reasoning content; it is open while no answer text has arrived yet.
- `turn.complete` replaces the local rows with the persisted messages and execution.
- **Stop** (button, or Escape in the composer) only calls `POST /api/sessions/:id/stop` and keeps reading the stream. The server cancels the LLM call and ends the stream with `turn.error` `TURN_STOPPED`, whose `details` (`turnFailureDetailsSchema`) carry the saved user message and the replies so far as `partial` rows (shown with a "Stopped" note). The same details come with `WORKFLOW_EXECUTION_FAILED`, so a failed turn keeps its partial replies without a refetch. Aborting the connection is only a fallback when the stop request fails, and a dropped connection resyncs the session from the server.
- While a turn runs the chat is locked: no switching, creating or deleting chats, and no message edits.
- Streaming can be disabled per LLM node in its config (default enabled); the reply then arrives in one piece.

Web-only dependencies: **`lucide-react`** supplies tree-shakable SVG icons without runtime CSS; **`react-markdown`** renders Markdown safely as React elements; **`remark-gfm`** adds tables, strikethrough, task lists and autolinks. No HTML-processing or syntax-highlighting plugin is added.

The scrollable history region intentionally has `tabIndex={0}` for keyboard scrolling (a narrowly documented Biome suppression); icon-only buttons have accessible labels and titles.

To add a node type: (1) create `packages/engine/src/nodes/<type>/index.ts` exporting a `NodeDefinition` with Zod config, typed ports (`dataType`, optional `description`), defaults and `execute(ctx)`; (2) optionally add `resolvePorts(config, resources)` for instance-specific ports (resources provide read-only access to presets and character cards without importing server code), and declare `templateFields` for config fields accepting `{{...}}`; (3) register the definition in `packages/engine/src/registry.ts`; (4) optionally add a custom config panel. The registry derives the required descriptor flag `dynamicPorts: boolean` from the presence of `resolvePorts`; no editor node-type allowlist is needed. `/api/node-types/:type/ports` resolves both input and output ports for every advertised dynamic node on canvas load, config changes and resource refreshes.

Dynamic port updates preserve controlled canvas state, refresh React Flow's handle geometry and ignore stale responses, including after reloading a canvas with identical node ids/configs. Resolution failures show an error and restore the node type's static ports. Unknown-node placeholders are never resolved. Edges attached to disappearing ports are **pruned** (dropped) once the node's ports resolve without them; the same rule runs in the engine (`pruneInvalidEdges`) when a preset is updated and when a workflow is saved. Pruning only trusts successfully resolved ports, so unknown types and failing resolvers keep their edges.

WORKFLOW_INVALID errors carry structured issues: `prepareWorkflow`/`validateWorkflow` return `ValidationIssue`s (`{ message, edgeId?, nodeIds? }`) whose messages name nodes as `Label #k (type)` (`nodeDisplayName`) instead of ids. The web transport renders those messages in the toast and links it to `/workflows?workflow=<id>&edge=<id>`, where the editor opens the workflow and highlights the offending connection in red.

Register custom panels in `packages/node-ui/src/index.tsx`'s `customPanels` map; focused panels live in `src/panels/`. `NodeConfigPanelProps` contains `{ descriptor, config, onChange, context? }`. The optional `NodePanelContext` contains `{ presets: readonly Preset[], characters: readonly Character[], providers: readonly ApiResponse<'listProviders'>[number][], renderLink?(to: string, label: string): ReactNode }`. The web editor passes fetched resources and a React Router link renderer; node-ui never imports web API clients or router code. LLM and Character panels use the same context, defaulting to empty lists when absent. Without a link renderer, the LLM's preset link uses a normal anchor. Generic panels retain macro-registry-driven template hints.

The generic array editor supports only arrays whose item schema is an object with exactly two required string properties, `key` and `value` (e.g. HTTP headers). Other array shapes, tuple schemas and malformed stored row values are shown as read-only JSON with an unsupported notice; they are never coerced into key/value rows or changed implicitly. Add a custom panel for those fields, as the LLM panel does for its string-array stop sequences.

`prepareWorkflow(workflow, resources?)` returns `{ errors, prepared? }`. On success, `PreparedWorkflow` holds a cloned workflow with parsed/defaulted configs, node definitions, resolved ports, incoming/upstream dependencies, output reachability and execution-scoped cached resources. Every node is validated, including disconnected nodes; each dynamic port resolver runs once. Resource lookups cache promises (including missing resources) and clone fetched cards/presets, so preparation and execution share the same snapshot. Resource-specific loading belongs in node port resolvers, not the executor.

`validateWorkflow(workflow, resources?)` is a thin wrapper returning preparation errors. `executeWorkflow(workflowOrPrepared, options)` prepares raw workflows internally; callers that need validation before side effects should prepare once and pass the result. Prepared workflows are execution-scoped: prepare anew for each turn, rather than reusing a snapshot across turns. The chat service prepares before saving the user message, so invalid workflows commit neither messages nor execution logs.

### Chat Output and Character nodes

A valid workflow has **exactly one Chat Input and one or more Chat Outputs**. Each successfully completed Chat Output appends one assistant message. An output skipped by a Condition branch appends nothing; a run where all outputs are skipped succeeds with no assistant messages and an execution warning.

**Chat Output** takes required `value` (`text`) and optional `character` (`character`) inputs. Its config has `template` (default `''` uses `value`; a nonempty template is rendered), `name` (optional free text, default `''`) and `order` (number, default `0`). Speaker precedence is the connected character's name, then the configured name, then an unnamed assistant. Merely selecting a session character does not automatically name outputs. Its `reply` (`text`) output remains connectable: `foo.reply → bar's LLM preset input → bar.value` chains two speakers inside one workflow run.

Produced messages are ordered by dependency first. Output Y comes before output X when Y's transitive upstream node set is a strict subset of X's; this covers both "Y feeds X" and outputs fed by a shared upstream node (e.g. `LLM1 → Output1` and `LLM1 → LLM2 → Output2` always give Output1, then Output2). Among outputs with no remaining predecessor, smaller `order` wins, then node id (stable lexical comparison). `order` therefore only breaks ties between outputs that don't depend on each other; it never puts a dependent output before its dependency, and outputs with identical upstream sets are independent. Streamed rows use the same ranking, so they never jump when the turn settles. Node finish times and canvas positions never decide message order. `order` controls message placement, not node scheduling.

**Character** emits a character card on its `character` output. Choose “Session character” (`source: 'session'`, the default) or a specific card (`source: 'card'`, `characterId`). A missing session character fails with an actionable error. Missing selected cards are validation errors. Connect a Character to Chat Output for speaker attribution, to LLM for local prompt context, or both.

The **LLM** has an optional `character` input in addition to preset inputs. A connected card replaces the session character only for that LLM's render context, including recursive `{{character.*}}` fields and aliases (`{{char}}`, `{{description}}`, `{{personality}}`, `{{scenario}}`). Without a connection, session behavior is unchanged. The preset input key `character` is reserved for this dedicated port; conflicting presets fail port resolution with an explicit error.

### Message API and partial failures

`POST /api/sessions/:id/messages` accepts `{ content }` and returns `{ userMessage, assistantMessages: [...], execution }`. The array may be empty. Assistant messages may have `name` and `characterId`; the name is snapshotted when the message is created, so renaming a card does not rename old messages. Older stored sessions without these fields still work. Both user and assistant messages reference their execution, allowing the UI to display warnings/errors even when no output ran.

| Method and path | Request | Success |
| --- | --- | --- |
| `PATCH /api/sessions/:id/messages/:messageId` | JSON `{ content: string }`, trimmed, minimum 1 character | `200` updated message: `{ id, role, content, createdAt, executionId?, name?, characterId? }` |
| `DELETE /api/sessions/:id/messages/:messageId` | No body | `204` with no response body |

Both parameters are UUIDs defined in the shared contract. Missing sessions or messages return `404` with `{ error: { code: 'NOT_FOUND', message: 'Session not found' | 'Message not found' } }`; invalid parameters or content return the standard validation `400` envelope. `services/messages.ts` mutates only the targeted message under the same `sessions.update` per-session lock as sending, leaves the session's `updatedAt` unchanged (only sending a message advances it), and retains all other messages and message fields. Concurrent API mutations wait for an in-flight workflow instead of racing its write; the UI also prevents these requests while busy.

The engine returns `{ replies: Array<{ nodeId, content, name?, characterId? }>, execution }`. On failure it throws `ExecutionFailure` with `.execution` and ordered `.replies` containing only completed outputs. Node failures also carry structured `.nodeId` and `.nodeType`; execution-wide abort/progress failures leave these undefined. The server uses this metadata, not message parsing, to label errors and keeps completed replies in the locked session before returning HTTP 500 with `{ error: { code: 'WORKFLOW_EXECUTION_FAILED', message, details: { userMessage, assistantMessages, execution } } }`.

Error `details` uses the same shared schema as a successful message result. The chat client displays kept replies plus the error notification and execution details; named speakers show their snapshotted name and an available character avatar. Retrying sends a new user message, rather than rolling back the failed turn.

## Presets and LLM providers

A **preset** defines the final, ordered message list sent to an LLM. It has declared **inputs** (the values a workflow supplies) and an ordered list of discriminated **entries** (`message` or `slot`) that assembles those values with fixed prompts. Each input has an `id`, unique key, optional label and description, and type (`messages` or `text`). Every input becomes one correspondingly typed LLM input port named by its key; the port label defaults to the key. A `messages` input expands to its message list. A `text` input becomes one message using the slot's role (default `user`) and is skipped when empty. The same input may be placed by multiple slots.

An enabled **message** entry has a system/user/assistant role and templated content; it can use `{{input.<key>}}`, `{{trigger.message}}`, `{{trigger.sessionId}}`, `{{history}}`, and character/persona variables. Character and persona fields are also expanded when referenced, with recursive references guarded. Missing character fields render as empty text; `{{user}}` falls back to `User`. A **slot** places a declared input at its position in the final message list. Fixed messages that render to whitespace only are omitted, as are empty text-slot values. Inputs unused by any enabled slot or message template produce non-blocking warnings. Model and sampler settings belong to each LLM node. Preview and execution use the same renderer, and the preview accepts `{ preset, inputs?, sessionId? }` and returns `{ messages, warnings }`.

Preview `inputs` accepts strings for text inputs and arrays of `{ role, content, name? }` for messages inputs. Explicit messages arrays are used unchanged by the preview, including an empty array; only an omitted messages input falls back to the selected session's history or the sample conversation. The current preview UI still selects session/sample history rather than editing messages arrays.

The **Default** preset declares `history` (`messages`, label “Chat history”) and `message` (`text`, label “User message”). Its ordered system entries are Main prompt (a short instruction plus `{{character.system_prompt}}`), Character description, Personality, Scenario, Persona (`{{persona.description}}`), and Example dialogue; then the history slot; then Post-history instructions; then the user-message slot. Each character/persona field is a separate variable-only entry, so empty fields produce no blank prompt messages. The character's first greeting is not included. The Default Assistant workflow connects Chat Input `history` and `message` to those LLM ports.

## Importing presets from other apps

Connectors copy content from another app's install folder into local records. Each connector has one config record, keyed by its app id (`sillytavern` is the only one so far). Adapters live in `apps/server/src/services/import/` (`connector.ts` defines the shape: detect, scan, name, map). Sync, routes and the config are generic over that shape.

| Method and path | Request | Success |
| --- | --- | --- |
| `GET /api/import-sources` | none | `ImportSource[]`: `{ id, app, path, lastSyncAt? }` |
| `PUT /api/import-sources/:app` | JSON `{ path }` (trimmed, required) | `200` the stored record. The path is resolved to an absolute path and must hold a `data/` folder, or the response is `400 IMPORT_SOURCE_INVALID`. |
| `POST /api/import-sources/:app/sync` | No body | `200` `{ created, updated, unchanged, missing }`. `409 IMPORT_SOURCE_NOT_SET` when no folder is configured; `400 IMPORT_SOURCE_INVALID` when the folder has gone. |

SillyTavern presets are read from `<install>/data/<user>/OpenAI Settings/*.json` for every user folder, skipping folders whose name starts with `_`. Nothing else in the install is read: symlinks and nested folders are not followed, and files over 5 MB are skipped. A file's identity is (install path, user, file name). Its preset name is the file name without `.json`, plus ` (<user>)` unless the user is `default-user`.

Each sync works like this:
- A file with no record creates a preset.
- A file whose sha256 changed overwrites its preset in place, keeping the preset id, so workflows stay linked. Edges into inputs that no longer exist are pruned, as preset `PUT` does.
- An unchanged file is left alone, including its `updatedAt`.
- A preset whose file is gone is kept and marked `source.missing: true`. The flag is cleared if the file returns. Its `updatedAt` does not change.
- An unreadable, invalid or oversized file is skipped with a server warning. Its local copy stays, and it is not counted.
- Syncs are serialized per connector (`context.importLock`). Presets from another install folder are never touched.

Imported presets carry an optional `source` (`presetSourceSchema` in `@st/shared`): `{ app, installPath, user, file, hash, importedAt, missing? }`. The field belongs to the server:
- `POST /api/presets` and `PUT /api/presets/:id` strip any client-sent `source`, so a duplicate is always an editable copy.
- `PUT` on a preset with a `source` fails with `409 PRESET_READ_ONLY` and leaves the record unchanged. `DELETE` still works, and the next sync recreates the preset.

In the web app, Settings → **Import content** saves the SillyTavern install folder (the one containing `data/`) and runs **Sync**. Sync stays disabled until a folder is saved; the counts appear in a toast and the last sync time is shown under the folder. On the Presets page, imported presets carry an *imported* badge (or *source missing* when `source.missing` is set). Opening one shows a banner with its origin and a *Duplicate to edit* action. Name, description, inputs, entries and Save are all disabled, and entries can still be selected and previewed. The read-only state is one `readOnly` prop threaded from `pages/Presets.tsx`, and `change`/`save` also ignore edits for imported presets. Duplicating (from the list or the banner) builds the create body without `source`, so the copy is editable.

### SillyTavern chat-completion mapping

`apps/server/src/services/import/sillytavern-mapper.ts` is a pure function from parsed JSON to inputs and entries.
- Order: the `prompt_order` entry with `character_id` 100001 is used, then 100000, then the first entry. Only the identifiers listed there are imported, in that order, with `enabled` taken from the order entry. Anything absent is ignored.
- A normal prompt becomes a `message` entry. The role is `system` when it is missing or unknown. The content is kept verbatim, macros included, so unsupported macros show up as preset warnings. The name is the prompt name, falling back to its identifier.
- `chatHistory` becomes a `messages` input named `history` plus a `slot` entry. A `message` text input and a `Current message` slot follow it (enabled together), because a turn's history is captured before the new user message is saved.
- `charDescription`, `charPersonality`, `scenario` and `personaDescription` become system messages with `{{character.description}}`, `{{character.personality}}`, `{{character.scenario}}` and `{{persona.description}}`.
- `dialogueExamples`, `worldInfoBefore`, `worldInfoAfter` and any other marker become disabled, empty `message` entries named after the marker.
- Absolute injection (`injection_position: 1`) with an `injection_depth` becomes depth placement in the first enabled chat-history slot. Otherwise the prompt stays ordered. `injection_order`, sampler settings and other top-level fields are ignored.

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

Character/persona edits, avatar uploads and deletion share the repository's per-entity lock, so an avatar upload cannot overwrite a concurrent edit or resurrect a deleted entity. Avatar file work stays inside that lock. `services/entity-mutations.ts` owns these operations; plain repository `save` is used only for creation in these routes. Repository `delete` accepts an optional `beforeDelete` callback for related cleanup under the same lock. These locks are non-reentrant: callbacks must not call `update` or `delete` for the same entity.

### Template macros

The registry in `@st/shared` is the single source for engine resolution, preset validation, and editor hints. Preset entries and common node templates support:

- `{{character.<field>}}`: `name`, `description`, `personality`, `scenario`, `first_mes`, `mes_example`, `creator_notes`, `system_prompt`, `post_history_instructions`, `creator`, and `character_version`.
- `{{persona.name}}` and `{{persona.description}}`.
- Short aliases: `{{char}}` → character name, `{{user}}` → persona name (or `User` when no persona is selected), `{{description}}`, `{{personality}}`, `{{scenario}}` → matching character fields, and `{{persona}}` → persona description.
- `{{input.<key>}}` (or `{{inputs.<key>}}`), `{{trigger.message}}`, `{{trigger.sessionId}}`, and `{{history}}`. Node scope roots (`input`, `inputs`, `trigger`) and nested paths remain supported; preset message inputs/history render as transcripts, while node templates use JSON for structured values.

Names are **case-sensitive**, matching Handlebars: `{{CHARACTER.Name}}` and `{{INPUT.MyKey}}` are unknown and render as empty text (preset validation warns about them). Input keys that differ only by casing are still rejected in presets. Slots and port bindings use declared keys exactly.

Unknown names render as empty text and produce a non-blocking warning in enabled preset messages. Known macros without a value render as empty text (only `{{user}}` has the `User` fallback). Unknown `{{input.x}}` references remain validation errors, including inside blocks and subexpressions. Character and persona fields can contain templates themselves, expanded recursively with cycles resolving to empty text. `{{char.*}}` and `{{user.*}}` are no longer supported; use `character.*` and `persona.*`. Legacy `<BOT>`/`<USER>` and SillyTavern scripting macros are not supported.

#### Template syntax

Templates are [Handlebars](https://handlebarsjs.com/) with stock semantics and `noEscape`, so values are inserted as written. The `handlebars` runtime (parser and compiler) is a dependency of `@st/engine`, and renders presets and template-taking node configs (LLM, Chat Output, HTTP Request, Condition). `@handlebars/parser` is the only dependency of `@st/shared`, so the web bundle has no compiler; validation walks its AST.

- **Paths** are case-sensitive: `{{character.name}}`, `{{input.key}}`, `{{inputs.key.nested}}`, `{{trigger.message}}`, `{{history}}`. A numeric segment at the end of a path is a syntax error, so write `{{history.[0]}}`; `{{history.0.content}}` is fine.
- **Blocks:** `{{#if x}}…{{else}}…{{/if}}`, `{{#unless x}}`, `{{#with x}}`, and `{{#each history}}…{{/each}}` with `this`, `@index`, `@first`, `@last` and `../` (parent context). Block-only lines are removed from the output. `{{#each}}` over a missing or non-array value renders its `{{else}}` branch, or nothing, and never fails.
- **Helpers:** `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `and`, `or`, `not`, used as subexpressions, e.g. `{{#if (eq character.name "aeaze")}}`. `eq` is strict `===` and case-sensitive: `1` does not equal `"1"`, and `"Mira"` does not equal `"mira"`. `ne` is its negation. `lt`, `lte`, `gt` and `gte` use JavaScript's operators. Helpers are defined in `packages/engine/src/template-helpers.ts` and listed in `templateHelperNames` in `@st/shared`. Handlebars' stock `log` helper is removed.
- **Truthiness** (`#if`, `unless`, `and`, `or`, `not`): `false`, `0`, `""`, `null`, `undefined` and empty arrays are false. Everything else is true, including the string `"false"`.
- **Comments:** `{{! note}}` and `{{!-- note --}}` are removed.
- **Bare names:** in presets, `{{history}}` renders a `role: content` transcript and `{{input.x}}` renders message lists as transcripts and objects as pretty JSON. In node templates they render compact JSON. `{{input}}`/`{{inputs}}` render the inputs object (pretty JSON in presets, compact JSON in nodes), and `{{trigger}}` renders compact JSON. `{{#each history}}` and `{{#each input.x}}` iterate the raw messages (`this.role`, `this.content`, `this.name`). `{{persona}}` renders the persona description, and `{{persona.name}}` still resolves.
- **Errors never throw.** A template that does not parse, or uses unsupported syntax (partials `{{> x}}`, decorators, an unknown helper with arguments such as `{{foo bar}}`, or `#if` without exactly one argument), renders verbatim, unchanged. Preset validation reports it as a warning. Code-like expressions such as `{{input.x.constructor()}}` are syntax errors, so the whole template renders verbatim. A backslash before `{{` (\{{) produces a literal `{{`.

Message placement defaults to **ordered**, at its position in the entry list. **Depth** placement references an enabled slot entry backed by a `messages` input and injects the message inside that slot's expanded conversation: depth 0 inserts *after* the last message, depth 1 inserts *before* the last message, and depths beyond the slot length clamp to the start. For example, history `[user: Hello, assistant: Hi]` plus a system note at depth 1 produces `[user: Hello, system: Note, assistant: Hi]`. Messages at the same depth preserve their order in the preset entry list. Changing/removing an input can make stale workflow edges invalid (shown red); validation catches stale handles.

The LLM node selects a **provider**, **model**, **preset**, temperature, max tokens and optional samplers (top-p, frequency/presence penalties, stop sequences). History is only supplied through a preset slot; it is never added implicitly. Its outputs are `text` and `raw`. Each execution log records provider, model, sampler parameters and the final messages sent, without recording API keys.

**Merge consecutive system messages** (`mergeSystemMessages`, default `false`) is an LLM node checkbox. When enabled, after preset rendering it joins each consecutive run of system messages without a `name` using `"\n\n"`. User/assistant messages and named system messages break a run and remain unchanged (even an explicitly empty name is treated as set). Request logs contain the actual merged messages sent to the provider. Preset preview remains the unmerged preset output because merging is a node-level setting.

Chat history and message inputs carry an optional string `name`. Chat Input, Memory in `messages` format, preset history previews and message slots preserve it (including through depth insertion and repeated slots); OpenRouter forwards it only when present. No speaker-name prefix is added to message content. A future per-slot option may control such prefixing; currently speaker names are metadata chosen through Chat Output.

Seeding uses stable IDs so concurrent initializers do not create duplicate Default presets or demo workflows. Seeds are added only when the corresponding store is empty.

To add a provider, implement `LlmProvider` in `packages/engine/src/providers/` with `id`, `label`, `secretName` and `chat(request, { apiKey, signal })`, returning `{ text, raw, usage? }`. Register the provider in the provider registry and import its module during startup (the existing OpenRouter implementation is an example). The request is provider-neutral; translate sampler names into your provider's API format. The provider picker is served by `/api/providers`, and the engine looks up the configured secret by `secretName`. Providers may also implement the optional `stream(request, { apiKey, signal, onToken, onReasoning })`; the LLM node uses it unless its `streaming` option is off.

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

`data/` is gitignored and holds user data that must be preserved across upgrades: workflows, presets, sessions, execution logs, characters, personas and avatars live as separate JSON files written via temporary-file-and-rename. Never reset or delete `data/`. Persistence is behind a `Repository<T>` interface for a future database.

Schema changes stay additive and backward compatible: stored records keep unknown fields (zod `passthrough`), new optional fields use `.default()`/`.optional()` so old files still parse, and writes migrate-on-write (normalize with `safeParse` + defaults, keep unknown fields, no destructive rewrites). If a breaking change is unavoidable, ship an explicit migration script plus a backup step. Seeds only create missing records and never overwrite user-modified ones. Corrupt JSON files are never auto-deleted: `list()` skips them with a warning, `get()` throws with the file path.

Back up the whole `data/` directory (at minimum `secrets.enc.json`, `.master.key` and the JSON files). Stop the server first, then copy the directory to a timestamped zip. `data/` stays gitignored.

Secrets are AES-256-GCM encrypted in `data/secrets.enc.json`; a 32-byte key comes from `SECRETS_KEY` (64 hex characters), or is generated in `data/.master.key` on first start. **Back up both encrypted secrets and the master key.** The secrets API returns only names and masked hints; key values can only be set or deleted. For a production deployment, provide `SECRETS_KEY`, restrict access to the server and data directory, and put authentication in front of the API.

Secret `set` and `delete` operations serialize their entire encrypted-file read/modify/atomic-write sequence through one store-wide lock, shared across secret names. The reusable `storage/lock.ts` keyed lock also backs repository mutations. Locks are in-process and scoped to their owning store/repository instance; they do not coordinate multiple server processes writing the same directory.

Workflow and preset PUT replacements use `repository.update`, sharing the per-record lock with DELETE. PUT preserves the stored id/creation time and returns the standard `404 NOT_FOUND` envelope if the record is absent, including when DELETE wins a race; it never creates or resurrects records. Plain `save` creates new records (character/persona imports generate new UUIDs); chat's intermediate save is already inside its session update lock. Do not nest `update`/`delete` for the same key.

Executions report node status, timing, outputs, errors and a `warnings` list (older logs default to an empty list). Nodes in a failed execution wave are aborted and allowed to settle **only until their original node deadline** before the failure is returned (`definition.timeoutMs`, otherwise `nodeTimeoutMs`, otherwise 30 seconds). An abort-ignoring sibling that has not settled by its deadline is still recorded as `cancelled`, distinct from an unselected condition branch (`skipped`). Its detached work may continue; the engine does not claim to have stopped it, but ignores its results, request-recording callbacks and events. Completed Chat Output replies are retained even if another node later fails; cancelled and skipped outputs produce no messages. After cancellation cleanup returns, logs and replies no longer change. Per-node setup errors are recorded as execution failures rather than silently discarded wave rejections. A required output port with outgoing edges must be returned by its node; an output declared `optional` may be omitted (Condition's mutually exclusive branch outputs are optional).

Engine events feed the streaming transport (`TurnStream` on the server) and are also available to other observers. The `onEvent` observer is a best-effort synchronous notification: exceptions from it are swallowed and never change workflow success/failure, kept replies, execution details or cancellation cleanup, including for the terminal `execution:complete` event. Message requests for one session are serialized through all completed replies or failure, so each prompt sees the prior exchange; different sessions can still execute concurrently. Workflow edits affect subsequent messages in all sessions bound to that workflow.
