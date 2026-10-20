# Step 5: the Thread node

Design: [README.md](README.md). Files: `packages/shared/src/conversation/weave.ts` (new, pure), `packages/engine/src/
nodes/thread/` (new), `registry.ts`, `packages/shared/src/state/snapshot.ts`, `state-definition-usage.ts` (server),
`packages/node-ui/src/panels/` (panel).

## The node

- **Thread** (category History). Config: `definitionId` + `key` (a thread key, picked with the State Read picker,
  `kind="thread"`), `lastN` (exchanges, unset = all that the key's `cap` keeps), `withInputs` (default on).
- Input: `history` (`messages`, optional, `neverSkips` like Recall's text so the node still runs without it).
- Output: `messages` (`messages`), ready for a preset slot.
- Static ports; an unknown key is a run-time error naming the node (like Unlinked Messages).
- `state-definition-usage.ts` counts Thread nodes as users of a definition.

## Without `history`: the thread alone

Items oldest first (the last `lastN`); for each: its `input` as a `user` message when `withInputs` and present, then its
`exchange`. Consecutive assistant messages are left as they are (the provider may merge them, step 6).

## With `history`: woven into the chat (`weaveThread`, shared, pure)

The chat comes in as the node received it (usually Chat Input's or Memory's `history`, already `activeMessages`).

- **Turn order.** `StateSnapshot` gains `turnIds: string[]` (the present turns' ids, oldest first, from the fold's
  `turns`; additive). Chat messages carry their turn id (`executionId`); items carry `turnId`.
- **Placement.** Each item goes into its own turn:
  - if a chat reply of that turn has `runId === item.runId`, the exchange's tool blocks are inserted right before the
    first such reply, and the exchange's final assistant message is dropped when its content equals (trimmed) a reply
    of that run: the chat already holds that text;
  - otherwise the whole exchange goes after the turn's last chat message;
  - a turn with no chat message in the history (a reply-less turn, a turn cut by Memory's `lastN`) puts its items after
    the last message of the nearest earlier turn present in the history; items older than the whole history are left
    out (the history was cut on purpose).
  - `input` is never used when weaving: the chat is the user side.
- Messages without an `executionId` (older chats) stay where they are; nothing is reordered.
- Items of the running turn (written by an earlier run of the same turn) go after the history's last message.

## Tests

Shared table tests for `weaveThread`: reply in the same run (tool blocks before it, final text dropped / kept when
different), after-section exchange, reply-less turn, history cut by `lastN`, several items in one turn, legacy messages
without turn ids, regenerated turn (inactive alternative's items are not in the fold). Engine: the node alone and woven.
A server test: a two-turn chat where a tool-using node's exchange is stored and woven into the next turn's prompt.

## Docs

`README.md`: the Thread node. `AGENTS.md`: weave rules live only in shared `weaveThread`; placement uses `turnId`/`runId`
on items and `turnIds` on the snapshot, never positions or parsed ids.
