# API reference

The contract in `packages/shared/src/api/` is the only definition of each endpoint's request and response; this page
is the map, with the behaviour the schemas can't show. All JSON. Errors are always
`{ error: { code, message, details? } }`: `400` for a body or params that don't parse (the standard validation
envelope), `404 NOT_FOUND` for a missing record, and the specific codes below.

## Chats

| Method and path | Request | Answer |
| --- | --- | --- |
| `GET /api/sessions` | | `200` summaries, without `state`. |
| `POST /api/sessions` | Exactly one of `workflowId` (legacy shape) or `triggers` (the reply list), plus optional `title`, `characterId`, `personaId` | `201` the session. `400` when both or neither are given. |
| `GET /api/sessions/:id` | | `200` the whole session, `state` included. |
| `PATCH /api/sessions/:id` | Any of `title`, `triggers` (a whole replace), `workflowId` (a list of that workflow alone), `characterId`/`personaId` (`null` clears), `settings` (a partial merge; `null` removes a key) | `200` the session. `400 TRIGGERS_INVALID` (empty list, repeated workflow, `triggers` with `workflowId`); `404` unknown workflow; `400 CHAT_SETTING_INVALID` with `details.issues: { key, message }[]` (nothing is written). Never advances `updatedAt`. |
| `DELETE /api/sessions/:id` | | `204`. Stops the chat's running job first. |
| `POST /api/sessions/:id/messages` | `{ content? }` (empty or absent: no user message is stored) | `200` `{ userMessage?, assistantMessages, execution?, executions }`. See errors below. |
| `POST /api/sessions/:id/messages/stream` | same | SSE, `turnEventSchema`: `turn.start` (the turn id), `run.start { runId, workflowId, workflowName }` per run, `node.*` events tagged with `runId`, then `turn.complete` or `turn.error`. A refusal before the turn starts is a plain JSON error. |
| `POST /api/sessions/:id/stop` | | `204`. Stops whichever job holds the chat's slot (turn, regenerate, after section). The stream ends with `turn.error` `TURN_STOPPED`. |
| `PATCH /api/sessions/:id/messages/:messageId` | `{ content }`, trimmed, at least 1 character | `200` the message; `editedAt` is stamped when the content changed. `404` for an inactive message. |
| `DELETE /api/sessions/:id/messages/:messageId` | | `204`. `404` for an inactive message. |
| `POST /api/sessions/:id/regenerate` | | `200` `{ assistantMessages, execution }`. `409 NOTHING_TO_REGENERATE` when the last turn has no assistant reply. |
| `POST /api/sessions/:id/regenerate/stream` | | SSE, the same events as `messages/stream`. |
| `PATCH /api/sessions/:id/alternative` | `{ executionId }` | `200` the session. `409 TURN_RUNNING` while any job holds the chat; `400 NOT_AN_ALTERNATIVE` unless it is an alternative of the last turn. |
| `POST /api/sessions/:id/fork` | `{ messageId }` | `201` the new session. `400 NOT_A_FORK_POINT`; `404` unknown chat, unknown or inactive message; `409 TURN_RUNNING`. |
| `GET /api/sessions/:id/state` | | `200` the computed story state view (see [story-state.md](story-state.md#the-state-view)). |
| `GET /api/executions/:id` | | `200` one run's execution log. |

**Sending a message.** Every enabled workflow is prepared before anything is stored: `400 NO_ENABLED_WORKFLOW` when
none is enabled, `WORKFLOW_INVALID` for the first invalid one (details `{ workflowId, workflowName, issues }`, each
issue `{ message, edgeId?, nodeIds? }`). A run that fails gives `500 WORKFLOW_EXECUTION_FAILED`, a stop
`TURN_STOPPED`; both carry `turnFailureDetailsSchema` in `details`: the saved user message, the replies so far
(`partial` rows) and the logs. `executions` lists the log of every run of the reply section; `execution` is the first
run's on success, the failing run's on failure, absent when no workflow of the chat replies.

## Workflows and nodes

| Method and path | Request | Answer |
| --- | --- | --- |
| `GET /api/workflows`, `GET /api/workflows/:id` | | `200` |
| `POST /api/workflows` | the workflow (`settings` included, so a duplicate keeps them) | `201` |
| `PUT /api/workflows/:id` | the workflow; a body without `settings` keeps the stored ones | `200`. Edges to ports that no longer exist are pruned. Not validated. |
| `DELETE /api/workflows/:id` | | `204`; `409 WORKFLOW_IN_USE` while a chat's reply list names it. |
| `POST /api/workflows/:id/validate` | | `200` when valid; `422 WORKFLOW_INVALID` with the issues. |
| `GET /api/node-types` | | `200` every node type's descriptor (ports, config schema, defaults, `sink`, `dynamicPorts`). |
| `POST /api/node-types/:type/ports` | the node's config | `200` its resolved inputs and outputs (for `dynamicPorts` types). |

## Presets

| Method and path | Request | Answer |
| --- | --- | --- |
| `GET /api/presets`, `GET /api/presets/:id` | | `200` |
| `POST /api/presets` | the preset; a client `source` is stripped | `201` |
| `PUT /api/presets/:id` | same | `200`. `409 PRESET_READ_ONLY` for an imported preset. Workflow edges into inputs that no longer exist are pruned. |
| `DELETE /api/presets/:id` | | `204`; `409 PRESET_IN_USE` while an LLM node uses it. |
| `POST /api/presets/preview` | `{ preset, inputs?, sessionId? }` | `200` `{ messages, warnings }`: text inputs as strings, messages inputs as arrays (an explicit array is used as is; an omitted one falls back to the chat's history or a sample). With `sessionId` the chat's next-turn settings and state apply; without, every setting is its default and every state key too, at turn 1. |
| `GET /api/import-sources` | | `200` `{ id, app, path, lastSyncAt? }[]` |
| `PUT /api/import-sources/:app` | `{ path }` | `200`. `400 IMPORT_SOURCE_INVALID` unless the folder holds a `data/` folder. |
| `POST /api/import-sources/:app/sync` | | `200` `{ created, updated, unchanged, missing }`. `409 IMPORT_SOURCE_NOT_SET`; `400 IMPORT_SOURCE_INVALID` when the folder has gone. |

## Providers and secrets

| Method and path | Request | Answer |
| --- | --- | --- |
| `GET /api/providers` | | `200` the built-in providers first, then the user's (`builtIn` flag). |
| `GET /api/providers/:id` | | `200` (the id may be a built-in one such as `openrouter`). |
| `POST /api/providers` | `name`, `baseUrl` and the optional fields | `201`; `400` for a bad URL, secret name or kind. |
| `PUT /api/providers/:id` | same; an omitted `secret` is removed, unknown stored fields survive | `200`; `409 PROVIDER_READ_ONLY` for built-ins. |
| `DELETE /api/providers/:id` | | `204`; `409 PROVIDER_READ_ONLY`; `409 PROVIDER_IN_USE` (details: workflow names). |
| `POST /api/providers/:id/duplicate` | | `201` an editable copy named `<name> (copy)`, built-ins included. |
| `GET /api/providers/:id/models` | `?refresh=true` skips the cache | `200` `{ models, fetchedAt }`. `400 PROVIDER_SECRET_MISSING`; `502 PROVIDER_MODELS_FAILED` (redacted message). |
| `GET /api/secrets` | | `200` names and masked hints only. |
| `PUT /api/secrets/:name` | `{ value }`; names are letters, digits, `_` and `-` | `204`. Values can never be read back. |
| `DELETE /api/secrets/:name` | | `204` |

## Collections and state definitions

| Method and path | Request | Answer |
| --- | --- | --- |
| `GET /api/collections` | | `200` summaries `{ id, name, description?, entryCount, createdAt, updatedAt }`, in file-name order. |
| `GET /api/collections/:id` | | `200` the whole record. |
| `POST /api/collections` | `name`, `description?`, `entries` (required: a write replaces them) | `201`. Client bookkeeping is ignored. |
| `PUT /api/collections/:id` | same | `200`; an omitted description is removed; unknown stored fields survive. |
| `DELETE /api/collections/:id` | | `204`; `409 COLLECTION_IN_USE` (details: workflow names) while a Recall or Draw node lists it. |
| `GET /api/state-definitions`, `GET /api/state-definitions/:id` | | `200`, in file-name order. |
| `POST /api/state-definitions` | `name`, `description?`, `keys` (required) | `201`; `409 STATE_DEFINITION_NAME_TAKEN`. |
| `PUT /api/state-definitions/:id` | same | `200`; `409 STATE_DEFINITION_NAME_TAKEN`; `409 STATE_DEFINITION_IN_USE` for a rename while a chat holds live data under it. Prunes workflow edges to ports that no longer exist. |
| `DELETE /api/state-definitions/:id` | | `204`; `409 STATE_DEFINITION_IN_USE` while a chat holds live data or a node uses it. Details `{ sessions: { id, title }[], workflows: string[] }`. |

## Characters and personas

| Method and path | Purpose |
| --- | --- |
| `GET/POST /api/characters`, `GET/PUT/DELETE /api/characters/:id` | CRUD |
| `POST /api/characters/import` | Multipart JSON or PNG cards; `{ imported, failed }` |
| `GET/PUT /api/characters/:id/avatar` | The avatar image (20 MB per upload) |
| `GET /api/characters/:id/export?format=json\|png` | The card, V2 and V3 |
| `GET/POST /api/personas`, `GET/PUT/DELETE /api/personas/:id` | CRUD |
| `POST /api/personas/import` | Images (a card inside is used when present); `{ imported, failed }` |
| `GET/PUT /api/personas/:id/avatar` | The avatar image |

## App settings and events

| Method and path | Request | Answer |
| --- | --- | --- |
| `GET /api/app-settings` | | `200` the settings with defaults filled in. |
| `PATCH /api/app-settings` | a partial body | `200` the whole settings; `500 APP_SETTINGS_UNREADABLE` when the file is not a JSON object. |
| `GET /api/events` | | SSE, `changeEventSchema` (event name = `type`): `presets|providers|collections|stateDefinitions.changed` with `invalidFiles: { file, reason }[]`, and `workflows|characters|personas|sessions.changed` with an optional record `id`. Every type is sent once on connect; a `: keepalive` comment every 15 s. Events only say something changed: clients re-fetch. |
