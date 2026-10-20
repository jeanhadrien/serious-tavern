# Step 6: the Thread node

Design: [README.md](README.md). Files: `packages/shared/src/conversation/weave.ts` (new, pure), `packages/engine/src/
nodes/thread/` (new), `registry.ts`, `packages/shared/src/state/snapshot.ts`, `packages/shared/src/models.ts`,
`apps/server/src/services/turn-stream.ts` and the settle path, `state-definition-usage.ts` (server),
`packages/node-ui/src/panels/` (panel).

## The node

- **Thread** (category History). Config: `definitionId` + `key` (a thread key, picked with the State Read picker,
  `kind="thread"`), `lastN` (exchanges, unset = all that the key's `cap` keeps), `withInputs` (default on).
- Input: `history` (`messages`, optional, `neverSkips` like Recall's text so the node still runs without it).
- Output: `messages` (`messages`), ready for a preset slot.
- Static ports; an unknown key is a run-time error naming the node (like Unlinked Messages).
- `state-definition-usage.ts` counts Thread nodes as users of a definition.
- **Plain items.** A key switched from collection to thread (or hand-edited data) can hold items without `exchange`.
  The node reads such an item as one assistant message holding its `text`, never an error.

## Item order

The fold returns items newest first, and items added in the same turn in reverse write order. The node works on the
reverse: oldest first, same-turn items in write order.

## Without `history`: the thread alone

Items oldest first (the last `lastN`); for each: its `input` as a `user` message when `withInputs` and present, then its
`exchange`. Consecutive assistant messages are left as they are (the provider may merge them, step 5).

## With `history`: woven into the chat (`weaveThread`, shared, pure)

The chat comes in as the node received it (usually Chat Input's or Memory's `history`, already `activeMessages`).

- **Turn order.** `StateSnapshot` gains `turnIds: string[]` (the present turns' ids, oldest first, from the fold's
  `turns`; additive). Chat messages carry their turn id (`executionId`); items carry `turnId`.
- **Which reply carries the exchange's answer (structural, never by text).**
  - Assistant messages gain `sourceNodeId?: string` (additive): the LLM node whose text the reply is, set at settle
    for replies of passthrough Chat Outputs (`passthroughSources` in `stream-bindings.ts` already maps each such
    output to its LLM). Replies of templated or non-passthrough outputs have none.
  - An exchange's producer is the `provenance.nodeId` of its assistant messages (step 1).
  - The item's answer is in the chat when a reply has `runId === item.runId` and `sourceNodeId === producer`.
- **Placement.** Each item goes into its own turn:
  - answer in the chat: the exchange's tool blocks are inserted right before that reply, and the exchange's final
    assistant message is dropped (the chat holds that answer, edited or not: the chat wins);
  - otherwise the whole exchange goes after the turn's last chat message (a scenarist, a templated output, a reply
    stored before `sourceNodeId` existed);
  - a turn with no chat message in the history (a reply-less turn, a turn cut by Memory's `lastN`) puts its items after
    the last message of the nearest earlier turn present in the history; items older than the whole history are left
    out (the history was cut on purpose);
  - `input` is never used when weaving: the chat is the user side.
- Messages without an `executionId` (older chats) stay where they are; nothing is reordered.
- Items of the running turn (written by an earlier run of the same turn) go after the history's last message.

## Tests

Shared table tests for `weaveThread`: answer in the chat (tool blocks before it, final message dropped, also after an
edit), templated output (whole exchange kept), scenarist in the after section, reply-less turn, history cut by `lastN`,
several items in one turn (write order), two LLM nodes of one run writing the same thread, legacy messages without turn
ids or `sourceNodeId`, regenerated turn (an inactive alternative's items are not in the fold), plain items. Engine: the
node alone and woven. Server: replies of passthrough outputs get `sourceNodeId`; a two-turn chat where a tool-using
node's exchange is stored and woven into the next turn's prompt.

## Docs

`README.md`: the Thread node. `AGENTS.md`: weave rules live only in shared `weaveThread`; placement uses `turnId`,
`runId`, `sourceNodeId` and `provenance.nodeId`, never positions, parsed ids or text comparison.
