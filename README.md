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

A **preset** defines the final, ordered message list sent to an LLM. It has declared **inputs** (the values a workflow supplies) and an ordered list of discriminated **entries** (`message` or `slot`) that assembles those values with fixed prompts. Each input has an `id`, unique key, optional label and description, and type (`messages` or `text`). Every input becomes one correspondingly typed LLM input port named by its key; the port label defaults to the key. A `messages` input expands to its message list. A `text` input becomes one message using the slot's role (default `user`) and is skipped when empty. The same input may be placed by multiple slots.

An enabled **message** entry has a system/user/assistant role and templated content; it can use `{{input.<key>}}`, `{{trigger.message}}` and `{{trigger.sessionId}}`. A **slot** places a declared input at its position in the final message list. Empty fixed messages are skipped. Inputs unused by any enabled slot or message template produce non-blocking warnings. Model and sampler settings belong to each LLM node. Preview and execution use the same renderer, and the preview accepts `{ preset, inputs?, sessionId? }` and returns `{ messages, warnings }`.

The **Default** preset declares `history` (`messages`, label “Chat history”) and `message` (`text`, label “User message”). Its entries are a system message named “Main prompt” containing `You are a helpful assistant.`, a slot for `history`, and a user-role slot for `message`. The Default Assistant workflow connects Chat Input `history` and `message` to those LLM ports.

Message placement defaults to **ordered**, at its position in the entry list. **Depth** placement references an enabled slot entry backed by a `messages` input and injects the message inside that slot's expanded conversation: depth 0 inserts *after* the last message, depth 1 inserts *before* the last message, and depths beyond the slot length clamp to the start. For example, history `[user: Hello, assistant: Hi]` plus a system note at depth 1 produces `[user: Hello, system: Note, assistant: Hi]`. Messages at the same depth preserve their order in the preset entry list. Changing/removing an input can make stale workflow edges invalid (shown red); validation catches stale handles.

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
