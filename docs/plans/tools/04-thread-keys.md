# Step 4: thread keys

Design: [README.md](README.md). Files: `packages/shared/src/state/` (definition, node-values, fold-slots, snapshot,
preview), `packages/engine/src/nodes/state-write/`, `apps/server/src/services/` (state view), the definitions editor
(`apps/web/src/pages/stateDefinitions/`), the chat's Story state section (`apps/web/src/pages/chat/story/`).

## Key type

`stateKeyDefSchema` gains `{ type: 'thread', cap?: number }` (additive; `stateKeyTypes` gains `thread`). A thread's
items are exchanges:

```
{ id, text, exchange: ConversationMessage[], input?: ConversationMessage, turnId, runId }
```

- `text` is the exchange's final text (`exchangeText`), so `{{#each state.<def>.<key>}}{{text}}{{/each}}` and every
  existing item preview keep working.
- `exchange` is never named `messages`: that name is the built-in link to chat messages on collection items.
- `turnId` (the turn's id) and `runId` (the writing run's execution id) are stamped by the engine at write time; the
  Thread node uses them to place the exchange in the chat (step 6). `ctx.trigger` gains `turnId` (additive; the server
  passes the turn id to every run). Nothing parses item ids.
- `input` is the optional user side of the exchange (see State Write below).
- **Reasoning is left out by default.** `threadItem` strips `reasoning` and `provider_data` from the stored exchange
  unless State Write's `keepReasoning` option (thread keys only, default off) is on. Prior-turn reasoning is rarely
  needed by backends and the round-trip data can be large encrypted blobs; the run's execution log still holds the
  whole exchange. `provenance` is always kept (small, and the Thread node needs `nodeId`).

> **TODO (later): store exchanges by reference.** Every item stays in `session.state.turns` for good (turns are never
> compacted), and the session file is rewritten whole on each streaming flush and settle. For now exchanges are stored
> inline (decided with the user). Later candidates: a small item in state pointing to the run log's `exchange` output,
> or a per-session sidecar file keyed by item id. Either needs a migration plan and a rule that logs or sidecars a
> thread points to are never deleted (the Fork contract already asks this of logs).

## Ops and fold

- Ops (`stateOpsFor('thread')`): `add`, `remove`, `delete`. Never `set` or `increment`.
- The fold treats a thread like a collection (`foldDefinitionKey`: `suits` and `foldCollection`), `cap` included.
  Items are not checked by the fold, like collection items today.
- The commit-time link check (`commitItemLinks`) never applies (no `messages` field).
- Turn rules come for free: deleting a reply, regenerate, swipes, fork, runs after the reply.
- Every switch on the key type gets a `thread` case. Known places: `stateKeyTypes`, `stateKeyPortType`, `stateOpsFor`,
  `keyDefault`, `suits` and `foldDefinitionKey` (fold-slots), `describeKey`, `smallValues` (the view's history),
  `stateReadsFor` (State Read modes), `stateHints`, the definitions editor's type list and compile, and the web's
  `storyModel`. The coding agent greps for the others (`'collection'`).

## Writing

`threadItem(value, input?)` in `node-values.ts`, beside `collectionItem`: the value must be a non-empty list of
canonical messages that parses; `input` may be text (stored as a `user` message) or one message. Anything else is a
plain-language problem.

State Write on a thread key:

- `add`: the `value` input takes the LLM's `exchange`; a new optional `input` input (`requiredIfConnected`, any of text
  or a message) and the `keepReasoning` option appear only for thread keys (`resolvePorts`). The fixed `value` literal
  is not offered for threads.
- `remove` (by item id) and `delete` as for collections; `when` as for every op.
- The State Write panel and the `StateKeyPicker` list thread keys; the op picker follows `stateOpsFor`.
- The generated state tools of step 3 never offer thread keys.

## Reading and the view

- State Read on a thread key reads the items (`value`, `count`), like a collection. The Thread node (step 6) is the way
  to get messages.
- `{{state.<def>.<key>}}` exposes the items; `stateHints` hints the key like a collection.
- **The state view stays small.** `previewWrite` shows a thread add as its `text` (cut at the usual limit) plus
  `steps` (assistant messages) and `toolCalls` (names), never the exchange. The view's thread items carry the same
  summary. The full exchange is read from the execution log of `runId` (the LLM node's `exchange` output is in it).
- The Story state section shows a thread key as its items' texts with a small "3 tool calls" note and a link to the
  run's log. The delete check works unchanged (it runs the shared fold).

## Definitions editor

The key type list gains Thread (cap only). Changing a key from collection to thread or back is allowed like any type
change: stored writes that don't suit the new type are ignored and reported, as today.

## Tests

Shared: schema (old definitions unchanged), fold of a thread (add, remove, cap, delete, turn presence), `threadItem`
problems, preview summary. Engine: State Write add with `exchange` and `input`, refusals. Server: the state view of a
thread is small (no exchange), a turn with a thread write and its deletion. Web: definitions editor round-trip of a
thread key.

## Docs

`docs/STATE-AND-LORE.md`: thread keys. `AGENTS.md` Story state: the item shape, `exchange` vs `messages`, the view never
carries the exchange, `turnId`/`runId` stamped by the engine, reasoning left out unless `keepReasoning`, and the
by-reference TODO.
