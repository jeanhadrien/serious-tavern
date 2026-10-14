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

- `packages/shared`: entity models plus the endpoint contract in `src/api/` (body, params, query, response schemas and inferred `ApiBody`, `ApiParams`, `ApiQuery`, `ApiResponse` types). The contract covers sessions/messages/executions, workflows/validation, presets/preview, characters/personas/import/export/avatars, node types/dynamic ports, providers, secrets and the common error envelope. Binary upload/download schemas describe bytes, not JSON; card extension values and error details intentionally remain `unknown`.
- `packages/engine`: validated DAG executor, event callback, template helper, preset renderer, LLM adapter registry (`providers/`, keyed by provider `kind`), node registry, and individual node implementations in `src/nodes/<type>/index.ts`. Internal `text.ts` centralizes compact node/template serialization and pretty JSON/transcript coercion shared by execution and presets; their distinct formatting remains intentional. Nodes backward-reachable from **any** Chat Output execute (the union of their dependencies); other nodes are logged as skipped. Independent ready nodes execute concurrently; condition branches skip and merges ignore skipped inputs.
- `packages/node-ui`: JSON-Schema-driven config form and optional custom panels.
- `apps/server`: `app.ts` assembles Fastify parsers, errors and resource routes; `context.ts` wires repositories, secrets and seed initialization. `routes/` parses shared contract schemas and types Fastify replies with `ApiResponse`; `services/` owns locked chat execution, preset preview, character/persona imports/exports and connector imports (`services/import/`). `errors.ts` centralizes HTTP errors and missing-entity checks. `storage/` and `secrets/` retain atomic JSON writes (presets use YAML via `PresetRepository`), per-session locking and encryption. `card.ts` and `uploads.ts` handle card/image transport. The server owns all data and secrets.
- `apps/web`: React/Vite chat, React Flow workflow editor, Presets, Characters, Personas, and Settings. Every tab stays mounted and inactive tabs are only hidden, so each tab keeps its open item, drafts and scroll position; the lists of workflows, presets, characters, personas and chats come from shared stores (see below), so every page sees the same fresh data. `api/transport.ts` owns fetch, `ApiError`, JSON headers and automatic/silent toasts. Per-resource clients in `api/` use the shared request/response types; pages call methods such as `sessionsApi.sendMessage(id, body)` rather than declaring payloads or constructing route strings. The UI does not execute workflows.

The web shell (`apps/web/src/layout/`) implements the three-column layout of `docs/FRONTEND-LAYOUT.md`: a thin top-bar skeleton, then columns L | M | R. `state.ts` is the pure layout model (`LayoutState` and `layoutReducer`, no React): `tabs` (what L and R show; R shows `chat` while a wide editor owns M), `wide` (the wide editor in M), `narrowOpen`, `compact`/`compactTab`/`compactChat` (two-column mode), `dirty` and `kinds` (each resource's editor is `wide` or `narrow`). Actions: `selectTab`, `openEditor`, `closeEditor`, `setCompact`, `toggleCompactChat`, `setDirty`, `restore` (apply a layout read from the URL). `derive.ts` turns the state into `viewSlots` (the column each view sits in, or `null` when hidden) and the header icons per column. The rules are unit-tested in `state.test.ts`. `Shell.tsx` mounts every view exactly once, in a fixed order, as a child of one CSS grid; moving the chat between M and R, or hiding it, only changes a view's `grid-area`/`hidden`, so React never remounts it (streaming turns, composer drafts, scroll, hosted pages and the React Flow canvas survive). `useChat` lives in the shell and feeds both the chat list (`ChatSidebar`, in R) and the conversation (`pages/Chat.tsx`). Columns are resized with a hand-rolled `ResizeHandle` (pointer drag and arrow keys); `widths.ts` clamps them (side minimum 180px, M minimum 360px) and remembers them in `localStorage` (`st.layout.widths`, access wrapped in try/catch). The layout collapses to L | M below a 1000px viewport (`useCompactMode`). Header icons take a `dirty` flag (`setDirty`), shown as a dot. Workflows and presets are split into a list (`WorkflowList`, `PresetListView`, in L) and a wide editor (`Workflows`, `Presets`, in M). They share state through a per-resource editor store (`stores/editorStore.ts`: `workflowEditorStore`, `presetEditorStore`): the draft stays inside the always-mounted editor, and the store carries only the open item id, its dirty flag and the list's requests (`open(item, focus?)`, `discard(id)`, applied once each by `useEditorCommands`; `focus` is a hint inside the item, e.g. the edge to highlight). The list also calls `useLayoutActions().openEditor` (a context whose value never changes, so the prop-less list views stay constant elements) to show the editor in M; `useDirtySync` mirrors each store's dirty flag into the reducer's `setDirty` for the header dot. Selecting an already-open item never reloads it, so its draft survives. Editors adapt to M with CSS container queries (`.view[data-view^="editor:"]` is the `editor` container). Characters, personas and settings are narrow editors that open inside their own column (`DESIGN_KINDS`). Characters and personas have their list in R (`CharacterList`, `PersonaList` in `pages/Entities.tsx`, both `EntityListView` wired to an `EntityKind` from `pages/entities/entityKinds.ts`) and share the same editor-store link as the wide editors (`characterEditorStore`, `personaEditorStore`): picking an item calls `editorStore.open` and `openEditor`, which makes `viewSlots` replace the list with the editor in the same column; the editor's back arrow calls `closeEditor`, which only hides it, so its draft stays and its icon keeps the dirty dot. Opening a wide editor sends the chat to R and hides the narrow editor; closing the wide editor brings it back with its draft. Create and import (file picker or drop, on the list and on the editor) live in `entityActions.ts`; a file dropped on an editor with unsaved changes is imported but does not replace the draft. Providers are the one narrow editor with a list in L (`ProviderListView`, `Providers` in `pages/providers/`, linked by `providerEditorStore`); it works like characters, only in L. Settings has no list (`LISTLESS` in `state.ts`): its icon shows the form directly in L and it has no `list:settings` view. In two-column mode all of these live in L. Entity styles are in `pages/entities/entities.css`: a single-column form by default, with a roomier layout from a container query when the column is dragged wide. The layout lives in the URL, so a reload restores it and a copied URL reproduces it: `/?session=<id>&left=presets&wide=preset:<id>&right=character:<id>`. `session` is the open chat, `left` is L's tab (`workflows` default, `presets`, `providers`, `settings`; `provider:<id>` means the provider editor is open), `wide=workflow|preset[:<id>]` is the wide editor in M, `right` is R's tab (`chats`, `characters`, `personas`, or `chat` while a wide editor owns M; `character:<id>`/`persona:<id>` mean that narrow editor is open), and `edge=<id>` is a one-shot highlight for the opened workflow. Defaults are omitted, so the plain layout is `/`. Column widths stay in `localStorage`; dirty flags, drafts and compact mode (derived from the viewport) never go into the URL. `layout/url.ts` holds the pure functions (`parseLayoutUrl`, `formatLayoutUrl`, `layoutToUrl`, `urlTarget`, `layoutHref`; round-trip tested, garbage falls back to defaults) and the reducer's `restore` action applies a parsed URL. `useLayoutUrl` keeps both in step. Layout to URL: a change of content (chat, editor or item) is a `push`, so Back/Forward step through what was opened, and tab switches are a `replace`. An editor that has no item open is not written to the URL. URL to layout: a URL the hook did not write (Back/Forward, a clicked link, a pasted URL) is `restore`d, its items are opened through the editor stores once their lists load, and the URL is not rewritten while that runs. Afterwards the real state is written back with `replace`, which normalizes the URL and drops what could not be opened: an id that no longer exists closes its editor (the list stays), an unknown chat is ignored, and garbage values fall back to defaults. Back/Forward never replaces an editor's unsaved draft nor switches a streaming chat; a clicked link does replace a draft, like a click in a list. A link without `session` leaves the open chat alone, while stepping Back to a URL without one closes it. Link producers build URLs with `layoutHref` (toast links, `PresetPreview`). Old paths stay as inbound aliases (`legacySearch` in `layout/routes.ts`): `/workflows?workflow=…&edge=…`, `/presets?id=…`, `/characters`, `/personas`, `/settings` (node-ui's "Edit preset" link still uses `/presets?id=…`) are rewritten with `replace` to the layout URL, and unknown paths become `/`.

Shared lists live in `apps/web/src/stores/`. `createListStore` (`listStore.ts`) holds one server list outside React, in the style of the alert store: it loads when the first subscriber appears, re-fetches when its change event arrives on the shared `EventSource` (which the server also sends on every connect), sorts with the list's comparator (`compareRecent` for workflows, presets and chats, by name for characters and personas) and keeps the array identity when nothing changed. `stores/index.ts` instantiates one store per resource and exposes `useList(store)` (a `useSyncExternalStore` wrapper). `store.refresh()` fetches now and resolves with the list; calls in the same tick, or during a fetch, share one fetch, so event bursts and a page's own post-save refresh collapse into few requests. Stores only feed list views and selectors: open drafts (workflow, preset, character, persona editors) and the open chat session are separate state and are never replaced by a list refresh. Settings data (secrets, import sources) has no change events and is still fetched by its page.

Frontend notifications live in `apps/web/src/alerts/`. Import `alerts` and call `alerts.error(message)`, `.success`, `.info`, or `.warning` from any module; React components can use `useAlerts()`. API failures toast automatically unless a request uses `{ silent: true }` to handle an error inline.

`pages/workflows/` contains controlled canvas/editor hooks, the node view, palette, toolbar, configuration panel and tested canvas conversion model (including read-only unknown-node placeholders). `pages/presets/` retains its existing list/editor/entry/preview components.

`pages/entities/` shares the list view, detail/avatar/drop components and draft/CRUD/import logic between characters and personas; an `EntityKind` supplies the per-type API calls, stores, validation and notifications, with separate field editors.

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

WORKFLOW_INVALID errors carry structured issues: `prepareWorkflow`/`validateWorkflow` return `ValidationIssue`s (`{ message, edgeId?, nodeIds? }`) whose messages name nodes as `Label #k (type)` (`nodeDisplayName`) instead of ids. The web transport renders those messages in the toast and links it (`layoutHref`) to `/?wide=workflow:<id>&edge=<id>`, where the editor opens the workflow and highlights the offending connection in red.

Register custom panels in `packages/node-ui/src/index.tsx`'s `customPanels` map; focused panels live in `src/panels/`. `NodeConfigPanelProps` contains `{ descriptor, config, onChange, context? }`. The optional `NodePanelContext` contains `{ presets: readonly Preset[], characters: readonly Character[], providers: readonly Pick<ProviderView, 'id' | 'name'>[], loadModels?(providerId, { refresh? }): Promise<ProviderModelList>, renderLink?(to: string, label: string): ReactNode }`. The web editor passes fetched resources and a React Router link renderer; node-ui never imports web API clients or router code. LLM and Character panels use the same context, defaulting to empty lists when absent. The LLM panel's Model field is the `ModelPicker` (`panels/ModelPicker.tsx`): a combobox (ARIA roles, arrow keys, Enter, Escape) over the list `loadModels` returns, with a lucide refresh button that passes `refresh: true`. The input is the config value, saved on every keystroke, so any id works and `config.model` stays a plain string; the list only suggests. Options are filtered by id and name (every whitespace-separated term must match, capped at 50 shown) and show the name, id, context size and price per 1M tokens when known; the pure logic is in `panels/modelOptions.ts` and the loading state machine in `panels/useModelList.ts` (reloads when the provider changes, ignores replies for a previous provider, never throws: an error becomes an inline message). A model typed that is absent from a loaded list gets a quiet hint. Without `loadModels` the field is plain text. The web editor passes a loader built on `providersApi.models(id, refresh, { silent: true })` (module-level in `WorkflowConfigPanel.tsx`, so the panel's effect stays stable); its styles are in `pages/workflows/modelPicker.css`. Without a link renderer, the LLM's preset link uses a normal anchor. Generic panels retain macro-registry-driven template hints.

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

`POST /api/sessions/:id/messages` accepts `{ content }` and returns `{ userMessage?, assistantMessages: [...], execution }`. An empty `content` (or none) stores no user message: the turn runs on the session history as it is, `userMessage` is absent, and `trigger.message` is `''`. The array may be empty. Assistant messages may have `name` and `characterId`; the name is snapshotted when the message is created, so renaming a card does not rename old messages. Older stored sessions without these fields still work. Both user and assistant messages reference their execution, allowing the UI to display warnings/errors even when no output ran.

| Method and path | Request | Success |
| --- | --- | --- |
| `PATCH /api/sessions/:id/messages/:messageId` | JSON `{ content: string }`, trimmed, minimum 1 character | `200` updated message: `{ id, role, content, createdAt, executionId?, name?, characterId? }` |
| `DELETE /api/sessions/:id/messages/:messageId` | No body | `204` with no response body |

Both parameters are UUIDs defined in the shared contract. Missing sessions or messages return `404` with `{ error: { code: 'NOT_FOUND', message: 'Session not found' | 'Message not found' } }`; invalid parameters or content return the standard validation `400` envelope. `services/messages.ts` mutates only the targeted message under the same `sessions.update` per-session lock as sending, leaves the session's `updatedAt` unchanged (only sending a message advances it), and retains all other messages and message fields. Concurrent API mutations wait for an in-flight workflow instead of racing its write; the UI also prevents these requests while busy.

The engine returns `{ replies: Array<{ nodeId, content, name?, characterId? }>, execution }`. On failure it throws `ExecutionFailure` with `.execution` and ordered `.replies` containing only completed outputs. Node failures also carry structured `.nodeId` and `.nodeType`; execution-wide abort/progress failures leave these undefined. The server uses this metadata, not message parsing, to label errors and keeps completed replies in the locked session before returning HTTP 500 with `{ error: { code: 'WORKFLOW_EXECUTION_FAILED', message, details: { userMessage?, assistantMessages, execution } } }`.

Error `details` uses the same shared schema as a successful message result. The chat client displays kept replies plus the error notification and execution details; named speakers show their snapshotted name and an available character avatar. Retrying sends a new user message, rather than rolling back the failed turn.

## Presets and LLM providers

A **preset** defines the final, ordered message list sent to an LLM. It has declared **inputs** (the values a workflow supplies) and an ordered list of discriminated **entries** (`message` or `slot`) that assembles those values with fixed prompts. Each input has an `id`, unique key, optional label and description, and type (`messages` or `text`). Every input becomes one correspondingly typed LLM input port named by its key; the port label defaults to the key. A `messages` input expands to its message list. A `text` input becomes one message using the slot's role (default `user`) and is skipped when empty. The same input may be placed by multiple slots.

An enabled **message** entry has a system/user/assistant role and templated content; it can use `{{input.<key>}}`, `{{trigger.message}}`, `{{trigger.sessionId}}`, `{{history}}`, and character/persona variables. Character and persona fields are also expanded when referenced, with recursive references guarded. Missing character fields render as empty text; `{{user}}` falls back to `User`. Every entry has a required `displayName`, the label shown in the editor. A message entry may also have an optional `name`: a template rendered with the same context as the content, trimmed, and sent as the prompt message's `name` only when non-empty (an entry whose content renders empty is still dropped). Its unknown `{{input.x}}` references are errors, and syntax problems and unknown macros are warnings, exactly like content; an input referenced only by a name counts as used. A **slot** places a declared input at its position in the final message list. Fixed messages that render to whitespace only are omitted, as are empty text-slot values. Inputs unused by any enabled slot or message template produce non-blocking warnings. Model and sampler settings belong to each LLM node. Preview and execution use the same renderer, and the preview accepts `{ preset, inputs?, sessionId? }` and returns `{ messages, warnings }`.

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
- A file whose hash changed overwrites its preset in place, keeping the preset id, so workflows stay linked. Edges into inputs that no longer exist are pruned, as preset `PUT` does. The hash is the sha256 of `mapper <version>\n` followed by the file bytes. Each connector sets `mapperVersion`; bumping it re-imports every file on the next Sync, so mapping fixes reach existing presets. The SillyTavern connector is at version 2.
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
- A normal prompt becomes a `message` entry. The role is `system` when it is missing or unknown. The content is kept verbatim, macros included, so unsupported macros show up as preset warnings. Its label (`displayName`) is the prompt name, falling back to its identifier; no message `name` is set.
- `chatHistory` becomes a `messages` input named `history` plus a `slot` entry. A `message` text input and a `Current message` slot follow it (enabled together), because a turn's history is captured before the new user message is saved.
- `charDescription`, `charPersonality`, `scenario`, `dialogueExamples` and `personaDescription` become system messages with `{{character.description}}`, `{{character.personality}}`, `{{character.scenario}}`, `{{character.mes_example}}` and `{{persona.description}}`.
- `worldInfoBefore`, `worldInfoAfter` and any other marker become disabled, empty `message` entries named after the marker.
- Absolute injection (`injection_position: 1`) with an `injection_depth` N is counted like ST, from the end of the chat including the new user message. Our history slot excludes that message, so for N >= 1 the entry gets depth N-1 in the first enabled chat-history slot. Depth 0 cannot be expressed as history depth, so it stays ordered and is moved to sit right after the `Current message` slot. Without an enabled chat-history slot, every prompt stays ordered where the prompt order lists it. `injection_order`, sampler settings and other top-level fields are ignored.

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

The LLM node selects a **provider**, **model**, **preset**, temperature, max tokens and optional samplers (top-p, frequency/presence penalties, stop sequences). History is only supplied through a preset slot; it is never added implicitly. Its outputs are `text` and `raw`. Each execution log records the node's **wire exchange** (`nodes[id].wire`, see Providers below): the URL, headers with credentials redacted, the exact JSON body sent, and the response, so provider mappings can be debugged. Logs written before the wire log keep the app's canonical request under `request`; the chat's execution details show `wire` when present and fall back to `request`.

**Merge consecutive system messages** (`mergeSystemMessages`, default `false`) is an LLM node checkbox. When enabled, after preset rendering it joins each consecutive run of system messages without a `name` using `"\n\n"`. User/assistant messages and named system messages break a run and remain unchanged (even an explicitly empty name is treated as set). Request logs contain the actual merged messages sent to the provider. Preset preview remains the unmerged preset output because merging is a node-level setting.

Chat history and message inputs carry an optional string `name`, and so do preset message entries (rendered from their `name` template). Chat Input, Memory in `messages` format, preset history previews and message slots preserve it (including through depth insertion and repeated slots); The provider adapter forwards it only when present, under the record's `messageName` field (or drops it when that is `null`). No speaker-name prefix is added to message content. A future per-slot option may control such prefixing; currently speaker names are metadata chosen through Chat Output.

Seeding uses stable IDs so concurrent initializers do not create duplicate Default presets or demo workflows. Seeds are added only when the corresponding store is empty.

### Providers

User guide with examples: [docs/PROVIDERS.md](docs/PROVIDERS.md).

A **provider record** says how to reach one OpenAI-compatible backend (OpenRouter, OpenAI, DeepSeek, Ollama, LM Studio, vLLM, ...). Records are data, not code; the design is in PLAN.md ("user-defined LLM providers"). The LLM node's `provider` config holds a record id.

| Field | Meaning |
| --- | --- |
| `id` | UUID for user records; the built-in one is `openrouter`. |
| `name` | Label shown in the node's provider dropdown; the file is named after it. |
| `kind` | `openai-compatible` (the only wire protocol today; default). |
| `baseUrl` | `http(s)://` URL; requests go to `<baseUrl>/chat/completions`. |
| `secret` | Optional name of a secret in the encrypted store. Without it no `Authorization` header is sent (local servers). |
| `headers` | Extra request headers (default `{}`). |
| `messageName` | Wire field carrying a message's `name`; `null` = never send it (default `name`). |
| `reasoningFields` | Fields read for the reasoning trace, first non-empty wins (default `[reasoning, reasoning_content]`). |
| `extraBody` | Merged into the request body last (default `{}`). |
| `overrides` | `[{ match, messageName?, reasoningFields?, headers?, extraBody? }]`: first entry whose `match` glob fits the model id replaces those fields (`headers` and `extraBody` are shallow-merged). |

Status: records, storage, API, resolution, the record-driven adapter, the wire log, live reload and the provider UI are done.

**Provider UI** (`apps/web/src/pages/providers/`): the Providers icon in L lists the records (built-ins first, from `providersStore`, which re-fetches on `providers.changed`; the LLM node's provider dropdown reads the same store). Picking one opens the narrow editor in L (`left=provider:<id>`):
- A form for `name`, `baseUrl`, `secret` (a free text field that suggests the secret names saved in Settings and warns when the name is not among them; empty means no secret), message names ("Send as a message field" with the field name, or "Don't send names" = `messageName: null`) and `reasoningFields` as an ordered list.
- One raw YAML box for `headers`, `extraBody` and `overrides`. Other keys are rejected; a missing or empty key is saved as empty (`{}`/`[]`), because PUT keeps stored fields that a body omits.
- Save validates the draft with `providerFieldsSchema` first and lists the problems above the form (`YAML overrides.0.match: …`, `Base URL: …`); server errors toast as usual. The pure draft/body logic is `providerDraft.ts`.
- The built-in provider opens read-only (the whole form is a disabled `fieldset`) with only **Duplicate**. Duplicate copies the *saved* record, so it is disabled while the draft has unsaved changes.
- Delete of a provider that LLM nodes use is refused by the server (`PROVIDER_IN_USE`); the editor shows a "Provider in use" error naming the workflows.
- Live sync follows the presets rules through the shared `startFileLiveSync` (`pages/fileLiveSync.ts`): a clean editor reloads, a dirty draft is never replaced (one warning; saving overwrites), invalid files get one persistent warning each. Records are compared through their drafts (key order and timestamps never count), and a dirty draft that the disk already holds (the editor's own save, announced before its response) counts as a reload, not a conflict.

- **Adapter** (`providers/openai-compatible.ts`, export `openaiCompatible`): one generic adapter for every `openai-compatible` record. Per request it resolves the record's wire settings for the model (`resolveWireSettings` in `providers/wire-settings.ts`):
  - **Overrides:** the first override whose `match` fits the model id wins. `match` is a case-sensitive glob over the whole id; `*` is the only wildcard and also matches `/`. It replaces `messageName`/`reasoningFields` (an explicit `messageName: null` drops names) and shallow-merges `headers`/`extraBody` over the provider's.
  - **Request:** `POST <baseUrl>/chat/completions` with `Authorization: Bearer <secret>` only when the record names a secret, then `Content-Type`, then the resolved `headers`. A message's `name` is written to the `messageName` field when set (an empty name counts as set) and never sent when it is `null`. Samplers keep their OpenAI names, and reasoning options go out as OpenRouter's `reasoning` object (`effort`, `max_tokens`, `exclude`) for every record. `extraBody` is spread over the body last, so it can override any computed field (`reasoning: null` sends a JSON `null`; it cannot remove a key). Overriding `stream` breaks streaming parsing.
  - **Response:** the reasoning trace is the first non-empty `reasoningFields` entry on each stream delta, or on the non-stream `choices[0].message`. Both modes return it as `ChatResponse.reasoning`. The streamed `raw` mirrors a non-stream response and reports it as `message.reasoning` whichever wire field it came from; the non-stream `raw` is the upstream JSON unchanged. The LLM node surfaces reasoning as `reasoningDelta` events: per chunk while streaming, and as one delta with the whole trace after a non-stream call. Either way it reaches the chat only through the streaming endpoint and only for passthrough Chat Outputs (LLM `text` straight into `value`); the plain `POST .../messages` endpoint and templated outputs do not store it.
  - Idle timeout (120 s between stream chunks, 600 s for a whole non-stream request), abort handling and error parsing (`<provider name> <status>: <message>`) are shared by all records. A non-JSON `200` response fails with `<provider name> returned a response that is not JSON`.
  - **Wire log:** the adapter reports each request through the optional `onWire` callback in `ChatOptions` (the LLM node passes `ctx.recordWire`, which writes `nodes[id].wire`). It reports once before `fetch` (`{ url, method, headers, body }`) and again with `status` and `response` once known, each report replacing the last, so a failed or timed-out call still shows what was sent. `body` is the object that was serialized for `fetch`. `response` is the parsed JSON (or the text, truncated to 2000 characters, when it is not JSON), including error responses; for streams it is the chunks folded into one object under the backend's own field names (string fields of `delta` concatenated, e.g. `reasoning_content`), recorded also when a stream fails midway. It is not the node's `raw` output, which keeps its mapping-independent shape. Redaction happens inside the adapter (`providers/wire-log.ts`) before the callback: headers whose name matches `auth|key|token|secret|cookie|password` are masked (an auth scheme stays visible: `Bearer [redacted]`), and the secret value is replaced wherever it appears in the report and in the adapter's error messages (a backend may echo the key back in an error). Values typed into a record's `baseUrl` or `extraBody` are record data, not secrets, and are logged as sent.

- **Model lists** (design in PLAN.md, "provider model catalogs"): the app learns what a provider serves through the optional `listModels({ provider, apiKey?, signal })` of its adapter (`LlmAdapter` in `providers/index.ts`). The `openai-compatible` one (`providers/openai-models.ts`) does `GET <baseUrl>/models`, the de facto `{ data: [{ id, ... }] }` endpoint, with the chat rule for auth (Bearer only when the record names a secret) and the record's top-level `headers` (override headers are per model, so they are not sent). One generic path reads every backend: `normalizeModels` (`@st/shared`, `provider-models.ts`) keeps `id`, `name`, `description`, `contextLength` (`context_length`), `maxOutputTokens` (`top_provider.max_completion_tokens`), `inputModalities`/`outputModalities` (`architecture.*`), `supportedParameters` and `pricing` (`prompt`/`completion`, USD **per token** as numbers; zero is kept, missing, blank, non-numeric and negative values such as OpenRouter's `-1` are dropped) when the entry carries them. Entries without a string `id` and repeated ids are skipped, unknown fields ignored, and a payload without a `data` array is an error (an empty array is a valid, empty list). The request is bounded by a 30 s timeout; errors name the provider (`<name> 401: ...`, `<name> could not be reached: ...`) and never contain the key (`withoutSecret`). The missing-secret text is shared with the LLM node (`missingSecretMessage`).
- **Model catalog (server):** `GET /api/providers/:id/models` goes through `ModelCatalog` (`services/provider-models.ts`, on the app context) so the key never reaches the browser. Lists are cached in memory only, per provider id, for 1 h. An entry is stale as soon as the whole provider record changes (compared as a fingerprint of the record, not `updatedAt`, because a file edited on disk keeps its old timestamp) or any secret is written or deleted (`SecretStore.revision`). Concurrent requests for the same provider and version share one fetch, which is bounded only by the adapter's timeout (no request signal, so one client leaving cannot abort the others). Failures are never cached. `?refresh=true` skips the cache. A restart refetches on demand.
- **Built-in providers** (`builtInProviders` in `@st/shared`) are defined in code and read-only: OpenRouter (id and secret `openrouter`, so existing nodes and the existing secret need no migration) and abliteration.ai (id and secret `abliteration`). They are listed first, in array order, with `builtIn: true`; `PUT`/`DELETE` on it answer `409 PROVIDER_READ_ONLY`. A stored file claiming a built-in id is invalid (user ids must be UUIDs).
- **Storage:** `data/providers/<slug-of-name>.yaml` through `ProviderRepository`, the same `YamlRepository` as presets (see Preset files: identity is the `id` inside the file, nothing cached, invalid files skipped with a warning and never modified, a hand-written file without `id`/timestamps is stamped once, atomic writes under an id lock). Keys are written in the order `name, kind, baseUrl, secret, headers, messageName, reasoningFields, extraBody, overrides, …, id, createdAt, updatedAt`. **Live reload:** `data/providers/` is watched like the preset directory (same `watchDirectory`, started only from `main.ts`), and every API write (create, update, delete, duplicate) also publishes `providers.changed` from `services/providers.ts`, so clients update even without a watcher. Both carry the files that currently fail to load (`invalidFiles`, always from a fresh scan); with the watcher on, an API write is announced twice, which is harmless.
- **Resolution:** `prepareWorkflow` snapshots provider records into `resources.providers` (built-in ids resolve in the engine, everything else through the `providers` resource the server passes). The LLM node reads its record from `ctx.resources.providers`; an unknown id is a node error `Unknown LLM provider: <id>`, and a record whose `secret` is set but missing fails with `Missing <secret> secret. Add it in Settings.` The adapter for the record's `kind` (`adapters` map, `LlmAdapter` in `providers/index.ts`) receives the record in its options: `chat(request, { provider, apiKey?, signal })`, and `stream(...)` with `onToken`/`onReasoning` in addition. Tests swap the `openai-compatible` adapter (`useAdapter` in `test-providers.ts` / `test-support/adapter.ts`).

| Method and path | Purpose |
| --- | --- |
| `GET /api/providers` | `200` the built-in providers, then the user's (full records plus `builtIn`). |
| `GET /api/providers/:id` | `200` one record (the id may be `openrouter`); `404`. |
| `POST /api/providers` | Body: `name`, `baseUrl` and the optional fields above. `201` the stored record; `400` on a bad URL, secret name, kind... |
| `PUT /api/providers/:id` | Same body; replaces the fields (an omitted `secret` is removed, unknown stored fields survive). `409 PROVIDER_READ_ONLY` for built-ins. |
| `DELETE /api/providers/:id` | `204`; `409 PROVIDER_READ_ONLY` for built-ins, `409 PROVIDER_IN_USE` (details: workflow names) while an LLM node uses it. |
| `POST /api/providers/:id/duplicate` | `201` an editable copy named `<name> (copy)` (works on the built-in one). |
| `GET /api/providers/:id/models` | `200` `{ models, fetchedAt }` (normalized models, see Model lists above); `?refresh=true` bypasses the cache. `404` unknown provider; `400 PROVIDER_SECRET_MISSING` (`Missing <secret> secret. Add it in Settings.`) when the record's secret is not stored; `502 PROVIDER_MODELS_FAILED` with the adapter's redacted message when the backend fails or answers something that is not a model list. |


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

`data/` is gitignored and holds user data that must be preserved across upgrades: workflows, sessions, execution logs, characters, personas and avatars live as separate JSON files written via temporary-file-and-rename; presets and providers are YAML files (see Preset files below and Providers above). Never reset or delete `data/`. Persistence is behind a `Repository<T>` interface for a future database.

Schema changes stay additive and backward compatible: stored records keep unknown fields (zod `passthrough`), new optional fields use `.default()`/`.optional()` so old files still parse, and writes migrate-on-write (normalize with `safeParse` + defaults, keep unknown fields, no destructive rewrites). If a breaking change is unavoidable, ship an explicit migration script plus a backup step. Seeds only create missing records and never overwrite user-modified ones. Corrupt JSON files are never auto-deleted: `list()` skips them with a warning, `get()` throws with the file path.

### Preset files (YAML)

Presets (and providers, see Providers) are the record types stored as YAML instead of JSON: `data/presets/<slug-of-name>.yaml`, handled by `PresetRepository` (`storage/preset-repository.ts`; format in `preset-yaml.ts`). The directory scan, stamping, locking, atomic writes and file naming are shared with providers through the generic `YamlRepository<T>` (`storage/yaml-repository.ts`, parameterized by a `YamlCodec`; names in `yaml-filenames.ts`). The HTTP API and contract are unchanged.

```yaml
name: My roleplay preset
description: Optional
inputs:
  - key: history
    dataType: messages
  - key: message
    dataType: text
entries:
  - displayName: Main prompt   # the editor label
    kind: message
    role: system
    enabled: true
    content: |
      Write a natural, in-character reply.
      {{character.system_prompt}}
  - displayName: Author note
    name: "{{char}}"           # optional message name sent to the model (a template)
    kind: message
    role: system
    enabled: true
    placement:        # depth placement: points at a slot id
      mode: depth
      entryId: chat-history
      depth: 1
    content: "{{character.personality}}"
  - id: chat-history  # slots targeted by a depth placement carry a readable id
    displayName: Chat history
    kind: slot
    inputKey: history
id: 5d6c72c7-5185-4963-8227-527f12ef9eea   # bookkeeping last
createdAt: 2026-01-01T00:00:00.000Z
updatedAt: 2026-01-01T00:00:00.000Z
```

- **Identity** is the `id` inside the file, never the file name, so files can be renamed or edited by hand. Nothing is cached: every operation re-reads the directory.
- **File names** are the slugified preset name (letters and digits of any script, lowercase, hyphens, at most 80 characters; reserved Windows names such as `con` get a `-preset` suffix; an empty slug becomes `preset`). A collision (compared case-insensitively) adds `-2`, `-3`, ... Renaming a preset writes the new file, then removes the old one. A file whose preset name did not change keeps its name, even if you renamed it by hand. `.yml` is read too; files are always written as `.yaml`.
- **Optional keys:** `id` on inputs and entries, `enabled` (defaults to `true`), `placement` (defaults to ordered), `inputs`/`entries` (default empty). Items without an `id` get `input-<n>`/`entry-<n>` from their position (1-based); this is deterministic but shifts if you reorder them by hand. Machine ids (UUIDs) are not written: they are replaced by these derived ids on the next save, and slots targeted by depth placements get a label derived from their `displayName`.
- **Legacy entries:** files written before entries had a `displayName` used `name` as the label. An entry with `name` and no `displayName` is read as `displayName` with no message name (`upgradeLegacyPreset` in `@st/shared`, applied to raw data before validation by the YAML loader and the JSON migration). The file is not rewritten on read; it gets the new shape on its next save. Entry keys are written in the order `id, displayName, name, kind, …`.
- **Content** is lossless: multi-line strings are literal block scalars. Content that block scalars cannot carry (for example lines made only of whitespace, or CR characters) is written double-quoted instead. Unknown fields are preserved at every level.
- **A new hand-written file** with no `id` is valid: the server stamps a fresh `id` (and `createdAt`/`updatedAt` if missing) into the file once, appending after your content, then treats it as a normal preset.
- **Invalid files** (bad YAML, fail the preset schema) are skipped with a warning naming the file and the reason, and are never modified or deleted. If two files declare the same `id`, the first by file name wins and the other is skipped with a warning.
- **Delete** removes only the preset's YAML file.
- **Migration:** at startup, before seeding, each `data/presets/<id>.json` that parses as a valid preset is written as YAML, read back and compared with the original (only machine ids may differ), and then renamed to `<id>.json.migrated`. The JSON content is never changed or deleted, and the `.json` filter ignores it afterwards. A failed verification removes the new YAML and leaves the JSON in place with a warning; unreadable or invalid JSON is left untouched with a warning; if a YAML with the same id already exists the JSON is just renamed. Running it again does nothing. To roll back, delete the YAML and rename `.json.migrated` back to `.json` (an older server then reads it).
- Edits made on disk are picked up by the next API call, and the open web app updates live (see Live reload below).

#### Live reload

The server watches `data/presets/` and `data/providers/` (`watchResourceFiles` in `services/change-events.ts`; `fs.watch`, non-recursive; temp files of our own atomic writes, editor swap/lock files such as `.x.yaml.swp` or `.#x.yaml`, and non-YAML files are ignored). Bursts, including editors that save through temp file + rename, are debounced into one notification, followed by a rescan. The watcher is only started by the server entry point (`createApp(dir, { watch: true })`), re-arms itself after errors, and is closed with the app. It watches the directory by its resolved long path, because libuv aborts the whole process when Windows reports long names for a directory given by its 8.3 short name.

| Method and path | Purpose |
| --- | --- |
| `GET /api/events` | Server-Sent Events (`changeEventSchema`, event name = `type`). `presets.changed` and `providers.changed` with `invalidFiles: { file, reason }[]` (empty when every file loads), plus `workflows.changed`, `characters.changed`, `personas.changed` and `sessions.changed`, each with an optional `id` of the affected record. |

The server sends the current state right after a client connects, so a client that reconnected resyncs, plus a `: keepalive` comment every 15 seconds. Events only say that something changed; clients re-fetch. Writes made through the API trigger the event too, which is harmless.

Record events are emitted by the repositories themselves: `workflows`, `characters`, `personas` and `sessions` in the context are `NotifyingRepository` wrappers (`services/change-events.ts`) that publish `<resource>.changed` with the record id after every successful `save`, `update` and `delete` (avatars, card import and message edit/delete included), so a new write path cannot forget it. The connect snapshot sends each of these without an `id`. Presets and providers are not wrapped: the file watcher covers them, and provider API writes publish through `publishFileChange` as well. A chat turn writes through the wrapper's `silent` repository (streamed rows and flushes would otherwise fire per token) and publishes one `sessions.changed` when the turn settles, whether it completed, failed or was stopped. Tests that spy on a repository's internals must spy on `.silent`.

In the web app, one shared `EventSource` (`api/events.ts`) serves every listener. On `presets.changed`, the Presets page:
- refreshes the list, and leaves the list and editor untouched when the data is identical (a UI save followed by its own event is a no-op);
- reloads the open preset when its editor has no unsaved changes, keeping the selected entry by **position** (entry ids are re-derived on every read); if the preset no longer exists, closes the editor with an info toast;
- never touches a dirty draft: it shows one warning that the file changed on disk. Saving that draft **overwrites the disk edits (last write wins)**; if the file was deleted, saving fails with `NOT_FOUND`, so duplicate the preset to keep the edits;
- shows one persistent warning per invalid file, with the file name and the reason (bad YAML, schema errors, duplicate ids). It is shown once per (file, reason) and dismissed when the file is fixed or removed. Invalid files are skipped, never modified.

The Presets page's list and live sync share the presets store: the sync calls `presetsStore.refresh()` (joining the store's own event-driven fetch, so there is one request per change), then decides what the fresh list means for the open editor. The workflow editor's preset catalog (LLM node ports) is the same store. A workflow whose LLM node points at a preset that was deleted or broken on disk is not guarded by `PRESET_IN_USE`; running it fails with `400 WORKFLOW_INVALID` whose issue names the node and the missing preset id.

Back up the whole `data/` directory (at minimum `secrets.enc.json`, `.master.key`, the JSON files and the preset and provider YAML files). Stop the server first, then copy the directory to a timestamped zip. `data/` stays gitignored.

Secrets are AES-256-GCM encrypted in `data/secrets.enc.json`; a 32-byte key comes from `SECRETS_KEY` (64 hex characters), or is generated in `data/.master.key` on first start. **Back up both encrypted secrets and the master key.** The secrets API returns only names and masked hints; key values can only be set or deleted. For a production deployment, provide `SECRETS_KEY`, restrict access to the server and data directory, and put authentication in front of the API.

Secret `set` and `delete` operations serialize their entire encrypted-file read/modify/atomic-write sequence through one store-wide lock, shared across secret names. The reusable `storage/lock.ts` keyed lock also backs repository mutations. Locks are in-process and scoped to their owning store/repository instance; they do not coordinate multiple server processes writing the same directory.

Workflow and preset PUT replacements use `repository.update`, sharing the per-record lock with DELETE. PUT preserves the stored id/creation time and returns the standard `404 NOT_FOUND` envelope if the record is absent, including when DELETE wins a race; it never creates or resurrects records. Plain `save` creates new records (character/persona imports generate new UUIDs); chat's intermediate save is already inside its session update lock. Do not nest `update`/`delete` for the same key.

Executions report node status, timing, outputs, errors, the LLM wire exchange (`wire`; older logs have the canonical `request` instead) and a `warnings` list (older logs default to an empty list). Nodes in a failed execution wave are aborted and allowed to settle **only until their original node deadline** before the failure is returned (`definition.timeoutMs`, otherwise `nodeTimeoutMs`, otherwise 30 seconds). An abort-ignoring sibling that has not settled by its deadline is still recorded as `cancelled`, distinct from an unselected condition branch (`skipped`). Its detached work may continue; the engine does not claim to have stopped it, but ignores its results, wire-recording callbacks and events. Completed Chat Output replies are retained even if another node later fails; cancelled and skipped outputs produce no messages. After cancellation cleanup returns, logs and replies no longer change. Per-node setup errors are recorded as execution failures rather than silently discarded wave rejections. A required output port with outgoing edges must be returned by its node; an output declared `optional` may be omitted (Condition's mutually exclusive branch outputs are optional).

Engine events feed the streaming transport (`TurnStream` on the server) and are also available to other observers. The `onEvent` observer is a best-effort synchronous notification: exceptions from it are swallowed and never change workflow success/failure, kept replies, execution details or cancellation cleanup, including for the terminal `execution:complete` event. Message requests for one session are serialized through all completed replies or failure, so each prompt sees the prior exchange; different sessions can still execute concurrently. Workflow edits affect subsequent messages in all sessions bound to that workflow.
