# Triggers, proposal 1: several workflows per reply, and what else may start them

October 2026. A design proposal answering the user's brief: a reply runs an **ordered list of
workflows** instead of one, each with an on/off toggle, sharing the chat's state; the list is per chat;
After Reply goes away; and later, other events may start workflows. It builds on
[STATE-DESIGN-PROPOSAL-3.md](STATE-DESIGN-PROPOSAL-3.md) as amended by
[STATE-DESIGN-AMENDMENT-1.md](STATE-DESIGN-AMENDMENT-1.md), and changes its Part 5 (post-turn runs).
It is checked against the code of PR #2 (frontend UX, stacked on #1), where After Reply runs, the Trigger
node, chat settings, regenerate and swipes are already built.

## The brief, and the design branch

1. Sending a message runs an ordered list of workflows. Each can be switched off.
2. They all read and write the same chat state. Reads and writes must stay ordered, but workflows that
   can't affect each other may run at the same time.
3. The list belongs to the chat. A new chat starts with a copy of the current chat's list.
4. After Reply is removed.
5. Later: user-made triggers that tie an event (a reply, an edited message, a custom event an LLM raises
   during a reply) to one or more workflows.

The open question was **who starts a workflow**: workflows calling workflows, workflows raising custom
events that other workflows subscribe to, or a fixed set of triggers. The driving use case: an LLM checks
"is there a new character in the user's message?" and, if so, a workflow fleshes that character out.

## Recommendation in one paragraph

**Stick to fixed triggers, and let state carry the "events".** A trigger is an app event (a reply, later
an edit or a button) plus an ordered list of workflows. Inside one firing, a workflow that wants to
"raise an event" writes story state, and a workflow further down the list conditions on it. The list's
order is the only order, every workflow runs at most once per firing, so cycles can't exist and nothing
needs detecting. The character use case needs no events at all (see the walkthrough). Workflows calling
workflows is a reuse feature, not a triggering one, and can come later as a statically checked
sub-workflow node.

## Decisions proposed

| # | Decision |
| --- | --- |
| T1 | A **trigger** is an app event plus an ordered list of `{ workflow, enabled }`. A chat has one list per trigger. Only **Reply** exists in the first version |
| T2 | **Result = running the enabled workflows one after another, top to bottom.** The app runs them at the same time whenever that can't change the result (rule below) |
| T3 | A workflow waits for an earlier one **only if it reads something the earlier one writes**. Writes are applied in list order whatever order they finish in |
| T4 | The chat's messages count as state: Chat Output **appends** to them, history readers (Memory, `{{history}}`, Next Chunk, Unlinked Messages) **read** them. Replies are placed in list order |
| T5 | One firing of a trigger is **one turn**. Every workflow's writes and replies belong to it and follow the turn rule (they live as long as the turn's replies) |
| T6 | **After Reply is removed.** Post-reply work is a workflow listed after the reply workflow; because it reads the history, it waits for the reply, which is exactly what After Reply did |
| T7 | Workflows never raise events and never start other workflows. Signalling between workflows goes through state, within the list order |
| T8 | A new chat copies the **open chat's** reply list (order and toggles), as it already copies the persona. With no chat open, it gets the Default Assistant alone |
| T9 | Feature name: **Triggers** (each one shown as "On reply", later "On edit", …). The Trigger node is relabelled **Gate**; its stored type id `trigger` stays, so saved workflows keep loading |

## Why not custom events

Cycles are the visible risk, but they are solvable: if emits are declared statically (an Emit node with a
fixed event name), the subscription graph is known at save time and a cycle can be rejected. The real
costs are elsewhere:

- **Ordering.** When an event is raised mid-run with two subscribers, which runs first? Does the emitter
  wait for them? Does the reply wait? Each answer needs rules the user has to learn, and the list gives
  them for free.
- **State consistency.** Proposal 3 promises that results never depend on which node finishes first. A
  cascade of runs started at run-time makes "what did this workflow see" depend on timing, unless the
  cascade is serialized, at which point it is the list again, only harder to see.
- **Ownership of writes.** The turn rule (state lives as long as the turn's replies) needs to know which
  turn a write belongs to. A cascade started by a reply belongs to that turn anyway, so events add no
  power here, only indirection.
- **Explaining a run.** "Why did *Flesh out character* run?" With a list: it's third in On reply, and its
  Condition branch was taken because `cast.pending` had an item. With events: follow subscriptions
  across workflows.

Everything an LLM-raised event would express ("a new character appeared", "the scene stalled") is a
value: an LLM node answers, Parse JSON reads it, State Write stores it, and a later workflow's Condition
(or a source node with nothing to output) skips its branch when there's nothing to do (Proposal 3: an empty source skips
the downstream branch). A workflow whose sinks all sit behind a skipped branch costs only its gate.

What events are genuinely needed for are things **outside a reply**: an edited message, a deleted
message, a button the user clicks. Those are triggers (T1), not something workflows raise.

## The ordering rule in detail

### Access sets

At prepare time (`prepareWorkflow` already parses configs and walks preset templates), each workflow gets
two sets of **resources**:

| Resource | Read by | Written by |
| --- | --- | --- |
| `state.<definition>.<key>` | State Read; `{{state.<def>.<key>}}` in any template (preset or config) it renders; State Write `increment` | State Write |
| `state.<definition>` (whole) | `{{state.<def>}}`, `{{#each state.<def>}}`, any dynamic lookup into it | none (a write names a key) |
| `messages` | Memory, `{{history}}`, Next Chunk, Unlinked Messages, Chat Input's history outputs | Chat Output (append) |

- Node definitions declare their access the way they declare `resolvePorts`: an optional
  `stateAccess(config) → { reads, writes }`. No per-type branches in the scheduler.
- Template access comes from the same AST walk that validates presets, so it can't drift from what
  renders.
- **Unknown means everything.** A placeholder node (unknown type), a template path the walk can't resolve,
  or a node without `stateAccess` that is marked as touching state: the workflow reads and writes
  everything, so it waits for all earlier workflows and all later ones wait for it. Correct first, fast
  where provable.
- Draw's and Gate's own bookkeeping is stored under `{ kind: 'node', nodeId, key }`. Node ids are only
  unique within a workflow, so with several workflows that target must also name the workflow
  (`workflowId`, additive; a stored target without it belongs to the session's legacy `workflowId`).
  Then it is private to that node and never conflicts across workflows. A workflow may appear only once
  in a list, which keeps those keys private.
- Chat settings are read-only during a run (the user owns them), so they never order anything.

### Scheduling

For each enabled workflow *j*, its predecessors are the earlier workflows *i* with
`writes(i) ∩ reads(j) ≠ ∅`. *j* starts as soon as its predecessors have settled.

- **Each run reads a view** = the turn-start state plus the committed writes of **earlier-listed** runs.
  Later-listed runs' writes are never visible, even if they committed first. Because a run only starts
  after every earlier run whose writes it reads has settled, its view is complete for what it reads.
- **Each run commits when it settles** (its own settle write, generalizing today's `settlePostRun`), so
  replies are saved as soon as their workflow ends and dependants can start.
- **The stored result is folded in list order**, not completion order. Two workflows writing the same
  key is not a conflict to resolve: the writes are applied top to bottom, exactly as if the workflows
  ran one after another. For two `set`s that means the lower one's value is the one that stays; for
  collection `add`/`remove`, both apply in list order. So writers of the same key don't need to wait for
  each other, and the same goes for appended replies.
- **`increment` reads the key.** It is stored as the value it produces (a `set` of the post-value,
  clamped), so it is computed from the run's view. Two workflows incrementing the same key must
  therefore run in order, or one increment would be lost: `increment` counts as a read of the key, and
  the lower workflow waits for the upper one.
- Read-only overlap (both read `scene.tension`) never orders anything: the user's own example.

The editor shows the plan: each row in the chat's On reply list says "runs with the ones above" or "waits
for *Reply*" (computed by the server from the access sets), so the parallelism is visible and never a
surprise.

### Failure, stop, timing

- A failed workflow keeps what it completed (the existing rule) and is reported with its name. The
  workflows after it still run, on what was committed. (A per-row "stop the list if this fails" toggle is
  a later option if needed.)
- Stop stops every running and pending workflow of the turn.
- The next message waits for the whole list, as it waited for the post-turn run. The reply itself is
  never delayed by a workflow listed after it that doesn't feed it.
- Each run has its own execution log; the turn records its runs in list order. The per-message chip and
  the delete confirmation list writes per workflow.
- Today's after-reply UI generalizes: the quiet status row above the composer (`PostRunStatus`) shows
  the workflows still running once the replies have settled, and Escape still never stops them (only
  the Stop button does), as it never stops an after-reply run now.
- **Regenerate** re-runs the whole list as a new alternative, and a **swipe** switches every run of the
  turn at once. That needs no new rule: an alternative is already an ordinary turn, and `turnPresence`
  applies a turn's writes only while its replies are active.

## Validation changes

- A workflow needs exactly one **Chat Input** (it is the trigger's input) and **at least one sink**
  (Chat Output, State Write, …). "At least one Chat Output" goes: a summarizer workflow has none.
- Chat Input gains a `replies` output: the replies earlier-listed workflows of this turn appended (it
  reads `messages`, so it orders like history). It replaces After Reply's `replies`.
- The seeded workflows keep validating unchanged.

## Data (additive)

| Data | Where | Shape |
| --- | --- | --- |
| Reply list | Session | `triggers: { reply: [{ workflowId, enabled }] }`, optional |
| Legacy | Session | `workflowId` stays. A session without `triggers` reads as `reply: [{ workflowId, enabled: true }]`; the first save writes `triggers` and keeps `workflowId` (unknown fields survive, nothing is removed) |
| Turn | Session story state | Today a `TurnEntry` holds the reply run (`executionId`, `writes`) and at most one after-reply run (`postExecutionId`, `postStatus`, `postError`, its writes appended by `withPostRun` after the turn's own). That pair generalizes to `runs: [{ executionId, workflowId, position, status, error }]`, each write tagged with its run, and the fold applies runs by `position`. An entry without `runs` reads as the reply run followed by its post run, so stored chats fold exactly as before. The restart rule (`effectivePostRun`) applies per run |
| Node keys | Session story state | `{ kind: 'node', nodeId, key }` gains an optional `workflowId` (see "Access sets") |
| Chat settings | Session | Unchanged storage. The panel shows the settings of all enabled workflows; a key declared by several workflows is one setting (a type clash shows the existing "doesn't fit" warning). `PATCH` checks keys against that union instead of the one workflow (`400 CHAT_SETTING_INVALID` otherwise) |

API: `PATCH /api/sessions/:id` gains `triggers` (whole list replace); `createSession` takes either
`workflowId` (legacy) or `triggers`. The plan ("waits for…") comes back with the session view.

## Walkthrough: new characters

Two workflows, in this order, in On reply:

1. **Reply** (the user's usual one), unchanged.
2. **Cast tracker**: Chat Input → LLM ("list characters named in the last user message and the reply
   who are not in this list: `{{#each state.cast.known}}…{{/each}}`; answer JSON") → Parse JSON →
   Condition (list not empty) → LLM (flesh out each one, the user's preset) → State Write
   `cast.known` (`add`, linked to the reply through Chat Input's `replies`).

Cast tracker reads `messages` (it looks at the reply) and `cast.known`; Reply writes `messages`. So Cast
tracker waits for Reply, and Reply never waits for it. When no new character shows up, the Condition
branch is skipped: one cheap LLM call. Delete the reply, and the characters it introduced are forgotten
with it (turn rule).

To check the **user's message only** and have the result ready for the reply (so the reply already knows
the new character), move Cast tracker **above** Reply: it then sees the history up to the user's message. Reply's preset
reads `{{state.cast.known}}`, so Reply now waits for Cast tracker. The order in the list is the only
thing the user changed.

Splitting detection and fleshing-out into two workflows works the same way: the detector writes
`cast.pending`, the flesher (listed below it) reads it and skips when it is empty.

## Rolling summaries, without After Reply

On reply: **Reply**, then **Summarize** (Next Chunk → LLM → State Write `memory.summaries`). Next Chunk
reads `messages`, so Summarize waits for Reply. Reply reads `memory.summaries`, which Summarize writes,
but Summarize is **below** it, so Reply sees the turn-start value, as before. Summaries are toggled per
chat now, which After Reply couldn't do.

## Later triggers

In order of value:

1. **Run now** (a button per workflow in the chat): runs one workflow on demand, e.g. "flesh out
   characters" after an import. Its writes form an entry at the end of the chat, like Proposal 3's manual
   corrections, and are not undone by deleting a reply.
2. **On edit / On delete**: the list runs with `trigger.message` set to the edited message (and an
   `event` field). Writes live as long as the **edited message** exists, the natural generalization of
   "as long as the turn's replies" (a run's writes live as long as the messages that caused it). This
   answers Proposal 3's open question 4 ("should a workflow react to an edited reply?").
3. **Sub-workflow node** (reuse, not triggering): a node that inlines another workflow. The call graph is
   static, so a cycle is a save-time error, not a runtime risk.

LLM-raised custom events are not planned: they are state plus a Condition (see "Why not custom events").

## Phases

1. Session `triggers` with the legacy read; chat panel list (reorder, toggle, add, remove); new chat
   copies the list; runs strictly one after another (no parallelism yet), one turn with several runs.
2. Access sets (`stateAccess`, template walk, unknown = everything), the scheduler and the list-order
   fold; the "waits for" hints.
3. Retire After Reply; Chat Input's `replies`; "at least one sink" validation. User workflows and the
   "Rolling summaries (example)" pack already contain After Reply nodes, so it can't simply go:
   - it leaves the node palette, but a workflow that has one keeps its post part, run right after that
     workflow's own reply part, inside its row of the list;
   - the editor offers "Split into two workflows" (the post part becomes a new workflow, listed below
     the original in the chats that use it);
   - the example pack ships the two-workflow version for new installs only (seeds never overwrite).
4. Later triggers, in the order above.

Phase 1 alone delivers the feature with correct results; phase 2 only makes it faster, so it can be
measured before it is built.

## Open questions

1. ~~Should a workflow be allowed twice in one list?~~ Decided: no, for now. It keeps node-private
   state private and the list readable.
2. ~~Should the editor warn when two enabled workflows write the same key?~~ Decided: no. Writing the
   same key is ordinary: the list order says what happens, like running the workflows one after
   another. The "waits for" hints are the only feedback.
3. Name check: "Triggers" in the UI and the `{{trigger.*}}` template namespace now mean the same thing
   (the event that started the run). The Gate rename frees the word.
