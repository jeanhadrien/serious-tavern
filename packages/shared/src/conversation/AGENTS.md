# Prompt messages and threads — agent notes

Prompt messages are the OpenAI Chat Completions message. Plan: `docs/dev/plans/tools/`.

## The canonical message
- `promptMessageSchema` is `conversationMessageSchema` (passthrough): `role` `system|user|assistant|tool`, `content`, `name`, `tool_calls` (assistant only), `tool_call_id` (required on `tool`), plus the app-only `reasoning`, `provider_data` and `provenance { providerId, model, nodeId }`, which the adapter never sends as is.
- `content` is **always a string**: a tool-calling assistant message has `''`, and the adapter sends `null`.
- Each tool call and its `function` are passthrough. `arguments` is the raw JSON text: **never re-serialize it**. Tool field names stay snake_case; tool names follow `toolNameSchema`.
- `name` is passed to the provider only when set.
- `messageBlocks` is the unit a prompt never splits (a tool call and its results).
- `repairToolSequence` (removes orphan tool messages and unanswered calls) and `flattenUndeclaredToolBlocks` run on the final prompt only, **never on stored data**.
- `messagesToText` (`transcript.ts`) writes calls as `assistant -> name(arguments)` and results as `tool <name>: <content>`; the flattening reuses its lines.

## Weaving a thread into the chat
Plan: `docs/dev/plans/tools/06-thread-node.md`.
- The rules live only in `weaveThread` (and `threadAlone` for a thread without history). Callers order and slice the items, then call them; they never place an exchange themselves.
- **Placement is structural**, never by message positions, parsed ids or text comparison:
  - a chat message's `executionId` is an item's `turnId`;
  - an item's answer is the reply with the item's `runId` and a `sourceNodeId` equal to the exchange's producer (`provenance.nodeId` of its assistant messages);
  - the turn order comes from `StateSnapshot.turnIds`.
- `StateSnapshot.turnIds` is the fold's present turns, oldest first. The running turn is in it only for the later runs of a turn, so the running turn's id is passed separately (`ctx.trigger.turnId`).
- `sourceNodeId` exists only on replies of passthrough Chat Outputs (partial ones included). A templated output's reply has none, and neither does a reply stored before the field existed: such an exchange is kept whole after its turn.
