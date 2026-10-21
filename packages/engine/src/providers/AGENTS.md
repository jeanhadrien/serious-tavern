# LLM providers and the adapter — agent notes

User guide: `docs/PROVIDERS.md`; keep it in sync when provider behaviour changes.

## Providers are records, not code
- A provider record (`providerSchema`) is a YAML file under `data/providers/`. The built-in providers (OpenRouter with id and secret `openrouter`, abliteration.ai with `abliteration`) live in code, are never stored and are read-only. Adding one is a new `builtInProviders` entry plus the server tests that list built-ins; check the backend's request schema first (abliteration.ai rejects unknown body fields).
- The LLM node resolves its record through `ctx.resources.providers` (built-in ids are resolved by the engine), then picks the `LlmAdapter` for the record's `kind` and passes it the record.
- An unknown id is a node error. A set but missing `secret` is the "Missing <secret> secret" error, whose only text is `missingSecretMessage`. No `secret` means no key and no `Authorization` header.
- **Never send a record's key to a host other than its `baseUrl`.**

## The openai-compatible adapter
- **No per-backend branches.** New wire differences become record fields (PLAN.md), resolved per model by `resolveWireSettings` (first matching override wins).
- Nullable overrides must win when set to `null`: never resolve `messageName` or `reasoningReplayField` with `??`. `mergeAssistantMessages` is not nullable, so `??` is right there.
- `extraBody` is merged last and wins over every computed field, `tools`/`tool_choice`/`parallel_tool_calls` included.
- `mergeAssistantMessages` is applied in `requestBody`, so it holds for every loop step and the wire log shows the merged list. Consecutive assistant messages join with a blank line unless one has tool calls or `provider_data`, or their `name`s differ; their `reasoning` joins the same way.
- Requests are serialized from the canonical message (`wireMessage`): `tool_calls` and `tool_call_id` verbatim, `content: null` for an assistant message that only calls tools, `provider_data` spread in, `reasoning` under the record's `reasoningReplayField` (null: never sent), `provenance` and other app-only fields never sent.
- `tools`/`tool_choice`/`parallel_tool_calls` go out only when set; an empty `tools` list is not sent.
- **Tool calls are kept verbatim**, unknown fields included: `toolCallsOf` only adds a missing `type: 'function'` and `arguments: ''`, and drops the stream's `index`.
- Stream tool-call deltas merge by `index` (`mergeToolCalls`: `id`/`type`/`function.name` set once, `arguments` concatenated, other fields merged); the wire log folds them the same way.
- **Replay fields** (`replayFields`) are record fields, never adapter branches: the named top-level fields of the response message are copied into `message.provider_data` (in a stream, arrays concatenate, objects merge, anything else is replaced).
- Streamed `raw` always reports reasoning as `message.reasoning`, whatever wire field it came from.
- `ChatResponse.message` is the canonical assistant message with provenance `{ providerId, model, nodeId }`. The adapter can't know the node, so the caller passes `ChatOptions.nodeId` (required).
- "No assistant text" is an error only with neither content nor tool calls. A tool call without id or name is an error naming the provider.
- Non-stream reasoning: after `chat`, the LLM node emits `ChatResponse.reasoning` as one `reasoningDelta`. Never emit it on the stream path, or it doubles.
- Record fields that have no form field (`mergeAssistantMessages`, `replayFields`, `reasoningReplayField`, ...) are edited in the web provider editor's YAML box (`ADVANCED_KEYS`); add new ones there.
- Model lists go through the adapter's optional `listModels` (`GET <baseUrl>/models`, normalized by `normalizeModels`).

## Wire log
- An LLM node logs what went over the wire in `nodes[id].wires`, **one entry per HTTP call** (`url`, `method`, redacted `headers`, the exact `body` given to `fetch`, `status`, `response`; a stream's chunks folded under the backend's own field names).
- Adapters report through `ChatOptions.onWire` (the node passes `ctx.recordWire`): once before `fetch`, again with the response. Each report replaces the last, so a failed call keeps what was sent. A node that makes several calls calls `ctx.beginWire()` before each one, so the next report starts a new entry.
- **Redaction happens inside the adapter**, before the callback: credential-looking header names are masked and the secret value is scrubbed everywhere, including the adapter's thrown error messages (they reach `nodes[id].error` and toasts). Never hand an unredacted exchange out of the adapter.
- Older logs have a single `nodes[id].wire` and a canonical `request` field. Keep both parseable and displayed; neither is written anymore.

## Tests
`providers/tools.test.ts` covers tools on the wire. Fake adapters answer with `chatResponse(text)`, since `ChatResponse.message` is required.
