# Step 1: the canonical conversation (shared)

Design: [README.md](README.md). Pure code in `packages/shared/src/conversation/`, with table tests. Nothing calls it
yet except the existing `PromptMessage` users, which must keep working unchanged.

## Message

`conversationMessageSchema` (passthrough) is the OpenAI Chat Completions message plus app-only fields:

| Field | Type | Notes |
|---|---|---|
| `role` | `system \| user \| assistant \| tool` | |
| `content` | `string` | Always a string in the app. An assistant message that only calls tools has `''`; the adapter sends `null` for it (step 2). Multimodal content arrays are out of scope. |
| `name` | `string?` | As today; sent through the record's `messageName`. |
| `tool_calls` | `ToolCall[]?` | Assistant only. Each `{ id, type: 'function', function: { name, arguments } }`, passthrough: unknown fields of a call (Gemini's thought signature lives there) are kept and sent back verbatim. `arguments` is the raw JSON text the model produced, never re-serialized. |
| `tool_call_id` | `string?` | `tool` only, required there. |
| `reasoning` | `string?` | App-only. The reasoning text, as today on chat messages. |
| `provider_data` | `Record<string, unknown>?` | App-only. Message-level fields the backend needs back, named by the provider record (step 2), copied verbatim from the response. |
| `provenance` | `{ providerId, model, nodeId }?` | App-only. On assistant messages the app produced: the provider record, the model and the LLM node that called it (the Thread node uses `nodeId`, step 6). |

- Tool field names stay in the wire's snake_case on purpose: a stored thread is a readable OpenAI conversation.
- `promptMessageSchema` becomes this schema (same export name, additive: `tool` role, optional fields). The existing
  type `PromptMessage` widens; every place that builds one keeps compiling. `content` stays a required string, so the
  `messages` port detection (`sourceType` in `engine/src/text.ts`) and `messages-to-text` keep working.
- `messages-to-text` coercion (`coerceValue`) learns tool calls: an assistant message with calls renders
  `assistant: <content>` followed by one `assistant -> <name>(<arguments>)` line per call; a `tool` message renders
  `tool <name>: <content>` (the name is looked up from the call it answers, `tool` alone when unknown). Long arguments
  are not cut (it is the user's text).

## Tools

`toolDefinitionSchema`: `{ type: 'function', function: { name, description?, parameters } }`, `parameters` a JSON
Schema object (not checked beyond being an object). `toolNameSchema`: `^[A-Za-z0-9_-]{1,64}$`, the strictest common
rule across backends.

## Blocks and repair

- `messageBlocks(messages)`: splits a list into blocks (see Glossary). An assistant message with `tool_calls` opens a
  block that takes every directly following `tool` message whose `tool_call_id` is one of its calls. Everything else is
  a block of one message.
- `repairToolSequence(messages)`: `{ messages, dropped }`, a list every backend accepts:
  - a `tool` message that answers no call of the assistant block right before it is dropped;
  - an assistant message whose calls are not all answered keeps its content but loses the unanswered calls (and is
    dropped when nothing is left: no content and no calls);
  - `dropped` counts what was removed, for a node log line.
  Run on the final prompt (step 3) after preset rendering, merges and depth insertion, never on stored data.
- `exchangeText(exchange)`: the final assistant content of an exchange (`''` when there is none).

## Tests

Table tests for the schema (old `PromptMessage` shapes still parse, tool shapes, passthrough of unknown call fields),
`messageBlocks`, `repairToolSequence` (orphans at both ends, partial answers, interleaved system messages) and the
text coercion.

## Docs

`AGENTS.md` Key contracts: "Prompt messages are the OpenAI Chat Completions message" (fields above, app-only fields,
`content` always a string, `repairToolSequence` on prompts only).
