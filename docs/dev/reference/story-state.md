# Story state reference

What a chat remembers between turns: values that workflow nodes write and later turns read. It belongs to one chat
and lives exactly as long as the replies of the turns that wrote it. The model is in `packages/shared/src/state/`
(the fold, the snapshot) and `packages/shared/src/links/` (message links); the engine buffers writes; the server
stores, folds and serves. User guide: [docs/STATE-AND-LORE.md](../../STATE-AND-LORE.md). Design:
`docs/dev/explorations/STATE-DESIGN-PROPOSAL-3.md` and `STATE-DESIGN-AMENDMENT-1.md`.

## Definitions

A definition is a YAML file, `data/state/definitions/<slug-of-name>.yaml`, through the shared YAML repository. The
seed `scene` is created only into an empty directory (no definition and no invalid file).

```yaml
name: scene
description: Pacing state for the creativity pipeline
keys:
  tension: { type: number, default: 3, min: 0, max: 10 }
  mood: { type: enum, options: [calm, uneasy, tense, release], default: calm }
  lastInjectionLevel: { type: number }
  injected:
    type: collection
    cap: 30
    fields: { level: number, entryId: text }
id: 8d1f6a42-3c5e-4b7a-9e21-5f0c7a1d9b34
createdAt: 2026-01-01T00:00:00.000Z
updatedAt: 2026-01-01T00:00:00.000Z
```

| Key type | Fields | Reads as when nothing (valid) was written |
| --- | --- | --- |
| `number` | `default`, `min`, `max` | `default`, else 0, kept within the bounds |
| `boolean` | `default` | `default`, else `false` |
| `enum` | `options` (text; quote numeric ones), `default` | `default`, else the first option |
| `text` | `default` | `default`, else `''` |
| `object` | `default`, `schema` (kept, not checked yet) | `default`, else `{}` |
| `collection` | `cap`, `fields` (`text`, `number` or `boolean` per extra field; `id` and `text` always exist) | `[]` |
| `thread` | `cap` | `[]` |

Every key may have a `description`, shown to the model by the LLM node's state tools.

- **Names** (definition and key) are template path segments: letters, digits and `_`, not starting with a digit, not
  reserved (`this`, `true`, `false`, `null`, `undefined`, `toString`, `constructor`, `prototype`, `__proto__`).
  Definition names are unique ignoring case (`409 STATE_DEFINITION_NAME_TAKEN`). A hand-edited duplicate isn't
  refused: the oldest definition (`createdAt`, then `id`) keeps the name and every run says so in its warnings.
- **Invalid:** contradicting number bounds, an enum default that isn't an option, repeated options, collection fields
  named `id` or `text`, new fields named `messages` or `link` (reserved for message links). Unknown fields at both
  levels are kept.
- **Editing keys is always allowed.** Stored data is never rewritten; the fold reads a value that no longer fits as
  the default. On save, the workflows' edges to vanished ports are pruned; a State node whose key or operation no
  longer fits stays connected and becomes a validation issue naming the node.
- **The name can't change under live data** (`409 STATE_DEFINITION_IN_USE`), because templates address definitions
  by name (nodes use the id). "Live" means a turn that still counts wrote it. A delete is refused the same way, and
  also while a State Read, State Write, Next Chunk, Unlinked Messages or Thread node uses it.

## Turn entries

`session.state` is `{ turns: TurnEntry[] }` (absent in older files). The server appends one entry per settled turn,
in the same update that saves the replies, whether the turn completed, failed or was stopped, with or without writes:

```json
{
  "executionId": "6f1c…",
  "at": "2026-01-01T12:00:00.000Z",
  "completed": true,
  "replies": 1,
  "runs": [{ "executionId": "6f1c…", "workflowId": "5a2e…", "part": "reply", "status": "completed" }],
  "writes": [
    { "op": "set", "nodeId": "bump", "target": { "kind": "definition", "definitionId": "8d1f…", "key": "tension" }, "value": 6 },
    { "op": "add", "nodeId": "note", "target": { "kind": "definition", "definitionId": "8d1f…", "key": "injected" },
      "item": { "id": "6f1c…:note:1", "text": "a storm", "level": 2 } },
    { "op": "add", "nodeId": "pick", "target": { "kind": "node", "nodeId": "pick", "key": "draws", "workflowId": "5a2e…" },
      "item": { "id": "6f1c…:pick:1", "text": "a storm", "entryKey": "c0ffee…:1a2b3c4d5e6f7a8b" } }
  ]
}
```

- `replies` counts the assistant messages saved (partial rows included); `completed` means every reply run ended
  without an error or a stop.
- `runs` lists every run: the reply section's, then the after section's (`part: 'post'`, announced `running`, settled
  through `withRunSettled`, which appends their writes after everything earlier). `error` is cut to 500 characters.
  The view derives `postStatus`/`postExecutionId`/`postError` from the post runs; nothing stores them.
- **Scalars store the value after the write**: an `increment` becomes a `set` computed from the turn-start value plus
  earlier writes of the run, clamped. Collections store `add`, `update` and `remove`; `delete` resets a key. An
  `update` (`{ itemId, text?, fields? }`) is an item's new text and/or field values; only the LLM node's write tools
  store it, never for a thread.
- `target.kind: "node"` is a node's own implicit key (Draw's `draws`, the Trigger's `fires`), with the run's
  `workflowId`. Draw stores only the first 80 characters of an entry's text; the `entryKey` fingerprint is what counts.
- Stored sessions aren't parsed on read: entries are read through `readTurnEntries` (skips what's malformed) and
  appended through `withTurnEntry` (keeps unknown keys).

## The fold

`foldStoryState` (shared) turns the entries and the messages into the current state. It never throws, never changes
its input and never rewrites stored data. Its `including` option counts the given turn as present whatever its
replies (how later runs of a turn see the earlier ones); its `workflowId` option scopes node state.

- **Presence.** A turn counts iff `replies > 0` and an active assistant message with its `executionId` exists (not
  `streaming`; `partial` counts), or `replies === 0` and `completed`. User messages never count. Deleting every reply
  of a turn undoes it; deleting only its user message changes nothing.
- **Numbering.** Counting turns are 1..n in stored order; the turn being run is n + 1 (`{{trigger.turn}}`). Deleting a
  middle reply renumbers later turns; deleting the last frees its number.
- **Values.** A scalar is the post-value of the most recent counting write (`delete` makes it the default and still
  counts as a write). A collection is the items added minus those removed by counting turns, newest first (later write
  first within a turn), cut to `cap` at read time (`meta.droppedByCap`; items are never deleted from storage, so a
  higher cap brings them back). An item reads as its counting `update`s left it (text and field values; a stored
  update can never change its `id` or `messages`), keeping its place and turn; an update of an item that is gone does nothing. A thread ignores updates (its text is always
  its exchange's), with the "another key type" warning.
- **Validation against the current definition.** A stored value that doesn't fit reads as the default with a warning
  (`State "scene.tension": Stored value 11 is above max 10; using default 3.`, added to the run's warnings). Writes
  for a missing key, or with an operation the key's type no longer has, are ignored with a warning; writes for a
  deleted definition are ignored silently. Restoring the definition brings the values back.
- **Meta:** `written`, `turnsSinceWrite` (a key never written counts as written before turn 1), `writtenAtTurn`, and
  for collections `count` and `droppedByCap`.
- **History** per key: one point per counting turn that wrote it, the newest 100. Values only for number, boolean and
  enum keys; a collection's point is its item count; text and object points are `{ turn }`.
- Definitions are folded oldest first (`oldestFirst`), which decides which duplicate name wins.

## What a run sees and writes

The server folds the session at turn start and gives the engine a **snapshot**: definitions, every key's value and
meta, `itemTurns` (the turn that added each collection item), the nodes' implicit values, the turn number and the
present turn ids. `ctx.state` exposes it read-only (`values`, `definition(id)`, `read(definitionId, key)`, `own(key)`).

- **Reads never see the same run's writes**: a value written this turn is visible to templates and State Read from
  the next turn; in the same turn only through State Write's output, or through `ctx.pendingState()` for the writing
  node itself (read-your-own-writes).
- `ctx.writeState(request)` buffers. A node's requests count only when it **completes**. At the end of the run the
  buffer resolves them in a fixed order (wave, node id, call order; never finish order): increments are clamped into
  sets, `add` items get the id `<executionId>:<nodeId>:<n>`, requests for a missing definition or key are dropped with
  a warning. The result (and `ExecutionFailure`) carries the `writes`; a failed or stopped turn keeps those of the
  nodes that completed.

## State Read and State Write

Both pick `definitionId` and `key` and resolve their ports from the definition. A missing definition or key, or a
State Write operation the key's type doesn't have, can't resolve ports: a validation issue naming the node (`State
definition <id> not found. Pick another state definition in the node's settings.`), never a run-time error.

**State Read** `read` modes: `value` (typed: `number`, `boolean`, `text` for enum and text, `object`, or `array`, newest
first), `meta` (`written`, `turnsSinceWrite`, `writtenAtTurn` optional, `count` for collections), and `linked`
(collections only: the intact linked items in chat order, like the `linked` helper).

**State Write** is a sink: it runs every turn once its inputs are ready, unless its optional `when` input
(`requiredIfConnected`, value ignored) is fed by a branch not taken.

| Key type | `op` | Input `value` | Output `value` |
| --- | --- | --- | --- |
| number | `set` | `number`, required, clamped | the stored value |
| number | `increment` | `number` when connected (else the fixed value, else 1) | turn-start value plus the amount, clamped |
| boolean, enum, text, object | `set` | typed; an enum value must be an option | the stored value |
| any scalar | `delete` | none | the default |
| collection | `add` | text becomes `{ text }`; an object needs a string `text`; only declared fields kept, each checked | the stored item with its id |
| collection | `add` + `messages` | optional `messages` input links the item to chat messages | the item with its link |
| collection | `remove` | an item id the key held at turn start (unknown: nothing stored) | the removed item, optional |
| collection | `delete` | none | `[]` |
| thread | `add` | the LLM's `exchange` (`messages`), plus optional `input` | the stored item |

- **Fixed value.** The optional config `value` (a typed JSON literal) stands in for the unconnected `value` input; a
  connected input always wins, and the literal is checked like an input value. With a fixed value the input becomes
  optional, so the ports re-resolve when it changes. Threads have none.
- Errors name the key (`scene.mood must be one of: calm, uneasy, tense, release; got "sad"`). Each write logs one
  line (`scene.tension: 3 -> 6`).
- The panels are custom (see [web.md](web.md#state-panels)).

## Message links

Any collection item may link to chat messages; summaries are one use. There is no summary store.

- **The link** is the built-in `messages: { ids, fingerprint }` of an item: the linked message ids in chat order and
  `fingerprintMessages` of them (a stable hash of each message's id, role, name and content; it must never change).
  It is set only by State Write's `messages` input, which takes a link (`{ ids, fingerprint? }`, Next Chunk's `link`),
  one message, or a non-empty list of messages (Chat Input's `replies`). Ids only, never positions.
- **Status, computed on read** (`linkStatus`): `intact` (all messages there, fingerprint matches), `changed` (all there,
  one edited), `partial` (some deleted), `gone` (all deleted). A run's snapshot gives linked items a read-only
  `link: { status, ids, first }`. Readers use intact items only.
- **Replaced:** a broken item whose surviving messages are all linked by intact items of the same key (a `gone` item is
  never replaced). A re-summarized chunk therefore needs no `remove`.
- **Chat order** (`chatOrder`): collections list newest first, the wrong order for linked items, so `linkedInChatOrder`
  orders intact linked items by their first linked message (ties newest first; an item linking exactly the same
  messages as an earlier one is dropped and marked `repeated` in the view).
- **The settle check** (`commitLinks`, inside the settle update, against the history as it is then): a linked id no
  longer in the chat drops the write ("a message it links to is not in the chat any more"); a fingerprint that no
  longer matches drops it ("was edited while it was being written"); a missing fingerprint is computed. Dropped writes
  go to the entry's `linkWarnings` (at most 5, 300 characters each, shown on the turn chip) and the run's log.
- **Next Chunk** (no inputs; `definitionId`, `key`, `chunkSize` from 2, default 20, `rawWindow` default 16) plans with
  the pure `planNextChunk` over the messages outside the raw window: first the first broken, not replaced item (in
  chat order), re-planned over its surviving messages no intact item covers (`replaces` = its id); else the first run
  of `chunkSize` consecutive uncovered messages; else nothing (reason in the log, every output absent). Outputs, all
  optional: `messages`, `text`, `link`, `replaces`.
- **Unlinked Messages** outputs its input minus the messages intact items of the key link (`messages`, `text`).
  Whether an item is intact is judged against the whole chat.
- **The wiring** for rolling summaries: the narrator takes Memory (all) → Unlinked Messages → its `recent` input, and
  its preset lists `{{#each (linked state.memory.summaries)}}`; a summarizer workflow listed below it runs Next Chunk →
  LLM → State Write `add` with Next Chunk's `link` on `messages`. Keep the key uncapped. Accepted caveat: a broken
  summary in the middle puts its raw messages after later summaries until the next turn redoes it.

## Thread keys

Items of a `thread` key are LLM exchanges: `{ id, text, exchange, input?, turnId, runId }`. `exchange` is the LLM's
messages (reasoning and provider data stripped unless `keepReasoning`), `text` its final answer, `turnId`/`runId`
stamped by the engine. They are stored inline in the session file for now.

**The Thread node** reads them back, oldest first (`lastN` keeps the newest N). Without a `history` input it gives the
exchanges alone, each after its question when `withInputs` is on. With a history it weaves them into the chat
(`weaveThread`, by ids, never by text): an exchange's tool calls and results go right before the reply that carries its
answer (a passthrough Chat Output reply of the same run and LLM node, matched by `sourceNodeId`), and its own final
answer is dropped since the chat has it. An exchange whose answer isn't in the chat goes whole after its turn's last
message; a turn with no message in the history puts its exchanges after the nearest earlier turn that has one;
exchanges older than a cut history are left out. A plain item (no `exchange`) reads as one assistant message.

## The state view

`GET /api/sessions/:id/state` is the computed state, the same fold the next turn starts from:

- `turn`: the next turn's number.
- `definitions`: every definition, oldest first, with `values`, `meta`, `history` and `warnings` per key.
- `nodes`: implicit node state (`nodeId`, `workflowId`, `label` when the node still exists, `values`, `meta`,
  `history`). A node collection has no cap, so `values` holds its newest 50 items and `omitted` counts the rest.
- `turns`: every stored entry with `turnNumber` (null when its replies are gone), `runs` (with the workflows' current
  names), the derived post fields, `linkWarnings`, and its `writes` as `{ write, truncated?, definitionName?,
  nodeLabel? }`. A text over 200 characters, or an object whose JSON is, is cut and marked `truncated`; linked items are
  sent whole.
- Linked items of definition keys carry `link: { status, replaced, repeated, count, missing, firstIndex, lastIndex,
  firstMessageId, lastMessageId, messageIds }` (1-based positions among history messages; none for a `gone` item).
- Thread items appear as `{ id, text, steps, toolCalls, turnId, runId }`, never with their exchange.
- **Restart rule:** a stored `running` run that the server doesn't hold reads as an error, `The run was interrupted by
  a server restart.` The view decides which runs are live when it reads the session and reads again, up to three
  times, before believing it (a run commits its result before the server lets go of it).

`GET /api/sessions` leaves `state` out; the preset preview renders the chat's next-turn state when given a session.

## Edits, deletes and alternatives

Editing a message changes nothing in the state (entries are never recomputed from content). Deleting a message changes
which turns count: the last reply rewinds, a middle reply keeps later values and renumbers. Each alternative of the
last turn is a turn of its own, and only the shown one has active replies, so only its writes apply; a regenerate folds
as if the last turn weren't there. A regenerate that leaves no reply is stored not completed, so it never counts.
