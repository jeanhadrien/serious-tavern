# Serious Tavern

A single-user chat app where each conversation runs a visual, reusable workflow. TypeScript/ESM throughout; no account system or streaming in this MVP.

See [Plan & Vision](PLAN.md) for the product vision and planned next steps.

## Run

Requires Node.js 24 and npm. Run `npm install`, then `npm run dev`. Open the Vite URL shown in the terminal (normally http://127.0.0.1:5173). The API runs on http://127.0.0.1:3001; Vite proxies `/api`. Run `npm run typecheck`, `npm test`, and `npm run build` for validation.

Create a chat and choose a workflow. The seeded **Default Assistant** uses the Default preset and requires an `openrouter` secret in Settings. **Parallel demo** makes two HTTP calls to httpbin.org and needs network access. To try a local echo without keys, make a workflow with Chat Input `message` → Chat Output `value`.

## Architecture

- `packages/shared`: API models and Zod schemas.
- `packages/engine`: validated DAG executor, event callback, template helper, preset renderer, provider registry, node registry, and individual node implementations in `src/nodes/<type>/index.ts`. Independent ready nodes execute concurrently; condition branches skip and merges ignore skipped inputs.
- `packages/node-ui`: JSON-Schema-driven config form and optional custom panels.
- `apps/server`: Fastify API, JSON-file repository, encryption, workflow seeds, and execution persistence. The server owns all data and secrets.
- `apps/web`: React/Vite chat, React Flow workflow editor, Presets, and Settings. The UI calls the API; it does not execute workflows.

Frontend notifications live in `apps/web/src/alerts/`. Import `alerts` and call `alerts.error(message)`, `.success`, `.info`, or `.warning` from any module; React components can use `useAlerts()`. API failures toast automatically unless a request uses `{ silent: true }` to handle an error inline.

To add a node type: (1) create `packages/engine/src/nodes/<type>/index.ts` exporting a `NodeDefinition` with Zod config, typed ports (`dataType`, optional `description`), defaults and `execute(ctx)`; (2) optionally add `resolvePorts(config, resources)` for instance-specific ports (resources provide read-only access to presets without importing server code), and declare `templateFields` for config fields accepting `{{...}}`; (3) register the definition in `packages/engine/src/registry.ts`; (4) optionally add a custom config panel. `/api/node-types/:type/ports` resolves dynamic ports for the editor; validation and execution use the same resolver.

## Presets and LLM providers

A **preset** defines the final, ordered message list sent to an LLM. It contains typed **inputs** and an ordered list of discriminated **entries** (`message` or `input`)—model and sampler settings belong to each LLM node. Each input has a unique key, label, `messages` or `text` type, optional description, and enabled state. Every enabled input becomes a correspondingly typed port on LLM nodes that use the preset. An enabled `input` entry places the value of that input at its position: `messages` expands to its messages, while `text` becomes one message with the entry's selected role. An enabled `message` entry has a system/user/assistant role and templated content (`{{trigger.message}}`, `{{trigger.sessionId}}`, `{{input.message}}`, etc.). Empty text inputs and messages empty after templating are skipped. Removing or disabling an input makes connected edges invalid (shown red); validation catches stale handles.

Create and edit presets in the three-column Presets page (preset list, inputs/message order, selected-entry editor); the preview renders through the same engine renderer used for execution and shows warnings for unplaced inputs and references to unavailable template inputs. Preview text inputs can be supplied directly and message inputs can use a sample conversation or a selected session. A run snapshots its presets before execution.

The server exposes preset CRUD at `/api/presets`; `POST /api/presets/preview` accepts `{ preset, inputs?, sessionId? }` and returns `{ messages, warnings }`. LLM dynamic ports are resolved from the preset's enabled input definitions, so changing or removing an input makes stale workflow edges fail validation.

Message placement defaults to **ordered**, at its position in the entry list. **Depth** placement injects inside a selected enabled `messages` input that is placed by an enabled input entry: depth 0 inserts *after* the last message, depth 1 inserts *before* the last message, and depths beyond the input length insert at the start. For example, history `[user: Hello, assistant: Hi]` plus a system note at depth 1 produces `[user: Hello, system: Note, assistant: Hi]`. Entries at the same depth preserve preset list order. The shared schema validates unique input keys and entry IDs, entry references, and depth targets.

The LLM node selects a **provider**, **model**, **preset**, temperature, max tokens and optional samplers (top-p, frequency/presence penalties, stop sequences). History is only supplied through a preset slot; it is never added implicitly. Its outputs are `text` and `raw`. Each execution log records provider, model, sampler parameters and the final messages sent, without recording API keys.

Seeding uses stable IDs so concurrent initializers do not create duplicate Default presets or demo workflows. Seeds are added only when the corresponding store is empty.

To add a provider, implement `LlmProvider` in `packages/engine/src/providers/` with `id`, `label`, `secretName` and `chat(request, { apiKey, signal })`, returning `{ text, raw, usage? }`. Register the provider in the provider registry and import its module during startup (the existing OpenRouter implementation is an example). The request is provider-neutral; translate sampler names into your provider's API format. The provider picker is served by `/api/providers`, and the engine looks up the configured secret by `secretName`. Streaming can be added as a separate method in a future release.

## Ports & types

Ports declare `text`, `number`, `boolean`, `object`, `array`, `messages`, or `any` (legacy ports default to `any`). The same compatibility rule is used in the editor and executor:

| Output → input | Result |
| --- | --- |
| Same type, or `any` on either side | Pass through unchanged |
| `number`, `boolean`, `object`, `array` → `text` | Convert to text (objects/arrays as pretty JSON) |
| `messages` → `text` | Convert to a `role: content` transcript |
| `messages` → `array` | Pass through unchanged |
| All other differing types, including `text` → `number`/`boolean` | Rejected; no implicit parsing |

Memory's `history` output is `any` because its `format` setting can emit either text or messages. Hover over a port to see its type and description; compatible connections that convert data are dashed. Invalid saved edges remain visible in red for correction.

## Data and secrets

`data/` is gitignored. Workflows, presets, sessions and execution logs are separate JSON files written via temporary-file-and-rename. Persistence is behind a `Repository<T>` interface for a future database. Secrets are AES-256-GCM encrypted in `data/secrets.enc.json`; a 32-byte key comes from `SECRETS_KEY` (64 hex characters), or is generated in `data/.master.key` on first start. **Back up both encrypted secrets and the master key.** The secrets API returns only names and masked hints; key values can only be set or deleted. For a production deployment, provide `SECRETS_KEY`, restrict access to the server and data directory, and put authentication in front of the API.

Executions report node status, timing, outputs and errors; engine events are available for a future streaming transport. Workflow edits affect subsequent messages in all sessions bound to that workflow.
