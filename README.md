# Serious Tavern

A single-user chat app where each conversation runs a visual, reusable workflow. TypeScript/ESM throughout; no account system or streaming in this MVP.

See [Plan & Vision](PLAN.md) for the product vision and planned next steps.

## Run

Requires Node.js 24 and npm. Run `npm install`, then `npm run dev`. Open the Vite URL shown in the terminal (normally http://127.0.0.1:5173). The API runs on http://127.0.0.1:3001; Vite proxies `/api`. Run `npm run typecheck`, `npm test`, and `npm run build` for validation.

Create a chat and choose a workflow. The seeded **Default Assistant** requires an `openrouter` secret in Settings. **Parallel demo** makes two HTTP calls to httpbin.org and needs network access. To try a local echo without keys, make a workflow with Chat Input `message` → Chat Output `value`.

## Architecture

- `packages/shared`: API models and Zod schemas.
- `packages/engine`: validated DAG executor, event callback, template helper, node registry, and individual node implementations in `src/nodes/<type>/index.ts`. Independent ready nodes execute concurrently; condition branches skip and merges ignore skipped inputs.
- `packages/node-ui`: JSON-Schema-driven config form and optional custom panels.
- `apps/server`: Fastify API, JSON-file repository, encryption, workflow seeds, and execution persistence. The server owns all data and secrets.
- `apps/web`: React/Vite chat, React Flow workflow editor, and Settings. The UI calls the API; it does not execute workflows.

Frontend notifications live in `apps/web/src/alerts/`. Import `alerts` and call `alerts.error(message)`, `.success`, `.info`, or `.warning` from any module; React components can use `useAlerts()`. API failures toast automatically unless a request uses `{ silent: true }` to handle an error inline.

To add a node type: (1) create `packages/engine/src/nodes/<type>/index.ts` exporting a `NodeDefinition` with Zod config, typed ports (`dataType`, optional `description`), defaults and `execute(ctx)`; (2) declare `templateFields` for config fields that accept `{{...}}` variables; (3) register the definition in `packages/engine/src/registry.ts`; (4) optionally add a component to `customPanels` in `packages/node-ui/src/index.tsx`. The editor automatically renders other types using the serialized config schema and port metadata.

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

`data/` is gitignored. Workflows, sessions and execution logs are separate JSON files written via temporary-file-and-rename. Persistence is behind a `Repository<T>` interface for a future database. Secrets are AES-256-GCM encrypted in `data/secrets.enc.json`; a 32-byte key comes from `SECRETS_KEY` (64 hex characters), or is generated in `data/.master.key` on first start. **Back up both encrypted secrets and the master key.** The secrets API returns only names and masked hints; key values can only be set or deleted. For a production deployment, provide `SECRETS_KEY`, restrict access to the server and data directory, and put authentication in front of the API.

Executions report node status, timing, outputs and errors; engine events are available for a future streaming transport. Workflow edits affect subsequent messages in all sessions bound to that workflow.
