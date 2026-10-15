# State design, review 1: critique of proposal 1

An independent review of [STATE-DESIGN-PROPOSAL-1.md](STATE-DESIGN-PROPOSAL-1.md) (October 2026),
checked against the code at commit `b1be064`. Section names like "§Turn semantics" refer to the
proposal. Tags:

- **[code]**: checked in the code at the cited `path:line`.
- **[reasoning]**: my inference or judgement. Not tested, and no prototype was built.

## 1. Summary verdict

The **front half** of the proposal is sound and fits the codebase. That covers declared, typed keys
with data-driven hints, snapshot reads, buffered writes, write nodes as sinks, an explicit Parse JSON
step, provenance in the execution log and "nothing automatic". Each of these extends a mechanism that
already exists: resource snapshots in `prepareWorkflow`, the `canConnect` table, the macro registry and
the per-node execution log.

The **back half** is the storage and rewind model: per-copy delta logs in separate files, retraction
records, four rewind policies, computed sealing, `derivedFrom` staleness, a pending/committed protocol
and `after-reply` timing. It is designed for the hardest case, which is shared state rewritten
concurrently by several sessions. It then charges that cost to the common case, state for one chat,
which phase 1 is limited to anyway. Several of its parts are under-specified in ways that matter for
correctness.

The five most important problems:

| # | Problem | Section | Severity |
| --- | --- | --- | --- |
| P1 | The session record is already the commit point of a turn. Separate copy logs for **session-scoped** state add a two-file protocol, a recovery pass and retraction records that a single atomic session write would make unnecessary. | §Storage, §Committing a turn | High (complexity and risk with no benefit in phases 1–2) |
| P2 | Replaying after a retraction is only well-defined for independent accumulations. Clamped increments, cap eviction, `update`/`remove` of a retracted item and any `set` computed from a read do not survive a middle retraction meaningfully. Computed sealing also lets a definition edit rewrite history. | §The delta log, §Rewind policy, §Types | High (silent wrong values) |
| P3 | `after-reply` as specified can deadlock. The next turn snapshots state inside the session lock (`apps/server/src/services/chat.ts:76-78`) while it waits for a pending write, and that write's commit needs the session lock. It also needs an executor that returns twice. | §Turn semantics | High (correctness) |
| P4 | Failure semantics diverge from the visible chat. A failed turn keeps its completed replies (`chat.ts:133`, `settleTurn`) but would drop all its deltas. A write branch that fails in-turn also aborts the reply in the same wave (`packages/engine/src/executor.ts:262-263`). | §Turn semantics | Medium–High |
| P5 | The concept count (about 25 new concepts, 4–5 node types, 2 record types, 6+ endpoints, an inspector and an in-process ONNX runtime) is out of proportion for a single-user, file-backed alpha. Phase 1 alone touches all five packages. | Whole document | Medium (maintainability) |

My recommendation (§6) is to keep the proposal's vocabulary and nodes but to **store session-scoped
state inside the session record, keyed by `executionId`**. Rewind is then computed from which messages
still exist, and nothing is retracted. Shared state gets an **outbox** that publishes only sealed writes
to shared copies, so shared logs never need automatic retractions or a recovery pass. `after-reply`
becomes a separate post-turn run on the existing turn queue.

## 2. What the proposal relies on, checked against the code

| Claim or dependency | Status | Evidence |
| --- | --- | --- |
| Resources are snapshotted by `prepareWorkflow` | True, and **lazily**: `cachedGet` memoizes a `structuredClone` per id on first `get` | [code] `packages/engine/src/prepare.ts:23-48` |
| `prepareWorkflow` can "resolve which copies the workflow touches for this turn" | Not in general. A copy partitioned by `character` depends on a **runtime** value (a Character node's output, possibly routed through a Condition), and preset templates can read `{{state.*}}` with no State Read node | [code] `prepare.ts` resolves ports statically. Runtime part is [reasoning] |
| `prepareWorkflow` runs once per turn | It also runs on every workflow validation (`validateWorkflow`, `prepare.ts:214-216`). Eager snapshotting there would read logs on every save | [code] |
| Only nodes that a Chat Output depends on run | True: `reachable` is seeded from `chat-output` nodes only. Unreachable nodes are logged with `'unreachable from chat output'` | [code] `prepare.ts:203-210`, `executor.ts:83-89` |
| Chat Output is a special case in the executor | True: replies are collected by `node.type === 'chat-output'` | [code] `executor.ts:206-215` |
| `canConnect` rejects text → number | True | [code] `packages/shared/src/ports.ts:30-40` |
| The session lock is not held across the engine run | True. Turns are serialized per session by `TurnRegistry` (its own `KeyedLock`); the repository lock is held only for short writes | [code] `apps/server/src/services/turns.ts:21-35`, `chat.ts:43` |
| …but workflow preparation happens **inside** the session lock | True: `prepareWorkflow` is called inside `sessions.silent.update(...)` | [code] `chat.ts:76-78` |
| Messages already identify their turn | True: `executionId` is set on the user message and on every reply at settle | [code] `packages/shared/src/models.ts:43`, `chat.ts:188, 213-214` |
| A failed turn keeps completed replies | True | [code] `chat.ts:133`, `settleTurn` (`chat.ts:175-218`) |
| A node failure aborts its siblings in the same wave | True | [code] `executor.ts:262-263` |
| Message delete and edit only change content | True today, with no hooks | [code] `apps/server/src/services/messages.ts:5-29` |
| Session deletion goes through a service | No: the route calls `sessions.delete` directly, outside the turn queue | [code] `apps/server/src/routes/sessions.ts:49-50` |
| Regenerate or swipe exist | No: there is no regenerate or swipe endpoint in the session contract, so the `regenerated` retraction reason has no trigger yet | [code] `packages/shared/src/api/sessions.ts:55-59` |
| Repository ids are free-form | No: `JsonRepository` only accepts `[a-zA-Z0-9_-]+`, so a copy key like `character=<id>,persona=<id>` can't be a file name or a route param as is | [code] `apps/server/src/storage/repository.ts:39` |
| The macro registry can be "driven by definitions" | Today it is a static `readonly` array consulted by preset validation and the engine. Making `state.*` data-driven means passing a catalog through preset validation, preview and node-ui hints | [code] `packages/shared/src/macros.ts:28`, usages in `shared/src/preset.ts` and `engine/src/template.ts` |
| The Memory node can supply `derivedFrom` message ids | Only in `messages` format. The `text` format drops ids | [code] `packages/engine/src/nodes/memory/index.ts:22-25` |
| Session files are cheap to rewrite | They are rewritten every 250 ms while a reply streams (`turn-stream.ts:11, 187, 215`), and `GET /api/sessions` parses every session file in full (`routes/sessions.ts:9-10`). This matters if state goes into the session file (§5) | [code] |

## 3. Weaknesses and risks

### 3.1 The two-file commit and recovery protocol (§Committing a turn)

The proposal calls this the riskiest part, and it is. It is also unnecessary for phases 1–2.

**As specified:**

1. Each copy is written twice per turn under its copy lock (append pending, then mark committed), and
   the session is written once under the session lock. That is 2N+1 whole-file rewrites per turn
   ([reasoning]).
2. **Step 2 can fail in-process**, not only by a crash. A session deleted mid-turn makes the settle
   throw `notFound` ([code] `chat.ts:142`, and the delete route bypasses the turn queue). The pending
   deltas then stay until the next restart, because recovery runs only at startup.
3. **`seq` assignment is ambiguous.** If `seq` is taken at step 1, two sessions can commit in the
   opposite order to their `seq`, so "last-writer-wins by commit order" (§Shared copies) and "replay in
   `seq` order" disagree. If it is taken at step 3, step 3 has to rewrite entries rather than flip a
   flag.
4. **Recovery "retracts the others"**, which writes retraction records for deltas that were never
   visible. That pollutes the audit trail the inspector is meant to show. They should just be dropped,
   which conflicts with "nothing is ever deleted from the log".
5. **Startup recovery scans every copy log** before the server can serve requests. That cost grows
   with all state ever written, and the scan has to cope with invalid or hand-edited files (AGENTS.md:
   never modify invalid files).
6. **The recovery predicate "turn exists in its session"** needs a session read per pending delta, and
   it can't tell "crashed before settle" from "settled, then the user deleted the reply". Both give the
   same answer, which is probably fine, but it should be stated.

**The codebase already has a simpler pattern.** `executeTurn` saves the execution log **before**
settling the session ([code] `chat.ts:135` then `chat.ts:138`). The session write is the commit point;
an execution log with no session reference is a harmless orphan. The same rule removes step 3 and the
whole recovery pass:

> A delta tagged with `executionId` is live if and only if its turn is settled in the session.

Readers check this directly. Orphans are ignored and can be compacted lazily. For session-scoped state
there's an even simpler option: put the deltas **in** the session write, which makes it one atomic file
(§6).

For shared copies, the predicate would mean reading other sessions' files on every read. That is the
real reason the proposal needs a protocol, and the outbox in §6 removes that need too.

### 3.2 Retraction vs sealing (§Rewind policy)

- **Retraction only gives an exact undo for the tail.** Removing the latest turn is exact under any
  model, including plain snapshots. For a turn in the middle, later turns' writes were computed from
  values that included it. Replaying them without it does not reproduce what would have happened; only
  re-running those turns would. So the machinery buys exactness only where cheaper models are already
  exact, apart from independent accumulations (see 3.3) ([reasoning]).
- **Computed sealing makes policy edits retroactive.** Sealing "follows from its policy and the later
  turns of its session". Changing `seal-on-next-turn` to `follow-turn`, or `seal-after: 3` to
  `seal-after: 10`, unseals deltas that other sessions have built on for weeks. Deleting an old message
  then silently rewrites a campaign: exactly what sealing was meant to prevent. Either store the seal
  (or the policy in force at write time) or forbid policy changes once data exists.
- **Sealing depends on another session's file.** To show "sealed or not" for a delta in a campaign
  log, the inspector has to load every contributing session. A hand-deleted or corrupt session file
  makes the status undefined.
- **Swipes don't fit retractions.** The proposal says the design is "shaped so swipes fit later". With
  retraction records, switching from swipe 1 to swipe 2 and back would need an *un-retraction*, which
  the model doesn't have, or a growing pile of retract/re-add records. A model where each swipe
  alternative carries its own writes (§5, alternatives B/H) supports swipes by construction.
- **Is an empty send a "next turn"?** `seal-on-next-turn` says "sealed once the user sends the next
  message". Empty sends are valid turns ([code] `api/sessions.ts:19`, AGENTS.md "Empty sends") and are
  the natural way to "continue". The proposal must say whether they seal.

### 3.3 Replay of non-commutative operations

§Shared copies says `increment`, `add` and `remove` "merge cleanly in any order". That is true only
without the features the proposal itself adds ([reasoning]; each example is a two-line replay):

| Operation | Why order or retraction matters |
| --- | --- |
| `increment` with `min`/`max` | Clamping is applied per op. At `max: 10` from 10, `+1, -1` gives 9 and `-1, +1` gives 10. Retracting a middle increment that was clamped also changes the result of every later one |
| `add` with `cap` and eviction | Eviction is evaluated during replay. Retracting an add can **resurrect** an item evicted long ago, which no prompt has contained since. Changing `cap` also re-evaluates history |
| `update(itemId)` / `remove(itemId)` | If the `add` of that item is retracted, the later ops target nothing. There's no rule for this (no-op? warning? error?) |
| `text.append` with a length cap | Same as `cap`: truncation depends on everything appended before |
| `set` computed from a read | Most real writes are "read, transform, write" (a rolling summary, a relationship meter adjusted by an LLM). The stored op is an absolute value that hides its dependence on the old one, so replay after a middle retraction keeps a value built from a state that no longer exists |
| Definition edits (`min`/`max`, `cap`, key type) | Because the current value is always "replay from defaults", changing the definition changes past values in every chat |

The fix is either to restrict replay to genuinely commutative ops with no bounds (unbounded counters,
add-only sets of unique ids), or to **store post-values** for scalars, so that a write's effect doesn't
depend on what came before. Section 6 does the second.

### 3.4 `derivedFrom` staleness

- **Reverse lookup cost.** A message edit has to find every delta, in every copy including shared
  ones, whose `derivedFrom` includes that message. That means either a scan of all logs on every edit
  or a new reverse index to keep consistent. §Code impact doesn't mention it.
- **The cheaper option is to compute staleness, as with sealing.** Store `derivedFrom: [{ id, hash }]`
  and treat a delta as stale when an id is missing or its content hash differs. Nothing is written on
  edit, `messages.ts` doesn't change, and AGENTS.md's "edit/delete change stored content only" holds
  literally.
- **The triggering message is an implicit source** but isn't covered. Editing the user message that
  started a turn makes everything that turn wrote stale, yet nothing records that dependency.
- **`mark-stale` by default plus a Gate on "stale" means typo fixes cost LLM calls**: every small
  edit can trigger a summary rewrite. `keep` is the safer default.
- **The wiring is awkward.** The Memory node's text format has no ids ([code] `memory/index.ts:25`),
  and the rolling-summary example needs to pull the `to` field out of an item. No node can do that
  today: there is no property-access or transform node.

### 3.5 Shared copies, last-writer-wins and lock ordering

- **LWW is acceptable for a single user**, and the "read changed before commit" warning is a good,
  cheap signal. The problem is that under the proposal, other sessions see **unsealed** writes that
  may be retracted later, so a parallel session can build on a value that then disappears. With an
  outbox that publishes only sealed writes, readers see committed state only (read-committed
  isolation), which is easier to explain.
- **There are three lock layers, not two**: the per-session turn queue (`TurnRegistry`), the
  repository id lock and the new copy locks. The proposal orders only the last two. Session deletion
  ([code] `routes/sessions.ts:49-50`) and message deletion ([code] `services/messages.ts:21-29`) don't
  take the turn queue, so they race a running turn. Today the race is benign (settle throws
  `notFound`); with retractions it can leave half-applied state.
- **The stated lock order is violated by the protocol itself, but harmlessly.** Step 1 takes copy
  locks before step 2 takes the session lock. That is safe only because they aren't nested, and the
  document should say so ("never nested" rather than "session first").
- **Re-entrancy.** If a retraction runs inside the `sessions.update` mutator (the natural place, to
  see the messages), it must never call a helper that takes the session lock again ([code]
  `storage/lock.ts`: `KeyedLock` is not re-entrant).

### 3.6 `after-reply` timing

- **Deadlock as specified** ([reasoning] from [code] `chat.ts:76-78`). The next turn's snapshot is
  taken inside `sessions.silent.update`. If it "waits for the pending write", it waits while holding
  the session lock. The pending write's commit then needs that lock: to record `turns[].wrote` (step 2
  of the protocol), and to check that the turn still exists, because the user may have deleted the
  reply meanwhile. Neither can proceed.
- **The executor returns once.** `executeWorkflow` resolves only after every reachable node has
  finished ([code] `executor.ts:91-278`). `after-reply` needs a first result (the replies), continued
  execution, and a second result (the deltas and the final log). That is a structural change to the
  most sensitive file in the engine, and it affects `onEvent`, `execution:complete` and the
  `ExecutionFailure` shape.
- **The execution log changes after the turn settles.** The log is saved before settle ([code]
  `chat.ts:135`) and would have to be saved again. AGENTS.md says the log must not change after a
  failure; a later failure in the after-reply branch blurs this.
- **Who owns the branch?** If the turn queue is held until the branch ends, the "wait only on the same
  copy" rule is moot (the next turn waits anyway), and the only gain is earlier settling. If it isn't
  held, Stop finds no running turn ([code] `turns.ts:39`), and message deletion races the branch.
- **No error channel.** A failed summary branch has no SSE stream to report to: the turn's stream has
  ended with `turn.complete`. It needs a change event, a toast path and a place in the inspector.

A post-turn run queued on the same `TurnRegistry` key avoids all five points (§6).

### 3.7 What "a turn goes away" means

The proposal assumes a turn is a clean unit. In this app it isn't:

- A turn can have **several replies** (several Chat Outputs). Does deleting one of two replies retract
  the turn's writes?
- Deleting the **user message** while its replies remain: is the turn gone?
- An **empty send** has no user message; one with no reply has no message at all ([code] `chat.ts:88-90`).
  The proposal's `turns` list handles that, but `turns[].messageIds` duplicates the `executionId`
  already stored on messages ([code] `models.ts:43`).
- **Partial replies** from a stopped turn are excluded from history ([code] `chat.ts:31-33`). Do they
  keep the turn alive?

A precise rule is needed. The simplest one that matches the code: *a turn is present while any message
with its `executionId` exists; a turn with no message is present only if it completed*.

### 3.8 Other edge cases

| Case | Gap in the proposal |
| --- | --- |
| Failed or stopped turns | They drop all deltas while their completed replies are kept, so state and chat diverge: the same drift the design sets out to fix (P4). Keep the writes of completed write nodes, tied to the turn's surviving messages |
| An in-turn write branch fails | It aborts the sibling reply in the same wave ([code] `executor.ts:262-263`), so adding a summarizer makes replies less reliable. That makes post-turn work a reliability concern, not just a latency one |
| Session switches workflow, character or persona | `PATCH /api/sessions/:id` allows all three ([code] `routes/sessions.ts:34-42`). A `character`/`persona` partition moves the session to another copy mid-chat ("she forgot you"). It needs a defined behaviour and visibility in the inspector |
| No persona or no character selected | The copy key needs a sentinel value (`persona=none`), or reads and writes must be errors. Adding a persona later silently moves the session to a different copy |
| `partitionBy` edited after data exists | Existing copies become unreachable orphans. "Moving a key from chat scope to campaign scope doesn't change any workflow" is true of workflows but not of the data |
| Key removed, renamed or retyped | Logs hold ops for unknown keys or the wrong types. AGENTS.md data compatibility needs: unknown keys preserved and ignored, mismatched values fall back to the default with a warning (`.catch`), never a destructive rewrite |
| Definition renamed | Workflows reference definitions by id, but templates use the `name` (`{{state.bond.trust}}`). A rename silently breaks presets: unknown macros render empty, with only a preset warning. Make `name` immutable or treat a rename as a migration |
| Session deleted | "Retract unsealed contributions" has to run under the turn queue (the route bypasses it today) and finish before the file is gone. If it fails halfway, there is no recovery |
| Preset preview | `services/preset-preview.ts` renders without a session: which state does `{{state.*}}` show? Defaults, or a chosen session |
| Joining or leaving a bound instance mid-chat | Undefined: do earlier turns contribute, and what happens to unsealed writes on leave? |
| Copy ids in URLs and file names | `copyKey` contains `=` and `,` and doesn't match the repository id rule ([code] `repository.ts:39`). Use an opaque id (a hash of the canonical key) stored in the file's header |
| `history(n)` and `origin.turn` after deletions | Is the turn index monotonic (gaps after deletion) or dense? `seal-after: N` depends on the answer |

### 3.9 Performance

[reasoning], at alpha sizes.

- **Copy logs**: the whole file is rewritten per commit, the log is append-only forever (retractions
  included), and every snapshot replays it in full. A 2,000-turn chat with three writes per turn is
  about 6,000 entries, roughly 1–2 MB of JSON. Parsing and replaying that takes milliseconds, so it's
  fine. Shared campaign logs grow with **every** contributing session, though. They need checkpoint
  snapshots (value at `seq` N plus a tail), and the proposal's "JSONL with compaction" contradicts
  "nothing is ever deleted from the log" unless checkpoints are defined.
- **Embeddings**: transformers.js pulls in a native ONNX runtime. That means per-platform binaries
  (the dev environment is Windows), a model download on first use (through proxies, or not at all
  offline), and tens to hundreds of MB of memory in the server process. Stored as JSON, a 384-float
  vector is roughly 7–8 KB per item, so 10k items come to about 75 MB of JSON. Vectors would need a
  binary sidecar file. The proposal doesn't say where "cached by content hash and model" lives. Also,
  "a remote embedding provider can index, but then reads need a remote call" contradicts "All reads are
  local".
- **The `Gate` "unsummarized history exceeds N tokens"** condition needs a tokenizer. None exists;
  Memory is count-based ([code] `memory/index.ts`).

### 3.10 Conflicts with AGENTS.md contracts

| Contract | Conflict | Severity |
| --- | --- | --- |
| "Only nodes that some Chat Output depends on run" | Replaced by sinks. Fine, but it's a key contract and needs updating in AGENTS.md and in the `'unreachable from chat output'` log text | Low |
| "Message edit/delete change stored content only" | Delete now retracts state, and edit marks deltas stale. Under the computed-rewind design in §6, the contract holds literally (nothing is written on delete) | Medium |
| "After [failure] the execution log must never change" | `after-reply` saves the log after settle and may fail later | Medium |
| Locks in-process and not re-entrant; session writes through `update` | Respected in intent. The `after-reply` cross-wait (3.6) is a new hazard of the same kind | High |
| Data compatibility (additive, migrate-on-write, never destructive) | No rules for definition edits over existing logs (3.8). Log compaction would need the same care as preset migrations (back up, never delete) | Medium |
| Contract-first API | Respected. `copyKey` as a path param needs an id-safe form | Low |
| Deterministic message order and outcomes | Gate `probability` introduces randomness. Fine (CREATIVITY.md wants it), but the roll should be in the execution log, as CREATIVITY.md step 2 says | Low |
| "Nothing is automatic" | Rewind on delete and staleness are automatic but user-chosen policies. Acceptable if the UI shows the effect ("deleting this undoes: trust +1") | Low |
| Change events via `NotifyingRepository` | Copy logs aren't `Repository<T>` records, so the inspector's live updates need their own event (`state.changed`) | Low |

## 4. Maintainability and complexity

### 4.1 Concept count

Concepts a user or maintainer has to learn:

- **Records**: definition, key, bound instance, binding.
- **Types and ops**: six types, about ten operations, and `delete`.
- **Dimensions**: derived and bound, and the copy.
- **Logs**: delta, retraction, `seq`, `origin`, pending and committed.
- **Policies**: four rewind policies, sealing, three staleness policies, two timings.
- **Execution**: sinks and the one-writer rule.
- **Reads**: five read modes, two index kinds.
- **Nodes**: Gate, Parse JSON, State Read, State Write, Memory `since`.

That's roughly 25 concepts. The provider-records feature, which PLAN.md documents as five steps, had
about six. For a single-user alpha, I think the policies and the dimension or instance machinery are
premature. The node layer is about right.

### 4.2 Surface by phase

[reasoning], from the files a change would touch.

| Phase | shared | engine | server | web | Hard to change later |
| --- | --- | --- | --- | --- | --- |
| 1 (as proposed) | Definition and log schemas, `turns` on sessions, API contract, dynamic `state.*` macros | Sinks, `ExecutionContext.state`, `NodeResources` state, 2 nodes, buffered writes in the result | Definition repository and watcher, copy-log storage, commit in `chat.ts`, retraction in `messages.ts`, routes, events | Definition editor, read-only inspector, hints | **The on-disk log format and retraction semantics.** Once user data exists, AGENTS.md forbids breaking changes |
| 2 | Staleness schema | `after-reply` (an executor restructure), Gate, Parse JSON, `meta` | Post-settle commits, reverse index for edits | Stale flags | **`after-reply` in the executor**: hard to remove once workflows depend on it |
| 3 | Instance records, bindings | Dimension resolution at runtime | Locks, sealing, recovery, session-delete retraction | Session bindings UI | **Computed sealing**: changing it later changes past values |
| 4 | Manual-op schema | — | Retract and manual endpoints | Editing inspector | Low |
| 5 | Index config | Search read mode | BM25, ONNX runtime, vector store | Search options | **The native dependency**: knip, install size, Windows |

The risk is concentrated in phase 1's storage format. That is the part I would change (§6), because
everything after it inherits its semantics.

### 4.3 Under-specified parts

- The turn-presence rule (3.7).
- The `seq` assignment point (3.1).
- Op semantics after a retraction (3.3).
- Behaviour when a definition changes over existing data (3.8).
- Where vectors live (3.9).
- How "exclusive Condition branches" is decided. Branches can merge again downstream (Merge node), so
  telling exclusive branches apart takes a path analysis, and a dynamic `character` partition can make
  two writers target different copies anyway. Static analysis can't know that.

### 4.4 Testing strategy

[reasoning]

- **Make the fold a pure function in `shared`**: `(definition, entries, presentTurns) → value + meta`.
  Test it table-driven like `canConnect`, plus a generated-sequence test (random op sequences, random
  deletions) asserting determinism and the documented properties: tail undo is exact, and add-only
  collections are order-independent.
- **Fault-injection tests for any multi-file write**: make the repository throw between steps and
  assert the invariants. This is needed only if the two-file protocol survives.
- **Concurrency tests**: two sessions committing to one shared copy through `KeyedLock`; message
  delete racing a running turn; session delete racing a turn. The server test suite can already pause
  inside `update` by spying on `.silent` (AGENTS.md).
- **Contract coverage**: `app.test.ts` requires every endpoint to be exercised, so the API surface
  directly drives the test count. Fewer endpoints in phase 1 means less test weight.
- **Seeded workflows must keep validating** under the sink change. The existing test covers this.

## 5. Alternative architectures

| | Alternative | Strengths | Weaknesses | Verdict |
| --- | --- | --- | --- | --- |
| A | **The proposal**: per-copy delta logs, retractions, rewind policies | One model for every scope; full audit trail; exact undo of independent accumulations | Two-file protocol, recovery, replay ambiguities (3.3), retroactive policy edits, swipes need un-retraction | Too much machinery for phases 1–2 |
| B | **Per-turn writes stored in the session record**, keyed by `executionId`; value = fold over the turns still present | One atomic write per turn. Rewind is computed from existing messages, so delete stays content-only and needs no retraction records or recovery. Swipes later: each alternative carries its own writes | Session files get larger and are rewritten every 250 ms while streaming ([code] `turn-stream.ts:11`), and `GET /api/sessions` parses them all ([code] `routes/sessions.ts:9-10`). Covers session scope only | **Recommended for session scope.** Keep it small (scalars, capped collections) or use a sidecar file for large collections, with the session as commit point |
| C | **Per-turn snapshots (copy-on-write)**: store the post-value of every key after each turn | Trivially correct for tail undo and swipes; no replay at all; definition edits never rewrite history | Storage is state size × turns; collections are duplicated each turn unless shared structurally; deleting a middle turn has no effect | Use it **per key** for scalars (store post-values, as in B), not for whole-state snapshots |
| D | **Event sourcing with CRDT ops** (PN-counter, OR-set, LWW-register) | Concurrent shared writes merge by construction; well understood | CRDTs solve concurrent replicas, not undo. Clamps, caps and `set`-from-read still aren't CRDT-friendly; it adds theory for a single-process server that already serializes with locks | Not worth it. Borrow the idea only: restrict shared ops to the commutative set |
| E | **Embedded SQLite** (`better-sqlite3`, or `node:sqlite` where stable) for logs and indexes | Real transactions (no two-file problem), indexes, cheap appends, FTS5 for lexical search | Breaks "everything is hand-editable files" (presets and providers are YAML for that reason); a native dependency on Windows; PLAN.md places a database under "Later" as a new repository implementation | Defer. The right answer if shared state and search grow, but it should replace JSON storage wholesale rather than live beside it |
| F | **Post-turn work as a separate run** on an event ("on reply settled"), queued on the same `TurnRegistry` key | No executor restructure; its own execution log and error path; ordering for free (the next turn waits in the queue); reply failures and summary failures are isolated; matches PLAN.md's "event trigger nodes" | A second run re-reads state and must receive the settled replies as input; users wire two graphs, or one graph with a "post-turn" section | **Recommended** instead of `after-reply` (answers open question 7) |
| G | **Inline workflow-level variables** (declared in the workflow record) | No new record type, editor or endpoints; variables travel with the workflow (n8n "static data") | `PATCH` can switch a session's workflow mid-chat; preset templates can't be validated without a global catalog; promoting to shared scope later means moving the declaration | A reasonable phase-1 shortcut, but the proposal's argument for a global, validatable namespace is good. Keep definitions, allow only `partitionBy: [session]` at first |
| H | **A branching (git-like) chat**: a tree of turns, with state attached to each turn node; swipes are siblings and forks are branches | The cleanest long-term model for swipes, regenerate, forks and rewind; state at the head is just "state of the head's turn" | Changes message semantics (editing or deleting the middle usually becomes "branch from here"); large UI and storage change | The direction B grows into: keying writes by turn now keeps this open |
| I | **Derived views and reducers**: a summary is a recomputable cache keyed by the hash of its inputs, not a stored fact | Staleness is automatic (the hash differs) and needs no `derivedFrom` bookkeeping; rewind can't corrupt a cache | Recomputing costs LLM calls; it only fits deterministic or cheap derivations | Use it for staleness: a hash in `derivedFrom`, staleness computed on read (3.4) |

### Notes on B vs A for the motivating cases

| Case (from the proposal) | A (the proposal) | B (state in the session) |
| --- | --- | --- |
| Delete or regenerate the last reply | Retraction record and replay | The turn has no messages, so its writes drop out of the fold. Nothing is written |
| Delete message 3 of 50 | Retract turn 3; replay turns 4–50 on a different base (3.3) | Scalars stored as post-values: no change unless turn 3 was the latest writer. Collection items added in turn 3 drop out |
| Swipe between alternatives (later) | Needs un-retraction | Each alternative's turn carries its own writes; the active one is in the fold |
| Counter "turns since last injection" | Increment op per turn | Not stored at all: computed `meta.turnsSinceWrite` of `lastInjected`, which is cheaper and can't drift |
| Rolling summary | Collection add plus a staleness index | Collection add tagged with the turn; staleness computed from the hashes |

## 6. Recommendations

### 6.1 A minimal first slice

I'd build this first, ideally in three commits:

1. **Parse JSON node** (stateless; ships alone; `canConnect` stays as it is). Also a **Random node**
   whose roll is logged (CREATIVITY.md step 2). It replaces the Gate's `probability`.
2. **Sinks in the engine.** Add a `sink` flag on `NodeDefinition`, seed `reachable` from sinks
   (`prepare.ts:203-210`), and collect replies from a sink-specific hook instead of the
   `chat-output` type check (`executor.ts:206`). Keep "at least one chat-output" validation. Update
   AGENTS.md.
3. **Session state.**
   - **Definitions** as YAML records through `YamlRepository` (reusing scan, stamping, locks and the
     watcher). Phase 1 accepts only `partitionBy: [session]` and keeps the field so later scopes are
     additive. Raw YAML editing first, like provider `overrides`; a form later.
   - **Storage**: `Session.state?: { turns: { executionId, at, writes, derivedFrom? }[] }`, additive
     with a default. Writes are **post-values** for scalars and item-level `add`/`remove` (unique item
     ids) for collections. No retraction records, no copy logs, no protocol.
   - **The fold** is a pure `shared` function. A turn counts while any message with its `executionId`
     exists; a message-less turn counts only if it completed. Values are validated against the current
     definition with fallback to the default, so definition edits never rewrite stored data.
   - **Reads**: State Read with `value` and `meta` (`turnsSinceWrite`, `count`), plus
     `{{state.<def>.<key>}}` through a definitions catalog passed to preset validation, node-ui hints
     and the engine. Snapshots are **lazy and memoized** through `resources` (like `cachedGet`), never
     loaded by `validateWorkflow`.
   - **Writes**: State Write (`set`, `increment` (computed into a post-value from the snapshot),
     `add`, `remove`). Writes are buffered and returned with the result **and** with
     `ExecutionFailure`. Several writers per key are allowed and applied in a deterministic order
     (wave, then node id); the execution log shows each write.
   - **Commit**: the buffered writes are added to the same `settleTurn` mutation that stores the
     replies (`chat.ts:138-141`). One atomic write.
   - **Failure**: completed write nodes' writes are kept with the turn, exactly like completed replies.
   - **Execution log**: each node's reads (key, value seen) and writes.
   - **Inspector**: read-only, a panel showing the session's folded values and which turn wrote each.
     It can come from `GET /api/sessions/:id` with no new endpoint.

That covers counters, cooldowns, tension history, injected-item memory and per-chat summaries, which is
everything CREATIVITY.md needs to start, with one new record type and no new storage protocol.

### 6.2 Later, in this order

- **Post-turn runs** (alternative F) instead of `after-reply`: a second engine run queued on the same
  `TurnRegistry` key after settle, with its own execution log, the settled replies as trigger data and
  a change event on failure. The rolling summary example then works end to end, and a summarizer
  failure can never cost the user a reply.
- **Computed staleness**: `derivedFrom: [{ id, hash }]`, stale on read. Default `keep`.
- **Shared scopes, through an outbox.** A shared write is stored in the writing session like any
  other, and **published to the shared copy only when it seals**: when the next turn starts, under the
  turn queue, or through an explicit "commit to campaign" action.
  - Publishing is idempotent: the delta id is `executionId + nodeId`, so re-publishing after a crash
    is harmless. Recovery becomes "re-publish sealed, unpublished entries", done lazily per session.
  - The session reads the shared value plus its own unpublished entries.
  - Regenerating or deleting before the seal never touches the shared log. Deleting a session drops
    its unpublished entries, which is the proposal's own rule.
  - `follow-turn` is disallowed for shared definitions. Shared ops are limited to unbounded
    `increment`, `add`/`remove` by id, and `set` with last-writer-wins plus the proposal's
    "read changed before commit" warning.
  - The seal is stored at publish time, so policy edits are never retroactive.
- **Lexical search** (BM25) over collections. Semantic search only after the divergence harness shows
  that retrieval beats prompting (README open question 1), and then via a provider embedding call or a
  binary vector sidecar, not an in-process ONNX runtime by default.
- **Inspector editing**: a manual write is an entry with `origin: manual` in the same per-turn
  structure (a pseudo-turn), so no retraction concept is needed.

### 6.3 Cut or defer

| Item | Action |
| --- | --- |
| Retraction records, `seq`, the pending/committed protocol, startup recovery | **Cut**: replaced by computed presence (session scope) and the outbox (shared) |
| Four rewind policies | **Cut to one per scope**: session = follows its turn; shared = sealed at the next turn or by explicit commit |
| `derivedFrom` with `retract` | Cut. Keep `keep` and computed `stale` |
| `after-reply` in the executor | Cut, replaced by post-turn runs |
| One-writer-per-key validation with Condition exclusivity analysis | Cut, replaced by deterministic order and logging |
| Gate node | Defer. Condition already has `gt`/`lt` ([code] `nodes/condition/index.ts`); State Read `meta` plus Random plus Condition covers cooldowns and the hazard timer. Add a Gate later only as a convenience |
| `history(n)`, `items` filters | Phase 2; cheap under the fold |
| `object` `merge`, `text` `append` with a cap, cap eviction by `priority` | Defer; each adds a replay rule |
| Bound instances (campaigns) | Phase 3, after the outbox |
| Semantic index, transformers.js | Defer until measured |

### 6.4 Answers to the open questions

1. **Declared keys only, or free-form keys?** Declared only. Free-form keys defeat typed ports and
   template validation. For experiments, an `object` key with `set` is a scratchpad.
2. **One generic mechanism for bound dimensions, or a first-class campaign slot?** One generic
   mechanism, but limited to **one** bound dimension per definition, and phase 3. A first-class
   "campaign" slot is just the UI label for it.
3. **`seal-on-next-turn` by default, or an explicit commit?** Seal on the next non-empty user message
   by default, implemented as the outbox publish, with an explicit "commit now" action. Users get both
   with one mechanism, and shared logs never contain writes that were later taken back.
4. **Failed or stopped turns: drop all deltas, or keep completed ones?** Keep the writes of write
   nodes that completed, tied to the turn's surviving messages. That matches the existing contract for
   replies, and the user undoes both together by deleting the partial reply.
5. **Several writers on one key in one turn?** Allow them, in a deterministic order, logged. For
   shared copies, only the commutative ops listed in 6.2 merge across sessions.
6. **Separate definition records, or inline per-chat variables?** Definitions, because preset
   templates need a global catalog to validate `{{state.*}}`. Revisit inline variables only if users
   find the records heavy. Then they can become an implicit definition owned by the workflow.
7. **`after-reply` in the executor, or a separate run on an event?** A separate run on an event,
   queued on the session's turn queue (6.2). It is the PLAN.md event-trigger node in its first form.

### 6.5 Questions the proposal should add

- The turn-presence rule (3.7), including multi-output turns, partial replies and empty sends.
- What happens to existing data when a definition's keys, types, bounds or `partitionBy` change.
- Whether a definition `name` can change, given that templates bind to it.
- What a session's `character`/`persona` switch does to partitioned state, and what "no persona" maps
  to.
- Whether state appears in preset preview, and from which session.
