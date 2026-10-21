# Providers reference

How the LLM node reaches a backend. User guide, with examples per backend: [docs/PROVIDERS.md](../../PROVIDERS.md).
The design (records, not code) is in PLAN.md ("user-defined LLM providers", "provider model catalogs").

## Records

A provider record says how to reach one OpenAI-compatible backend. The LLM node's `provider` config holds its id.

| Field | Meaning |
| --- | --- |
| `id` | A UUID for user records; built-ins have fixed ids (`openrouter`, `abliteration`). |
| `name` | The label in the node's dropdown; the file is named after it. |
| `kind` | `openai-compatible`, the only wire protocol (default). |
| `baseUrl` | `http(s)://`; requests go to `<baseUrl>/chat/completions`. |
| `secret` | Optional name of a stored secret; without it no `Authorization` header is sent. |
| `headers` | Extra request headers (default `{}`). |
| `messageName` | Wire field carrying a message's `name`; `null` = never send it (default `name`). |
| `reasoningFields` | Fields read for the reasoning trace, first non-empty wins (default `[reasoning, reasoning_content]`). |
| `replayFields` | Response message fields kept in the message's `provider_data` and sent back with it later (default `[]`; OpenRouter: `[reasoning_details]`). |
| `reasoningReplayField` | Wire field a message's `reasoning` is sent back under; `null` = never (default; OpenRouter: `reasoning`). |
| `mergeAssistantMessages` | Join consecutive assistant messages before sending (default `false`). |
| `extraBody` | Merged into the request body last (default `{}`). |
| `overrides` | `[{ match, ...any of the fields above but kind and baseUrl }]`: the first entry whose `match` glob fits the model id replaces those fields; `headers` and `extraBody` are shallow-merged. |

- **Built-ins** (`builtInProviders` in shared) are defined in code and read-only: OpenRouter (id and secret
  `openrouter`) and abliteration.ai (id and secret `abliteration`). They are listed first, with `builtIn: true`. A
  stored file claiming a built-in id is invalid, since user ids must be UUIDs.
- **Storage** is `data/providers/<slug-of-name>.yaml` through the shared YAML repository (see
  [storage.md](storage.md#yaml-repositories)). Keys are written in the order `name, kind, baseUrl, secret, headers,
  messageName, reasoningFields, extraBody, overrides, …, id, createdAt, updatedAt`. The directory is watched, and
  every API write also publishes `providers.changed`.
- **Resolution.** `prepareWorkflow` snapshots records into `resources.providers` (built-in ids resolve in the
  engine). The LLM node reads its record, then hands it to the adapter for its `kind`:
  `chat(request, { provider, apiKey?, signal })`, or `stream(...)` with `onToken`/`onReasoning`. An unknown id is the
  node error `Unknown LLM provider: <id>`; a missing secret is `Missing <secret> secret. Add it in Settings.`

## The OpenAI-compatible adapter

One generic adapter (`providers/openai-compatible.ts`) for every record; per request it resolves the record's wire
settings for the model (`resolveWireSettings`).

- **Overrides.** `match` is a case-sensitive glob over the whole model id; `*` is the only wildcard and also matches
  `/`. An explicit `null` in an override wins over the provider's value.
- **Request.** `POST <baseUrl>/chat/completions` with `Authorization: Bearer <secret>` (only when the record names a
  secret), then `Content-Type`, then the resolved headers. A message's `name` goes to the `messageName` field when set
  (an empty name counts as set). Samplers keep their OpenAI names; reasoning options go out as OpenRouter's
  `reasoning` object (`effort`, `max_tokens`, `exclude`) for every record. Tool fields go out only when set.
  `extraBody` is spread last, so it can override anything (`reasoning: null` sends a JSON `null`; it can't remove a
  key; overriding `stream` breaks stream parsing).
- **Merging assistant messages** (`mergeAssistantMessages`) runs when the body is built, so it applies to every step
  of a tool loop and the wire log shows the merged list: consecutive assistant messages without tool calls, with the
  same `name` and no `provider_data`, joined with a blank line (their reasoning too).
- **Response.** The reasoning trace is the first non-empty `reasoningFields` entry of each stream delta, or of the
  non-stream `choices[0].message`; both modes return it as `ChatResponse.reasoning`. The streamed `raw` mirrors a
  non-stream response and reports reasoning as `message.reasoning` whatever field it came from; the non-stream `raw`
  is the upstream JSON unchanged. Tool calls are kept verbatim and stream deltas merged by `index`; `replayFields` are
  copied into the message's `provider_data`.
- **Errors and timeouts.** 120 s idle between stream chunks, 600 s for a whole non-stream request. Errors read
  `<provider name> <status>: <message>`; a non-JSON `200` is `<provider name> returned a response that is not JSON`.

## The wire log

The adapter reports each HTTP call through `ChatOptions.onWire` (the node passes `ctx.recordWire`, which writes the
node's current entry of `nodes[id].wires`; `ctx.beginWire()` starts the next). It reports once before `fetch`
(`{ url, method, headers, body }`, `body` being the exact object serialized) and again with `status` and `response`,
each report replacing the last, so a failed or timed-out call still shows what was sent.

- `response` is the parsed JSON (or the text, cut to 2000 characters), errors included; for a stream, the chunks
  folded into one object under the backend's own field names (string fields of `delta` concatenated), also when the
  stream fails midway. It is not the node's `raw` output.
- **Redaction** happens in the adapter before the callback: headers whose name matches
  `auth|key|token|secret|cookie|password` are masked (`Bearer [redacted]` keeps the scheme), and the secret value is
  replaced wherever it appears, in the report and in the adapter's error messages. Values typed into a record's
  `baseUrl` or `extraBody` are record data, not secrets, and are logged as sent.

## Model lists

- The adapter's optional `listModels({ provider, apiKey?, signal })` does `GET <baseUrl>/models` with the chat rule
  for auth and the record's top-level headers (override headers are per model, so not sent), bounded by a 30 s
  timeout.
- `normalizeModels` (shared) reads every backend the same way: `id`, `name`, `description`, `contextLength`,
  `maxOutputTokens`, input and output modalities, `supportedParameters`, and `pricing` in USD per token (zero kept;
  missing, blank, non-numeric and negative values such as OpenRouter's `-1` dropped). Entries without a string id and
  repeated ids are skipped; a payload without a `data` array is an error (an empty array is a valid, empty list).
  Errors name the provider (`<name> 401: ...`, `<name> could not be reached: ...`) and never contain the key
  (`withoutSecret`). The missing-secret text is shared with the LLM node (`missingSecretMessage`).
- **The catalog** (`ModelCatalog`, server) keeps lists in memory per provider for an hour, so the key never reaches the
  browser. An entry goes stale when the record changes (compared as a fingerprint of the whole record, since a file
  edited on disk keeps its timestamp) or any secret is written or deleted (`SecretStore.revision`). Concurrent requests
  share one fetch; failures are never cached; `?refresh=true` skips the cache.
- In the editor the model field stays a plain string; `ModelPicker` only suggests (filtered by every
  whitespace-separated term, 50 shown, with name, id, context size and price per 1M tokens when known).

## The provider editor

`apps/web/src/pages/providers/`, a narrow editor in L (`left=provider:<id>`), listing built-ins first from
`providersStore` (which the LLM node's dropdown also reads).

- A form for `name`, `baseUrl`, `secret` (suggests the saved secret names and warns when the name isn't among them),
  message names and `reasoningFields` as an ordered list; one YAML box for the advanced keys (`headers`, `extraBody`,
  `overrides`, `replayFields`, `reasoningReplayField`, `mergeAssistantMessages`). A missing advanced key is saved as
  empty, because a PUT keeps stored fields a body omits.
- Save validates the draft with `providerFieldsSchema` first and lists the problems above the form; the draft logic
  is `providerDraft.ts`.
- A built-in opens read-only with only **Duplicate**, which copies the saved record (disabled while the draft is
  dirty). Deleting a provider in use shows "Provider in use" with the workflow names.
- Disk changes follow the shared file sync (see [web.md](web.md#editors)).
