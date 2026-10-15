# State design, proposal 1: per-chat, per-character and shared state

A proposal from a design discussion (October 2026), not a spec. Nothing is decided yet. It answers
the first need in [CREATIVITY.md](CREATIVITY.md) ("no per-session state"), and the backlog items in
PLAN.md that are really the same thing: per-chat variables, summarization stored in chat metadata,
and a memory node with a summarize strategy.

## Goal

Let users define, in their workflows, nodes that **store things derived from the ongoing story** and
**reuse them on later turns**:

- counters and timers (turns since the last injection, cooldowns, a hazard timer),
- ratings over time (tension per turn, a relationship meter),
- generated content (summaries, invented canon such as names and places, memories),
- curated content (a world bible, seed tables) that a chat reads and sometimes adds to.

The same mechanism must cover state that lives in one chat, in one character within a chat, in one
character across all chats ("she remembers you"), and in a group of chats (a campaign played over
several, possibly parallel, sessions).

Nothing is automatic, in line with AGENTS.md: the user wires the nodes and presets that read and write
state. The engine only offers the building blocks.

## Non-goals for now

- No automatic summarization, memory or lorebook behaviour.
- No external database or vector store: storage stays files under `data/`, like everything else.
- No swipes. The design is shaped so swipes fit later, but they are not part of this work.

## Core ideas

1. **Changes are recorded as deltas per turn, not as a mutable blob.** Deleting or regenerating a reply
   can then undo exactly what it wrote. SillyTavern's chat variables are a mutable store, so they keep
   what a deleted reply wrote, and summaries, cooldowns and "already injected" lists drift away from
   the visible chat.
2. **Where a value lives and whether a change still counts are separate questions.** A **state
   definition** decides where (its dimensions). A **rewind policy** decides whether a change can be
   undone by the chat that made it.
3. **Nodes only ever name a definition and a key.** Which copy that resolves to, and what rewinding
   means, comes from the definition, so moving a key from chat scope to campaign scope doesn't change
   any workflow.
4. **The store is cheap; expensive work is ordinary nodes.** An LLM call that produces a summary is an
   upstream node of the write. Embeddings are computed when an item is written. Reads are local.

## Concepts

### State definition

A small user-defined record, stored as YAML like presets and providers
(`data/state/definitions/<slug>.yaml`, through a `YamlRepository` subclass, identity is the `id` in the
file).

```yaml
name: bond                            # template handle: {{state.bond.trust}}
partitionBy: [character, persona]     # one copy per character and persona, across every chat
rewind: seal-on-next-turn
keys:
  trust:    { type: number, default: 0, min: -10, max: 10 }
  memories: { type: collection, item: { text: string }, cap: 50 }
```

- `name` is the handle used in templates and shown in the editor. It must be a valid template path
  segment and unique among definitions.
- `keys` are declared, with a type and optional default, bounds, schema, cap and indexes. Declaring
  them gives typed ports, editor hints and `{{state.*}}` validation from data, never from hand-written
  lists (AGENTS.md rule for the macro registry).
- Definitions live outside workflows, because a campaign or a character's memory must outlast any
  single workflow or session. Workflows reference them by id, like presets.

### Dimensions and copies

`partitionBy` lists the dimensions that split a definition into separate **copies**. Each copy has its
own log and its own current value.

- **Derived dimensions** are filled from the turn: `session`, `character` (the session's character, or
  the one connected to the node's `character` input), `persona`, `workflow`. An empty list means one
  global copy.
- **Bound dimensions** are chosen by the user. A session **joins** a named instance of a definition
  ("Campaign: Northern Wastes"), the same way it picks a character or a persona. A campaign is
  therefore not a new entity type: the instance of a shared definition *is* the campaign, and any
  number of sessions, including parallel ones, can join it.

A copy is identified by the definition id plus the canonical values of its dimensions, for example
`bond / character=<id>,persona=<id>`.

### The delta log and provenance

Every copy has an append-only log. Each entry is either a **delta** or a **retraction**.

```yaml
# delta
id: d-0193
at: 2026-10-15T10:02:11Z
seq: 193                     # per-copy commit order
origin: { kind: turn, sessionId: s-12, executionId: e-88, turn: 41 }   # or { kind: manual }
derivedFrom: [m-301, m-302]  # message ids the value was built from (optional)
ops:
  - { key: trust, op: increment, by: 1 }
  - { key: memories, op: add, item: { id: i-77, text: "She lent you her father's compass." } }
# retraction
id: r-0007
retracts: d-0193
reason: turn-deleted          # turn-deleted | regenerated | manual | source-changed
```

- The **current value** of a copy is the replay of its deltas in `seq` order, skipping retracted ones,
  starting from the declared defaults.
- Nothing is ever deleted from the log. The log is the audit trail the inspector shows, and "undo" is a
  retraction like any other.
- `origin.turn` is the session's turn index. It gives the per-message view of a key (its value turn by
  turn) without a separate "message" dimension.

### Rewind policy

Set per definition, overridable per key. It decides when a delta is retracted automatically because the
turn that wrote it went away (its replies deleted today; regenerated or swiped away later).

| Policy | Behaviour | Natural default for |
| --- | --- | --- |
| `follow-turn` | Retracted whenever its turn goes away, however old | Definitions split by `session` |
| `seal-on-next-turn` | Retractable while its reply is the latest one; sealed once the user sends the next message in that session | Shared definitions (character, campaign) |
| `seal-after: N` | Sealed N turns later | Users who often edit recent history |
| `permanent` | Never retracted automatically | Imported or hand-curated content |

Sealing is what keeps shared state safe: regenerating a reply replaces what it wrote to the campaign,
but deleting message 3 of 50 in one chat doesn't silently rewrite a campaign four other chats have built
on since. Sealed deltas can still be retracted by hand from the inspector.

Sealing is **computed, not stored**: whether a delta is sealed follows from its policy and the later
turns of its session.

Related settings:

- **Deleting a session:** its unsealed contributions to shared copies are retracted, sealed ones stay.
  A per-definition option could retract everything.
- **Forking a session at a message (future):** its `follow-turn` copies come along by replaying the log
  up to that turn; shared contributions are not duplicated.

### Staleness: `derivedFrom`

A delta is tied to the turn that wrote it, but its content may come from earlier messages (a summary
covering messages 1 to 40, a fact extracted from message 12). When one of those messages is edited or
deleted, the delta is out of date while its turn still exists.

A delta can therefore record `derivedFrom` (message ids). The definition decides what a change to one
of them does:

- `keep`: nothing.
- `mark-stale` (default): the delta stays active but is flagged in the inspector, and readable as
  stale, so a Gate can treat it as a reason to regenerate.
- `retract`: append a retraction with reason `source-changed`.

## Types and operations

| Type | Port type | Write operations | Notes |
| --- | --- | --- | --- |
| `number` | number | `set`, `increment` | Optional `min`/`max` clamp |
| `boolean` | boolean | `set` | |
| `enum` | text | `set` | Declared values only |
| `text` | text | `set`, `append` | `append` has a separator and a length cap |
| `object` | object | `set`, `merge` | Optional JSON schema; `merge` is a shallow patch |
| `collection` | array | `add`, `update(itemId)`, `remove(itemId)` | Items always have `id` and `text`, plus declared fields; `cap` with an eviction rule (oldest first, or lowest `priority` field) |

Every key also accepts `delete` (back to its default).

- Port compatibility stays in `canConnect`. It already refuses implicit parsing (text to number is
  rejected), so an LLM's text output reaches a number or object key through an explicit **Parse JSON**
  node, validated against the key's type. A model that answers "about 7/10" fails the write visibly
  instead of storing garbage.
- Collection items always carry `text`, which is what indexes and templates use.

## Reading

| Mode | Applies to | Returns |
| --- | --- | --- |
| `value` | all | The current value |
| `history(n)` | all | The last N values with their turn index |
| `items` | collection | The last N items, filtered by tags or declared fields |
| `search` | collection | Top-k or a similarity band for a query from an input; `lexical` or `semantic` |
| `meta` | all | Turns since the key was last written, stale flag, item count |

All reads are local. `value` reads are also available in templates as `{{state.<definition>.<key>}}`
(including `{{#each}}` over collections). `search` needs a query, so it stays in nodes.

### Indexes for search

A collection key can declare indexes:

```yaml
canon:
  type: collection
  item: { text: string, tags: string[], kind: enum[place, person, object, custom] }
  index: [lexical, { semantic: local-minilm }]
```

- **Lexical (BM25):** built in, no dependencies, in process. Often enough for names and places.
- **Semantic:** each item is embedded **when it is written**. Vectors are cached by content hash and
  model, so replay, rewind and retraction never re-embed. The query is embedded by a **small local
  model** in the server process (a MiniLM-class ONNX model through transformers.js, tens of MB), the
  same model that indexed the items. A remote embedding provider can index, but then reads need a
  remote call too, unless a matching local model exists.
- Search is a brute-force cosine scan over the copy's active items: fine up to tens of thousands of
  items. Indexes are derived data, rebuildable from the log at any time.
- The similarity band and the "novelty against what was already injected" filter from CREATIVITY.md
  are options of this read mode.

## Turn semantics

- **Snapshot reads.** `prepareWorkflow` resolves which copies the workflow touches for this turn and
  snapshots them, like it snapshots presets and providers today. Every read in the turn sees that
  snapshot, so results never depend on node scheduling within a wave.
- **Buffered writes.** Writes are collected by the executor and committed when the turn settles. To use
  a freshly written value in the same turn, wire the write node's pass-through output downstream.
- **One writer per key per turn.** Validation rejects two write nodes on the same definition and key
  unless they sit on exclusive Condition branches; this keeps a turn's delta unambiguous. (Open: allow
  commutative operations like `increment`/`add` from several nodes.)
- **Write nodes are sinks.** Today only nodes that some Chat Output depends on run. That rule becomes
  "nodes that some **sink** depends on", with a sink flag on the node definition (Chat Output and State
  Write have it). Conditional writes come for free: a write behind an untaken Condition branch is
  skipped.
- **Failed or stopped turns write nothing.** Their buffered deltas are dropped. (Open: keep deltas from
  nodes that completed.)
- **Timing per write node:**
  - `in-turn` (default): committed with the replies.
  - `after-reply`: the replies settle and stream to the user first; the write's upstream branch keeps
    running, and its delta commits when that branch finishes. The next turn's read of the **same copy**
    waits for the pending write; other copies don't wait. This is what keeps expensive writes (an LLM
    summary) off the critical path.

### Shared copies and parallel sessions

- Sessions run concurrently, so a shared copy can change between a turn's snapshot and its commit.
- Commits go through the copy's lock. `increment`, `add` and `remove` merge cleanly in any order. `set`,
  `merge` and `update` are last-writer-wins by commit order.
- If a key the turn read was changed by another session before commit, the execution log records a
  warning. Compare-and-set is left for later.
- **Lock order:** session lock first, then copy locks in a canonical order (sorted copy ids). Locks are
  not re-entrant (AGENTS.md), so this order must never be reversed.

## Nodes

| Node | Config | Ports | Cost |
| --- | --- | --- | --- |
| **State Read** | definition, key, mode, mode options | Outputs typed from the key (through `resolvePorts`); `query` input for `search` | Local |
| **State Write** | definition, key, operation, timing, `derivedFrom` source (optional) | `value` input typed from the key; pass-through output | Free; the value's producer is upstream |
| **Gate** | every N turns, N turns since key X was written, cooldown, probability, stale flag | Boolean output, or pass-through | Free, reads log metadata |
| **Parse JSON** | optional target definition and key (for validation) | text in, object/array out | Free |
| **Memory** (existing) | new option `since` (a message id input); later "use a message's summary when present" | unchanged | Free |

The Gate node is also the trigger primitive the creativity pipeline needs (cooldowns, hazard timer),
so it is built once for both.

## Worked examples

### Rolling chat summary

```yaml
name: memory
partitionBy: [session]
rewind: follow-turn
onSourceChange: mark-stale
keys:
  summaries:
    type: collection
    item: { text: string, from: string, to: string }   # message ids covered
```

```
Gate (every 10 turns, or when unsummarized history exceeds N tokens, or when the last summary is stale)
  → State Read (memory.summaries, items, last 1) → its `to`
  → Memory (since: that id)
  → LLM (summarize)
  → State Write (memory.summaries, add, timing: after-reply, derivedFrom: the Memory node's messages)
```

The preset reads `{{#each state.memory.summaries}}{{this.text}}{{/each}}`, then a history slot limited
to messages after the last summary. Summaries of summaries are the same pattern with a `level` field.

### Per-message summaries

A collection keyed by message id (`item: { text, messageId }`). Each item rewinds with the turn that
wrote it and goes stale when its message is edited. The Memory node's "use a message's summary when
present" option then compresses long chats without another pipeline.

### Character memory across chats

`bond` above: partitioned by character and persona, `seal-on-next-turn`. An LLM extracts at most one
memory per turn behind a Gate; the preset reads the last few memories, or searches them with the
current user message as the query.

### Campaign

```yaml
name: campaign
partitionBy: [campaign]          # bound: sessions join an instance
rewind: seal-on-next-turn
keys:
  canon:    { type: collection, item: { text: string, kind: string }, index: [lexical] }
  timeline: { type: collection, item: { text: string } }
```

Several sessions join "Northern Wastes". Each extracts invented names and places into `canon`; every
session's preset searches `canon` for the current scene.

### Creativity hooks

- `scene` (partitioned by session, `follow-turn`): `tension` (number, read with `history(5)`),
  `lastInjectedTurn` (number), `injected` (collection, for novelty against what was already injected).
- A Gate reads `meta` and `history` to build the trigger score from CREATIVITY.md.

## Storage

- **Definitions:** `data/state/definitions/<slug>.yaml`, a `YamlRepository` subclass (shared scan,
  stamping, locks and file naming), with live reload through the existing directory watcher and a
  `stateDefinitions.changed` event.
- **Bound instances:** a small record per instance (id, definition id, name), listed for the session
  picker. Stored with the definitions or in their own folder.
- **Copy logs:** one JSON file per copy under `data/state/logs/<definitionId>/<copyKey>.json`, written
  atomically (temp file and rename, as every repository does). Rewriting the whole file per commit is
  fine at alpha sizes; JSONL appends with compaction are a later optimisation.
- **Sessions** gain an optional `turns` list (additive, default `[]`): `{ executionId, index, at,
  messageIds, wrote: [copyRef] }`. It records turns that produced no message (empty sends), gives
  `turn.index`, and tells the server which copies to retract from when a turn goes away.
- **Bindings:** sessions gain an optional `stateInstances: { [definitionId]: instanceId }` for bound
  dimensions.

### Committing a turn

The session file and the copy logs are separate files, so a commit can't be one atomic write. Proposal:

1. Append the turn's deltas to each copy log, marked `pending` with the `executionId`.
2. Settle the session (messages and the `turns` entry) under the session lock, as today.
3. Mark the deltas committed.

Pending deltas are ignored by reads. At startup, a recovery pass commits pending deltas whose turn
exists in its session and retracts the others. This is the part of the proposal with the most risk and
deserves the most review.

## API and UI

Contract first, in `packages/shared/src/api/`:

- `GET/PUT/DELETE /api/state/definitions[/:id]`.
- `GET/POST /api/state/definitions/:id/instances` for bound dimensions.
- `GET /api/state/copies?definitionId=…&session=…&character=…` returns current values and the log.
- `POST /api/state/copies/:copyKey/retract` and `POST …/manual` for inspector undo and manual edits
  (recorded as `origin: manual`).
- Execution log: per node, the reads (copy, key, mode, `seq` seen) and the buffered writes.

UI:

- A **definition editor**, a narrow editor like providers.
- A **state inspector** next to the chat: the copies this session touches, their values, the log
  with provenance, stale flags, retract and edit.
- A per-message annotation: "this turn wrote …".
- Session settings: which instances the session joins.

## Code impact (from a quick read, not a full review)

- `packages/shared`: definition and log schemas, the API contract, `state.*` in the macro registry
  driven by definitions, a `turns` field on sessions.
- `packages/engine`: a sink flag replacing the Chat Output special case in "what runs"; `ExecutionContext`
  gains `state.read(...)` and `state.write(...)`; `NodeResources` gains state copies, snapshotted by
  `prepareWorkflow`; State Read, State Write, Gate and Parse JSON nodes; the executor returns the
  buffered deltas with the result.
- `apps/server`: definition repository, copy log storage, commit and recovery in `services/chat.ts`
  around `settleTurn`, retraction in `services/messages.ts` on delete and edit, the routes,
  `NotifyingRepository` wrapping for change events.
- `apps/web`: definition editor, inspector, session bindings, `{{state.*}}` hints coming from the
  catalog.

## Phases

1. **Core, session scope only.** Definitions (YAML), copy logs, `session` dimension, `follow-turn`,
   `value` and `history` reads, `set`/`increment`/`append`/`add`, in-turn writes, sinks, snapshot
   reads, `{{state.*}}`, execution log entries, rewind on message delete. Read-only inspector.
2. **Gate and Parse JSON**, `meta` reads, `after-reply` timing, `derivedFrom` and staleness, the
   summary example end to end.
3. **Shared copies:** `character`/`persona` dimensions, bound instances, sealing, parallel-session
   rules, the commit and recovery protocol.
4. **Inspector editing:** manual edits, retraction from the UI.
5. **Search:** lexical index, then local semantic index.

Alongside phase 1: the divergence harness from CREATIVITY.md, so state-driven creativity can be
measured.

## Open questions

1. Declared keys only, or also free-form keys for quick experiments?
2. Bound dimensions: one generic mechanism (join any number of named instances), or a first-class
   "campaign" slot on sessions?
3. Is `seal-on-next-turn` the right default for shared state, or should committing to shared state be
   explicit (a "commit to campaign" action on a message)?
4. Failed or stopped turns: drop all deltas, or keep those from completed nodes?
5. Several writers on one key in one turn: reject, or allow commutative operations?
6. Are definitions the right granularity, or should small per-chat variables be declarable inline in a
   workflow without a separate record?
7. Does `after-reply` belong in the executor, or should post-turn work be a separate workflow run on an
   event (PLAN.md's "event trigger nodes")?
