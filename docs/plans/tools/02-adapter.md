# Step 2: tools in the adapter

Design: [README.md](README.md). Files: `packages/engine/src/providers/` (`index.ts`, `openai-compatible.ts`,
`wire-settings.ts`, `wire-log.ts`), `packages/shared/src/provider.ts`, `packages/shared/src/models.ts`. No per-backend
branches: every backend difference is a provider record field.

## Request

- `ChatRequest` gains `tools?: ToolDefinition[]`, `toolChoice?: 'auto' | 'none' | 'required'` and
  `parallelToolCalls?: boolean`. They go on the wire as `tools`, `tool_choice`, `parallel_tool_calls`, only when set,
  and before `extraBody` (which still wins).
- Messages are serialized from the canonical message:
  - `role`, `content` (`null` when it is `''` and the message has `tool_calls`), the name through `messageName`;
  - `tool_calls` verbatim (unknown fields included), `tool_call_id`;
  - `provider_data` spread into the message (its keys are the record's replay fields, see below);
  - `reasoning` sent under the record's `reasoningReplayField` when the node asked for it (the node decides which
    messages keep `reasoning`; the adapter only spells it). `null` (the default) never sends it.
  - `provenance` is never sent.

## Response

- `ChatResponse` gains `message: ConversationMessage` (the assistant message: content, `tool_calls`, `reasoning`,
  `provider_data`, `provenance` = the record id and the request's model) and `finishReason?: string`. `text` and
  `reasoning` stay as they are, so existing callers don't change.
- Non-streaming: `tool_calls` read from `choices[0].message`; `content: null` reads as `''`. "No assistant text" is an
  error only when there is neither content nor tool calls.
- Streaming: `delta.tool_calls[]` merged by `index`: `id`, `type` and `function.name` are set once, `function.arguments`
  is concatenated, other fields are merged (SillyTavern's rule). Content and reasoning deltas still stream through
  `onToken`/`onReasoning`; tool-call deltas don't.
- Replay fields: the provider record gains `replayFields: string[]` (default `[]`, per-model override like
  `reasoningFields`). Those top-level fields of the response's assistant message (or folded from the stream deltas,
  arrays concatenated, objects merged) are copied into `provider_data`. The built-in OpenRouter record sets
  `['reasoning_details']` and `reasoningReplayField: 'reasoning'`.
- The `raw` object keeps mirroring the non-streaming shape and gains `tool_calls` in its message.

## Wire log as a list

A tool loop makes several HTTP calls. `nodeExecutionSchema` gains `wires?: WireExchange[]` (one per call, in order).
New logs write `wires`; `wire` stays parseable for old logs and is no longer written. `ctx.recordWire` keeps its
signature but the executor turns it into "record into the current call": a new `ctx.beginWire()` (or an index on
`ChatOptions.onWire`, the coding agent picks the simplest) starts the next entry. The web's execution details show
`wires` as a numbered list of calls, `wire` as before.

## Model support

No emulation. A backend that refuses `tools` answers an error, which reaches the node error as today (redacted). The
model picker may show a "no tools" hint from OpenRouter's `supported_parameters` (already normalized in
`ProviderModel`), but nothing is blocked. See the open question in the README.

## Tests

Adapter tests with a fake fetch: tools in the body (and `extraBody` still last), `content: null` rule, tool calls
parsed (non-stream and stream, split arguments across many chunks, two parallel calls by index), replay fields copied
and sent back, reasoning replay field, wire list (two calls give two entries; old single `wire` logs still parse).

## Docs

`docs/PROVIDERS.md`: tool support, `replayFields`, `reasoningReplayField`. `AGENTS.md`: the wire log is a list; tool
calls are kept verbatim; replay fields are record fields, never adapter branches.
