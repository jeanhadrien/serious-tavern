# State design, proposal 2: what the user gets, and the first slice

The second version of [STATE-DESIGN-PROPOSAL-1.md](STATE-DESIGN-PROPOSAL-1.md), rewritten after
[STATE-DESIGN-REVIEW-1.md](STATE-DESIGN-REVIEW-1.md) (October 2026). Still a proposal: nothing is
decided until the user signs it off.

The review kept the node layer of proposal 1 (typed keys, snapshot reads, buffered writes, writes as
sinks, explicit parsing) and replaced its storage and rewind model, which was built for the hardest case
(shared state written by several chats at once) and charged that cost to the common case (state for one
chat). This version is written from the user's side first: what they can build, what they see, and what
happens when they edit the chat. Implementation notes come last and stay short.

## Why this exists

[CREATIVITY.md](CREATIVITY.md) lists per-session state as the first gap, because every part of its
pipeline needs memory across turns:

| Creativity need | What has to be remembered |
| --- | --- |
| Trigger: hazard function, cooldowns per intensity | Turns since the last injection, per level |
| Trigger: tension against a target curve | Tension per turn |
| Trigger: stagnation | Recent turns (or their summaries) to compare |
| Selection: novelty against session memory | What was already injected or written |
| Integration: recording what was injected and why | A per-turn trace of injections |
| Variety within a long session | Summaries, so a long chat doesn't circle back |
| Variety across sessions, world-specific seeds | A world's own facts, shared by several chats (later) |

The same building blocks also cover PLAN.md backlog items that are really the same thing: per-chat
variables, summarization every N messages, a memory node with a summarize strategy, and an author's note.

## What the user gets

### State definitions: "what this chat remembers"

A **state definition** is a small named list of things a chat remembers, with a type for each. The user
writes it once and every workflow can use it.

```yaml
name: scene
keys:
  tension:          { type: number, default: 3, min: 0, max: 10 }
  lastInjectedTurn: { type: number }
  injected:         { type: collection, cap: 30 }   # items: { text, level }
  summaries:        { type: collection, cap: 20 }   # items: { text, from, to }
```

- The `name` is how presets and templates refer to it: `{{state.scene.tension}}`. It can't be renamed
  once data exists (a rename would silently empty every template that uses it); copying to a new name
  is the way to rename.
- Keys are **declared**, never invented on the fly. That gives typed node ports, autocomplete in the
  preset editor, and a warning when a template names a key that doesn't exist.
- Types: `number`, `boolean`, `text`, `enum`, `object`, and `collection` (a list of items, each with
  an id and a `text`, plus declared fields).
- Editing a definition never rewrites stored data. A value that no longer fits (a removed key, a changed
  type) is ignored and the key reads as its default, with a warning in the inspector; restoring the key
  brings the value back.

In this first version, every definition is **per chat**: each session has its own copy. The definition
format already has room for other scopes (see "Later"), so nothing will need rewriting when they arrive.

### Nodes

| Node | What it does |
| --- | --- |
| **State Read** | Outputs a key's current value, or its **meta**: turns since it was last written, item count. |
| **State Write** | Stores a value: `set`, `increment` (numbers), `add` / `remove` (collection items). Always runs if its inputs are available, even when no reply depends on it. Passes the value through. |
| **Parse JSON** | Turns an LLM's text answer into an object, list or number, checked against the target key's type. A model that answers "about 7/10" fails visibly instead of storing garbage. |
| **Random** | Rolls a number, picks from a list, or flips a weighted coin. The roll is recorded in the execution log. |

Templates read values directly: `{{state.scene.tension}}`, `{{#each state.scene.summaries}}…{{/each}}`.

Existing nodes do the rest: **Condition** compares (`turnsSinceWrite > 5`, `roll < 0.2`), **LLM**
rates, summarizes and extracts, **Memory** supplies the messages to summarize.

### What happens when the chat is edited

This is the rule the whole design is built on, stated the way the user sees it:

> **What a turn stored lives as long as that turn is in the chat.**

- Every reply knows which turn produced it. A turn is in the chat while **any of its replies**
  (including a reply stopped halfway) still exists. The user message doesn't count: deleting a reply
  to try again must undo its state even though the user message stays. A turn that produced no reply
  at all stays if it completed.
- **Deleting the last reply** undoes everything that turn stored. The tension goes back to its previous
  value, the injected item disappears, the summary written that turn is gone.
- **A value is what the most recent surviving turn wrote.** Deleting a turn in the middle of the chat
  only changes a value if that turn was the latest one to write it. Later turns built on it, and their
  values stay.
- **Collections** contain the items added by surviving turns, minus the ones removed by surviving turns,
  newest first, cut to the key's `cap`. Deleting the turn that removed an item brings the item back.
- **Editing a message** never changes stored state. (Later: a value can be marked **stale** when a
  message it was built from has changed; see "Later".)
- **Regenerate and swipes** (not built yet) follow the same rule: each alternative reply carries what
  its own turn stored, and the visible alternative is the one that counts.
- **A failed or stopped turn** keeps what its completed nodes stored, exactly as it keeps its completed
  replies. Deleting the partial reply undoes both.

### Seeing it

- The **execution log** shows, per node, what was read (and its value) and what was written.
- A **state panel** next to the chat (read-only at first) shows the current values of the chat's state
  and which turn wrote each one. Clicking a turn jumps to its message.
- Later: per-message annotations ("this turn stored: tension 6, injected 'resin smell'"), and editing a
  value by hand from the panel.

## Walkthroughs

### Tension curve and a cooldown (creativity trigger)

1. Each turn, an LLM node rates tension 0–10 → Parse JSON → State Write `scene.tension` (`set`).
2. A Random node rolls 0–1. State Read `scene.lastInjectedTurn` (meta: turns since written).
3. A Condition passes when `roll < threshold` **and** at least 4 turns have passed since the last
   injection. The threshold comes from the volatility dial (a workflow input or a preset input).
4. On the "inject" branch: pick a seed (a Random pick from a list, or an LLM proposing candidates with
   code picking), State Write `scene.injected` (`add`, with its level) and `scene.lastInjectedTurn`.
5. The preset includes the seed at depth, worded by level (CREATIVITY.md §Integration).

Delete that reply and the cooldown, the injected item and the tension all go back.

### Rolling summary

1. A Condition on State Read `scene.summaries` meta: more than 10 turns since the last summary.
2. Memory gives the messages since the last summary → LLM summarizes → State Write
   `scene.summaries` (`add`, with the message range).
3. The preset shows the summaries, then the recent history.

The summary call runs inside the turn in this first version, so it adds latency on the turns where it
fires, and a failing summary fails the turn. Moving it after the reply is the first item of "Later".

### Author's note / per-chat variables

A definition with `text` keys (`note`, `goal`) and a preset entry at depth that renders
`{{state.notes.note}}`. Setting it by hand needs the editable state panel (later); until then a workflow
can set it from a chat command parsed by a Condition.

## Later, in order

1. **Post-turn runs.** Work that should not delay or endanger the reply (summaries, extraction) runs as
   a second, separate run right after the turn settles, in the same per-chat queue: the next message
   waits for it, it has its own execution log, and its failure is reported without touching the reply.
   It is the first form of PLAN.md's "event trigger nodes" ("on reply").
2. **Stale values.** A write can record which messages it was built from. If one of them is edited or
   deleted, the value is marked stale (shown in the panel, readable as meta) but kept. A workflow can
   treat "stale" as a reason to regenerate; nothing happens automatically.
3. **Editable state panel.** Manual edits are recorded like a turn's writes, marked as manual.
4. **Shared scopes.** A definition gains `partitionBy`:
   - `[character]` or `[character, persona]`: a character's memory across every chat ("she remembers
     you").
   - A named instance a chat **joins**, such as a campaign: several chats, possibly in parallel, share
     one world's state.

   Shared state needs a different rewind rule, because one chat must not rewrite what others have built
   on. A chat's writes to shared state stay **pending in that chat** (visible to it immediately) and are
   **published** to the shared copy when sealed: when the user sends the next message, or right away
   with an explicit "commit" action on a reply. Regenerating or deleting before that never touches the
   shared copy. After publishing, undoing is a deliberate action in the panel, never a side effect of
   editing one chat. Shared keys allow only operations that combine cleanly across chats (`add`,
   `remove`, unbounded `increment`, `set` with last-writer-wins).
5. **Search over collections**: keyword search first; semantic search only if the divergence harness
   shows retrieval beats a good prompt.
6. **History reads** (`history(n)`: a key's value turn by turn), item filters, a **Gate** convenience
   node if the Random + Condition pattern proves tedious.

## What this deliberately leaves out

- Anything automatic: no built-in summarizer, lorebook or memory behaviour.
- Undo for middle-of-chat deletions beyond "a value is what the latest surviving turn wrote". Exact
  replay would need re-running later turns.
- Free-form keys. A scratchpad is an `object` key with `set`.

## Implementation notes

For the coding brief; see REVIEW-1 for the reasoning and code references.

- **Definitions:** YAML records under `data/state/definitions/`, through a `YamlRepository` subclass
  (scan, stamping, locks, watcher, change event). `partitionBy` exists in the schema but only `[]`
  (per chat) is accepted in this slice.
- **Storage:** `Session.state` (additive, default empty): a list of per-turn entries
  `{ executionId, at, completed, writes }`. Scalars store the **value after the write** (an increment is
  computed from the turn's snapshot), never the operation. Collections store item-level `add` / `remove`
  with generated item ids.
- **The fold** is one pure function in `shared`: `(definition, entries, presentTurns) → values + meta`,
  table-tested plus randomized sequences (tail undo exact, determinism).
- **Engine:** a `sink` flag on node definitions replaces the Chat Output special case in "what runs";
  reads come from a lazy, memoized snapshot through `resources` (never loaded by `validateWorkflow`);
  writes are buffered and returned with the result **and** with `ExecutionFailure`. Several writers
  on one key are allowed, applied in a deterministic order (wave, then node id) and logged.
- **Commit:** the buffered writes are added in the same `settleTurn` mutation that stores the replies:
  one atomic session write, no second file, no recovery pass.
- **Templates:** a definitions catalog feeds `{{state.*}}` to preset validation, node-ui hints and the
  engine, instead of extending the static macro list. Preset preview renders defaults.
- **API:** definitions CRUD (contract first); the session already carries its state, so the panel
  needs no new endpoint.
- **Docs:** AGENTS.md (sinks replace "only nodes a Chat Output depends on run"), README, and
  `docs/TEMPLATING.md` for `{{state.*}}`.

## First slice, as commits

1. Parse JSON node.
2. Random node (roll, pick, weighted coin), roll in the execution log.
3. Sinks in the engine (no behaviour change for existing workflows; seeded workflows still validate).
4. State definitions: schema, repository, API, raw YAML editor.
5. Session state: storage, fold, State Read / State Write, buffered writes and commit, execution log
   entries.
6. `{{state.*}}` in templates, with hints and validation.
7. Read-only state panel in the chat.

## Open questions

1. Is per-chat-only the right first scope, or does a character's memory across chats matter enough to
   come before post-turn runs?
2. Is "a value is what the latest surviving turn wrote" understandable enough, or does the panel need
   to show what a deletion will undo before it happens?
3. Should state definitions be separate records, or could a workflow carry its own small definition
   for quick experiments (promoted to a record when shared)?
4. Where does the volatility / intensity dial live: a preset input, a workflow input, or a state key the
   user sets per chat?
