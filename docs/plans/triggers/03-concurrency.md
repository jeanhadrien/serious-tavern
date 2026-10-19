# Triggers, step 3: run independent workflows at the same time

Design: [docs/explorations/TRIGGERS-PROPOSAL-1.md](../../explorations/TRIGGERS-PROPOSAL-1.md), "The ordering rule in
detail" (its phase 2). Builds on steps 1 and 2 ([01-reply-list.md](01-reply-list.md),
[02-remove-after-reply.md](02-remove-after-reply.md)).

**The guarantee does not change:** a turn's result is always what running the enabled workflows one after another,
top to bottom, would give. This step only removes waits that cannot change the result. If in doubt, wait.

## Access sets (engine, computed by `prepareWorkflow`)

`PreparedWorkflow.access = { reads: Resource[], writes: Resource[] }`, from the nodes that run (sinks and their
upstream), where a `Resource` is one of:

| Resource | Meaning |
| --- | --- |
| `{ kind: 'key', definitionId, key }` | one key of a state definition |
| `{ kind: 'definition', definitionId }` | every key of a definition (a read of the whole definition) |
| `{ kind: 'state' }` | all story state (a read that cannot be narrowed) |
| `{ kind: 'messages' }` | the chat's messages |
| `{ kind: 'everything' }` | unknown: reads and writes all of the above |

Two resources overlap when they name the same thing or one contains the other (`everything` ⊃ `state` ⊃
`definition` ⊃ `key`; `everything` ⊃ `messages`).

- **Every node definition declares its access**: a new **required** `access(config, info) → { reads, writes }`
  on `NodeDefinition` (`info` gives the node's connected output ports), so a new node cannot forget it (TypeScript
  enforces it). Most nodes answer `{ reads: [], writes: [] }`. The ones that touch shared data:
  - State Read: reads its key (a linked read mode also reads `messages`: link status depends on the chat).
  - State Write: writes its key; **`increment` also reads it** (it is stored as the value it produces).
  - Chat Output: writes `messages`.
  - Chat Input: reads `messages` when its `history` or `replies` output is connected.
  - Memory, Recall: read `messages`. Next Chunk, Unlinked Messages: read their key and `messages`.
  - Draw, Trigger: their node-private keys are scoped by workflow (step 1), so they conflict with no other
    workflow; they declare no shared access (plus whatever their config reads, if any).
  - LLM and any node that renders templates: the template reads below.
- **Template reads** come from `analyzeTemplate` (shared, `template-analysis.ts`), over every template the run renders:
  node config templates and the presets the LLM nodes use (already snapshotted by `prepareWorkflow`).
  `state.<name>.<key>` reads that key (names map to definitions through the listing the turn already loads);
  `state.<name>` (also as an `#each`/`#with`/`linked` argument) reads the definition; a bare `state`, `lookup` on
  state, or anything the walk cannot narrow reads all `state`; `history` reads `messages`. A reference to an unknown
  definition name reads nothing (it renders empty).
- **Character and persona fields** also render macros. The fields of the characters and persona a run can render
  (the session's character and persona, and the cards Character nodes name) are scanned the same way at turn start.
- **Unknown means everything:** a placeholder node (unknown type) gives `everything`.

## Scheduling (server)

Within each section (reply section, after section; step 2), for each run *j* in list order, its predecessors are the
earlier runs *i* of the turn (either section) with `writes(i)` overlapping `reads(j)`. Run *j* starts once every
predecessor has settled. The after section still starts only after the reply section's result is sent.

- **Views.** Run *j* reads the turn-start state plus the committed writes of the runs **listed above it** only, and the
  chat as it stands restricted to what runs listed above it saved (the user message, then their replies in list
  order). Writes and replies of runs listed below it are never visible, even if they committed first.
- **Stored order is list order**, not completion order: a run's writes go into the entry after the writes of the runs
  listed above it and before those listed below it, and its replies go into the chat after the replies of the runs
  listed above it (before any already saved by runs listed below it). The fold and the messages then read exactly as
  if the runs had settled top to bottom. Tag stored writes with their run (`runId`, additive) so a settle can place
  them; `withRunSettled` does the placing, pure, with table tests.
- **Stop** stops every running run of the turn; runs that have not started do not start. A failure never stops the
  others; a run whose predecessor failed still runs, on what was committed.
- `runs` in the entry stays in list order (records of runs not yet settled are placed by list position).
- `turn.complete`/`turn.error` and the result's `executions` keep list order.
- Each run's execution log records the runs it waited for (`waitedFor: executionId[]`, optional, additive).

## The plan in the chat (contract first)

- `GET /api/sessions/:id/reply-plan` → `{ entries: [{ workflowId, waitsFor: string[], reason? }] }` for the enabled
  entries of the list: the direct predecessors (by workflow id) and a short plain-language reason ("reads the chat
  history Default Assistant writes", "reads scene.tension, which Pacing writes"). An invalid workflow has no plan
  entry and a `reason` saying so. Computed with the same access sets as a turn.
- Web: the On reply rows show it under the name: "Runs alongside the ones above" or "Waits for *X*" (the reason as the
  title text). Fetched when the list changes and on `workflows.changed`/`stateDefinitions.changed`/
  `presets.changed`; never in the token path.
- Streaming: several runs stream at once. `run.start` gains `position` (the run's index in the enabled list); the web
  places streaming rows by position, so replies appear in list order while they stream.

## Tests

Pure: overlap rules, each node's `access`, the template walk (key, definition, bare `state`, `lookup`, `#each`
contexts, `history`, unknown names), placing writes and replies by list position. Server: two independent workflows
run at the same time (gate each with a test node or a slow fake adapter and assert both started before either
ended); a workflow reading a key another writes waits; two `set`s to one key from independent workflows finish in
reverse order and the stored value is still the lower one's; two `increment`s on one key wait and count twice; a
history reader waits for the replying workflows above it; replies stored in list order when the lower one finishes
first; Stop with two running; a failure beside a running one; the plan endpoint (and contract coverage); every
registered node declares `access` (a registry test).

## Docs

README: the ordering rule as users see it ("same result as top to bottom; independent workflows run together; the
On reply list says which wait"), and the plan endpoint. `docs/FRONTEND-UX.md` for the row hint.
