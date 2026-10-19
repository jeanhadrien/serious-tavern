# State design, proposal 3: settings, story state, summaries and authored collections

The state design (October 2026), **built in phases 1–7** (see [state-impl/HANDOFF.md](state-impl/HANDOFF.md);
user guide: [docs/STATE-AND-LORE.md](../STATE-AND-LORE.md)). It replaced two earlier proposals and the two
reviews of them (one on implementation, one on product fit against [CREATIVITY.md](CREATIVITY.md)); those
documents were removed from the repository after the build and remain in the git history. This document
is kept up to date with what was built. [STATE-DESIGN-AMENDMENT-1.md](STATE-DESIGN-AMENDMENT-1.md) records
the one design change made during the build (message links; summaries as story state) and its reasoning;
Part 3 below already describes the result.

## Decisions taken

| # | Decision | Source |
| --- | --- | --- |
| D1 | Values the user sets (dials, notes) are **chat settings**: declared by the workflow, set per chat, passed to the run, never undone by editing the chat | User, after the product review |
| D2 | Values a turn writes are **story state**: declared in state definitions, stored per chat, and they live as long as the turn's replies | Proposal 2, both reviews |
| D3 | The prompt gets the most recent messages raw and older history as **summaries of chunks**. A summary is **story state**: an item of a collection key that **links to the messages it covers**. It is used only while those messages are unchanged, and it lives with the turn that wrote it (amendment 1) | User |
| D4 | Lorebooks and decks are one thing: **authored collections**, written and edited by the user, read-only for workflows. Two ways to read them: **Recall** (by relevance) and **Draw** (by chance) | User, the product review |
| D5 | Story state is **per chat** first. Shared writable state (a character's memory across chats, campaigns) comes later, through an outbox | Both reviews |
| D6 | Expensive work after the reply (summaries, extraction) runs as a **separate post-turn run** on the chat's queue, never inside the reply's run | The implementation review |
| D7 | No variations view or harness in this plan | User |
| D8 | Nothing is automatic: every behaviour is a node or a template the user wires | AGENTS.md, PLAN.md |
| D9 | Any collection item may **link to chat messages** (ids plus a fingerprint; status computed on read). Nodes stay generic: nothing in the engine is about summaries | User (amendment 1) |

## The five kinds of data

The design separates data by **who owns it** and **how long it lives**, because that decides what
happens when the user edits the chat.

| Kind | Who writes it | Who reads it | Lives | Scope (now) | Example |
| --- | --- | --- | --- | --- | --- |
| **Chat settings** | The user, in the chat | Workflows | Until the user changes it | One chat | Volatility dial, author's note, max intensity |
| **Story state** | Workflow turns | Workflows | As long as the writing turn's replies | One chat | Tension, turns since last injection, injected items |
| **Summaries** (a kind of story state) | Workflow (post-turn) | Workflows | As long as the writing turn's replies; used only while the messages they cover are unchanged | One chat | Summary of messages 1–20 |
| **Authored collections** | The user, in an editor | Workflows | Until the user edits them | Global records | Lorebook of the Northern Wastes, a deck of forest textures |
| **Run trace** | The engine | The user | With the execution log | One turn | What was read, written, rolled and drawn |

Everything else in this document is about one of these five, plus the nodes that connect them.

## Part 1: Chat settings

### What the user sees

A workflow can declare **settings**: named knobs with a type and a default. Every chat using that
workflow shows them in a **chat settings panel**: sliders, toggles, dropdowns, text fields. The user
changes them whenever they like; the next turn uses the new values.

```yaml
# in the workflow record (edited from the workflow editor's settings tab)
settings:
  - key: volatility
    label: Volatility
    type: number
    default: 0.3
    min: 0
    max: 1
    step: 0.05
    description: How often fresh material is injected
  - key: maxLevel
    label: Max intensity
    type: enum
    options: [1, 2, 3, 4, 5]
    default: 2
  - key: authorsNote
    label: Author's note
    type: text
    multiline: true
    default: ''
```

- Types: `number` (with optional `min`/`max`/`step`), `boolean`, `enum` (declared options), `text`
  (optional `multiline`).
- Templates read them as `{{settings.<key>}}`. A **Chat Settings** node outputs them as typed ports, so
  they can feed a Condition, a Draw filter or a Trigger.
- Settings are never touched by deleting, editing or regenerating messages. Changing one is not a turn
  and adds no message.
- The values used by a turn are recorded in its execution log, so a later look at the trace shows the
  dial position at that moment.

### Rules

- **Stored on the session** as `settings: { [key]: value }`, additive with a default of `{}`. Values the
  user never set are not stored: the declared default applies, so changing a default in the workflow
  updates every chat that hasn't overridden it.
- **The workflow owns the declaration.** A session's values are matched by key:
  - A key the workflow no longer declares is kept in the session (unknown fields survive) but unused.
    Re-adding the key brings the value back.
  - A stored value that doesn't fit the declaration any more (wrong type, out of range, not in the
    options) is ignored in favour of the default, with a warning in the panel. It is never rewritten.
  - Switching a chat to another workflow keeps all values; the new workflow uses the keys it declares.
- **Validation:** keys must be valid template path segments and unique within the workflow.
  `{{settings.x}}` in a template is checked against the settings catalog (the union of keys declared by
  all workflows), so presets, which aren't tied to one workflow, get hints and a warning for a key no
  workflow declares.
- Preset preview renders defaults.

### Why the workflow, not the preset or the character

A preset is shared across workflows and chats, so a preset-level dial would apply everywhere. A
character is content, not configuration. The workflow is where the behaviour the dial controls is wired.

## Part 2: Story state

### State definitions

A **state definition** names what a chat remembers between turns, with a type per key. It is a record
(YAML under `data/state/definitions/`), so every workflow can use it and templates can be validated
against it.

```yaml
name: scene                     # {{state.scene.tension}}; immutable once data exists
description: Pacing state for the creativity pipeline
keys:
  tension:
    type: number
    default: 3
    min: 0
    max: 10
  lastInjectionLevel:
    type: number
  injected:
    type: collection
    cap: 30                     # keeps the 30 most recent items
    fields: { level: number, entryId: text }
  mood:
    type: enum
    options: [calm, uneasy, tense, release]
    default: calm
```

- Key types: `number` (optional `min`/`max`), `boolean`, `enum`, `text`, `object` (optional JSON
  schema), `collection` (items with `id`, `text` and declared `fields`, optional `cap`).
- **The name is immutable** once any chat has stored data for it. Templates bind to the name, and a
  rename would empty every template silently. "Duplicate as…" is the way to rename.
- **Editing a definition never rewrites stored data.** A value that no longer fits (removed key, changed
  type, out of the new bounds) reads as the default with a warning in the panel; restoring the key
  brings it back.
- The first version ships a seeded example definition (`scene`) and a raw YAML editor; a form editor
  comes later.

### Writing and reading

| Node | Config | Ports |
| --- | --- | --- |
| **State Write** | definition, key, operation | `value` input (typed from the key; not needed for `delete`); pass-through output |
| **State Read** | definition, key, what to read (`value`, `meta`, or for lists `linked`: intact linked items in chat order) | Typed output(s) |

Operations per type:

| Type | Operations |
| --- | --- |
| `number` | `set`, `increment` (by the input, default 1), clamped to `min`/`max` |
| `boolean`, `enum`, `text`, `object` | `set` |
| `collection` | `add` (item from the input: text, or an object with `text` and fields; an optional `messages` input links it to chat messages, Part 3), `remove` (by item id) |
| all | `delete` (back to the default) |

Meta, for every key:

| Meta field | Meaning |
| --- | --- |
| `written` | Whether any surviving turn wrote this key |
| `turnsSinceWrite` | Turns since the last surviving write. **Never written counts as written before the first turn**, so it equals the current turn number. A cooldown "at least 4 turns since the last injection" therefore fires on turn 4 of a fresh chat instead of never |
| `writtenAtTurn` | Turn number of the last surviving write, or empty |
| `count` | Collections only: items currently kept |

Templates read values directly: `{{state.scene.tension}}`, `{{#each state.scene.injected}}…{{/each}}`,
and `{{trigger.turn}}` gives the current turn number.

Within one turn:

- **Reads see the state as it was when the turn started.** Results never depend on which node finishes
  first. To use a value written earlier in the same turn, wire the State Write node's pass-through
  output.
- **Writes are held until the turn settles**, then stored with the replies in one save.
- **Several writes to the same key in one turn** are allowed and applied in a fixed order (the order
  nodes run in, then node id), and each is logged. `increment` is computed from the turn-start value
  plus every earlier increment of the same turn.
- **State Write always runs when its inputs are ready**, even if no reply depends on it. A write behind a
  Condition branch that isn't taken doesn't run.

### What happens when the chat is edited

> **What a turn stored lives as long as that turn's replies.**

- A turn is **in the chat** while any of its replies exists, including a reply stopped halfway. The user
  message doesn't count: deleting a reply to try again undoes its state even though the user message
  stays. A turn that produced no reply at all stays if it completed.
- **A value is what the most recent surviving turn wrote.** Deleting the last reply undoes everything
  its turn stored. Deleting a reply in the middle of the chat only changes a value if that turn was the
  latest to write it; later turns built on it, and their values stay. Exact replay would mean re-running
  every later turn, which this design deliberately doesn't do.
- **Collections** contain the items added by surviving turns minus the items removed by surviving turns,
  newest first, cut to `cap`. Deleting the turn that removed an item brings it back.
- **Turn numbers count surviving turns.** Deleting a turn shifts the numbers of later turns down, so
  "turns since" always matches what the user sees.
- **Multi-reply turns:** deleting one of several replies keeps the turn and its state. The delete
  confirmation of the **last** surviving reply of a turn lists what will be undone (below).
- **Editing a reply** never changes stored state. The reply and the state entries it produced get an
  "edited after it was stored" mark in the panel and on the message, so the user knows the state may
  describe text that is gone. Nothing is recomputed automatically.
- **A failed or stopped turn** keeps what its completed nodes stored, exactly as it keeps its completed
  replies. Deleting the partial reply undoes both.
- **Regenerate and swipes** (not built yet): each alternative reply belongs to its own turn and carries
  its own state; the visible alternative is the one that counts. Regenerating re-rolls every random
  choice by default. "Regenerate, keep the rolls" is a later option (the rolls are in the trace).

### Seeing it

- **Per-message chip:** a small marker on each reply whose turn stored, rolled or drew something.
  Opening it lists the turn's writes ("tension → 6, injected: *a bell on a lost animal* (level 2)"),
  rolls and draws.
- **Delete confirmation:** when deleting the last surviving reply of a turn that stored something, the
  dialog lists what will be undone. Values that won't change are not listed.
- **State panel** (next to the chat): the chat's current story state per definition, with the turn that
  wrote each value (click to jump to it), a sparkline for numbers over the last turns, item lists for
  collections with "N older items dropped by the cap", and warnings for values that don't fit their
  definition.
- **Execution log:** per node, what was read (and the value seen) and what was written.

Story state is read-only in the panel at first. Manual corrections come later (Part 7).

## Part 3: History summaries (message links)

### What the user gets

Long chats send the **most recent messages as they are** and **older history as summaries of chunks**.
The prompt always reflects the current chat: a summary is only used while the messages it covers are
exactly as they were when it was written.

```
[summary of messages 1–20] [summary of messages 21–40] [messages 41–58, raw]
```

### Message links

- Any **collection item** of story state may carry a link: `messages: { ids, fingerprint }`, the ids of
  the messages it is about and a hash of their content. Summaries are one use; facts extracted from a
  reply or a mood per message are others.
- A link's **status is computed on read**: `intact` (all there, unchanged), `changed` (one was edited),
  `partial` (some deleted), `gone` (all deleted). Nothing about it is stored.
- **Ids only**, never positions or turn counts: a turn can have several replies or none, and deleting a
  message shifts every position after it.
- Linked items follow the **story state lifetime rule unchanged** (Part 2): they live as long as the
  replies of the turn that wrote them. Deleting or regenerating that reply removes a summary; the next
  turn writes it again.
- **Checked at commit time:** when a turn's writes are stored, a linked item whose messages were edited or
  deleted while the run went on is dropped with a warning on the turn's chip.
- The chat shows a marker on messages that state links to, a note before editing or deleting one, and
  each linked item's range, status and a jump to its first message in the Story state panel.

### Chunks

- History is cut into **chunks** of a fixed number of messages (e.g. 20), over the messages that count as
  history (partial replies don't).
- A chunk is only summarized once it is **older than the raw window** (the last N messages, e.g. 16), so
  the messages the model sees verbatim are never also summarized.
- A summary that is not `intact` is ignored and its chunk is planned again over its surviving messages; a
  broken item that intact items already cover counts as **replaced** and needs no `remove`.

### Nodes (all generic)

| Node | What it does |
| --- | --- |
| **Next Chunk** | Over a collection key: re-plans the first broken, not replaced item, else finds the first `chunkSize` messages outside the raw window that no intact item links to. Outputs them (messages, text) and a `link`; outputs nothing otherwise, so the branch is skipped |
| **State Write** | `add` on a collection key takes a `messages` input (a link, a message or a list of messages): that is how a summary is stored |
| **Unlinked Messages** | Drops from a list of messages those that intact items of a key link to: "the history no summary stands for" |
| **Memory** | Plain recent history (last N, or all messages); it knows nothing about summaries |
| `linked` helper / State Read `linked` | The intact linked items of a key, in chat order, for a preset or a wire |

The user wires it like this (the "Rolling summaries" example pack):

```
Reply part:   Memory (all) → Unlinked Messages (memory.summaries) → LLM
              + preset entry: {{#each (linked state.memory.summaries)}}{{text}}{{/each}}
After reply:  After Reply → Next Chunk (memory.summaries) → LLM (summarize)
              → State Write (memory.summaries, add; messages ← Next Chunk's link)
```

One chunk per turn at most, so the cost per turn is bounded and a long imported chat catches up over a
few turns. Until it does, the prompt carries raw messages for the missing chunks. A `cap` on the key would
drop the oldest summaries, so summary keys have none.

### Later

- **Summaries of summaries:** a second key whose items link to the union of the messages of the level-1
  summaries they condense.
- **Token-based raw window and chunk size** (PLAN.md backlog: history trimmed to a token budget).
- A **detail-keeping** variant: ask the summarizer for names, objects and open threads alongside the gist,
  because summaries tend to drop exactly the specific details that keep prose fresh.

## Part 4: Authored collections (lorebooks and decks)

### What they are

An **authored collection** is a list of entries the user writes and edits by hand. Workflows only read
it. One record type serves two uses:

| | Lorebook use | Deck use |
| --- | --- | --- |
| How an entry is chosen | **Recall**: its keywords appear in the recent chat | **Draw**: a weighted random pick among entries that pass filters |
| Purpose | Consistency: what the model must know | Freshness: what the model wouldn't think of |

```yaml
name: Northern Wastes
description: World lore and textures for the campaign
entries:
  - title: The Salt Inn
    keywords: [salt inn, innkeeper, Borin]
    text: The Salt Inn sits where the old road meets the frozen river. Borin, its keeper, ...
  - text: the smell of resin after rain
    tags: [sensory, forest]
    level: 1
  - text: a boundary stone with a worn inscription
    tags: [object, history, forest]
    level: 2
    weight: 2
  - text: a bell on a lost animal, somewhere off the path
    tags: [sound, mystery]
    level: 2
```

Entry fields, all optional except `text`: `title`, `keywords`, `tags`, `level` (intensity 1–5, see
CREATIVITY.md §The dragon effect), `weight` (default 1), `enabled` (default true). Unknown fields are kept,
so imported formats round-trip.

Records live in `data/collections/<slug>.yaml`, stored and live-reloaded like presets (YAML, identity by
`id` in the file, invalid files skipped with a warning, hand edits picked up). Entry ids are derived on
read, as for preset entries; nothing relies on them surviving a save, except Draw's recent-draws list,
which stores the entry text's fingerprint as well (below).

### Nodes

**Recall** (relevance):

- Config: collection(s), how many recent messages to scan (default 4, plus the current user message),
  case sensitivity, whole-word matching, max entries, max characters.
- Matches an entry when any of its keywords appears in the scanned text. Entries without keywords never
  match (they are deck material).
- Outputs the matched entries as text (joined) and as a list, in collection order.
- Later: the SillyTavern World Info options that map cleanly (secondary keys, constant entries,
  probability, recursion), import of ST World Info JSON and of a card's embedded `character_book`.

**Draw** (chance):

- Config: collection(s), number of items, filters (tags required, tags excluded, `maxLevel`, `minLevel`),
  weights on or off, avoid recent draws (N turns).
- `maxLevel` and the filters can also come from inputs, so a chat setting (the intensity dial) or a
  Trigger output (Part 6) can drive them.
- Picks with weights among eligible entries using the turn's recorded random seed.
- **Avoid recent draws** is the one piece of bookkeeping a node keeps for itself. Draw stores each draw
  as story state of its own (an implicit per-node key, visible in the panel and on the message chip, and
  following the turn rule: delete the reply and the draw is "un-drawn"). This avoids eight nodes of
  wiring for the most common need. A workflow that wants different behaviour turns it off and wires State
  Read/Write itself.
- Outputs the entry (text, level, tags, title) and a **reason** ("drawn among 14 eligible: tag forest,
  level ≤ 2, 3 recent excluded"), recorded in the trace. When nothing is eligible, the output is empty
  and the downstream branch is skipped.

### Scope

Collections are global records referenced by node config, so several chats (a campaign) can already
share one world's lore and decks with no rewind question, because chats never write to them. Attaching
collections to a **chat** or a **character** (so a workflow reads "the chat's lorebook" instead of a
fixed id) comes later (Part 7).

### Integration with presets

Recall and Draw outputs reach the prompt through preset inputs, placed by the preset like any other
entry (including at depth). The wording is the user's: CREATIVITY.md's "offers, not commands" is a
preset pattern, for example:

```handlebars
{{#if input.seed}}
{{#if (eq input.seed.level 1)}}If it fits naturally, let this colour the scene: {{input.seed.text}}{{/if}}
{{#if (eq input.seed.level 2)}}Something true about this place: {{input.seed.text}}{{/if}}
{{/if}}
```

## Part 5: Engine and execution changes

### Sinks

Today only nodes that some Chat Output depends on run. That becomes **nodes that some sink depends on**,
with a `sink` flag on node definitions. Chat Output and State Write are sinks. Existing
workflows behave exactly as before; the seeded workflows keep validating. A workflow still needs at least
one Chat Output.

### Post-turn runs

A new **After Reply** node marks work that must not delay or endanger the reply.

- It has no inputs. Its outputs are the turn's settled replies (as messages and text) and the turn
  number.
- Sinks that depend on an After Reply node form the **post-turn part** of the workflow. Everything else
  is the **reply part**.
- The reply part runs as today. When the turn settles (replies saved, story state committed), the
  post-turn part runs as a **second run** in the same per-chat queue: the next message waits for it,
  and Stop stops it.
- It has its own execution log, linked to the turn. Its story-state writes belong to the same turn, so
  deleting the turn's replies undoes them too. Its failure never touches the reply: it is reported with
  a toast and in the panel ("summary failed on turn 41").
- Nodes needed by both parts (a Character node, say) run in both; they are cheap by nature.

### Random and determinism

- Every turn gets a **random seed**, recorded in the execution log. The Random node, Draw and Trigger
  derive their numbers from it and from their node id, so a turn's choices are reproducible from its
  trace, and "regenerate, keep the rolls" (later) is possible.

### New and changed nodes, summary

| Node | Category | Kind | Part |
| --- | --- | --- | --- |
| Parse JSON | Data | Transform | 5 |
| Random | Data | Transform (seeded) | 5 |
| Chat Settings | Chat | Source | 1 |
| State Read | State | Source | 2 |
| State Write | State | Sink | 2 |
| Recall | Collections | Source | 4 |
| Draw | Collections | Source (keeps its own recent-draws state) | 4 |
| After Reply | Chat | Source (post-turn) | 5 |
| Next Chunk | History | Source (over a collection key) | 3 |
| Unlinked Messages | History | Transform | 3 |
| Memory | Chat | Existing, gains "all messages" | 3 |
| Trigger | Creativity | Source (keeps its own timing state) | 6 |
| Pick Fields | Logic | Transform (keeps named fields of an object) | 7 |

**Parse JSON** turns an LLM's text answer into an object, list, number or boolean (tolerating code
fences and surrounding prose around one JSON value), optionally checked against a target key's type. A
failure is a node error with the raw text in the log. Port compatibility stays in `canConnect`, which
keeps refusing implicit text-to-number parsing.

**Random** rolls a number (0–1 or an integer range), picks from an input list (optionally weighted), or
flips a coin with a probability input. Outputs the result and the roll.

## Part 6: Trigger node

The creativity pipeline's first stage (CREATIVITY.md §1. Trigger) needs more than Random + Condition:
the editor has no arithmetic, so a probability that rises over time, a score from several signals and a
choice of intensity can't be wired by hand. The Trigger node does exactly that, and
nothing else.

- **Inputs:** any number of signal inputs (numbers 0–1, for example a stagnation score from an LLM
  classifier, or a tension gap), a volatility input (0–1, typically the chat setting), and a max level.
- **Config:**
  - a **hazard curve**: base probability, growth per turn since the last firing, reset on firing;
  - **signal weights**: how much each signal adds to the score;
  - **cooldowns per level** (at most one level-4 every N turns);
  - **level choice**: weights per level, capped by max level.
- **Score:** `clamp01((baseChance + growthPerTurn × turnsSinceLastFiring + Σ weight × signal) × (0.5 +
  volatility))`, one roll against it, then a weighted level pick among the levels within the max, off
  cooldown and weighted above 0. A signal whose source was skipped counts as 0.
- **Outputs:** `fire` (boolean), `level` (1–5), `true`/`false` branches, `score`, `roll`, and a **reason** ("score 0.42 = hazard 0.18 + stagnation
  0.24 × 1.0; roll 0.31 < 0.42; level 2 chosen, level 4 on cooldown").
- Like Draw, it keeps its own timing state (turn of last firing, per level) as implicit story state,
  visible in the panel and undone with the reply.
- It decides **whether** and **how strongly**; Draw or Recall decides **what**; the preset decides
  **how it is worded**. That is the gate → choose → shape structure the research recommends
  (03-drama-management.md).

## Part 7: Later

Not built. The current list, with sizes and the fixes found during the build, is
[state-impl/FOLLOW-UPS.md](state-impl/FOLLOW-UPS.md). In rough order of value:

1. **Manual corrections to story state** from the panel. A correction is stored as its own entry at the
   point in the chat where it was made, not attached to any reply, so deleting a reply never undoes it;
   later turns can still overwrite it.
2. **Collections attached to a chat or a character** ("this chat's world", "this character's lorebook"),
   read through Recall/Draw set to "attached collections". Import of SillyTavern World Info JSON and of a
   card's embedded `character_book`.
3. **Summaries of summaries** and a token-based raw window and chunk size (Part 3, Later).
4. **Shared writable state:** state definitions gain `partitionBy` (`character`, `character + persona`,
   or a named instance such as a campaign that chats join). A chat's writes to shared state stay
   pending in that chat (visible to it at once) and are published to the shared copy when sealed: when
   the user sends the next message, or right away with an explicit "lock in" action on the reply. After
   that, undoing is a deliberate action in the panel, never a side effect of editing one chat. Shared
   keys allow only operations that combine cleanly (`add`, `remove`, unbounded `increment`, `set` with
   last-writer-wins). Open product question: when a chat is deleted, does the character forget what
   that chat taught her?
5. **Per-character state inside one chat** (group chats: a relationship meter per NPC):
   `partitionBy: [character]` within the session, keyed by the character connected to the node.
6. **Search over collections:** keyword (BM25) first, semantic (embeddings, similarity band) only when
   there's evidence it beats a good prompt.
7. **Regenerate and swipes**, with "keep the rolls".
8. **Discarding a linked item** from the panel (with manual corrections), and **per-message extraction
   recipes** (facts, moods, open threads) now that items can link to messages.
9. **Form editors** where YAML is still the main path (advanced collection fields, object keys' schema).

## Walkthroughs

### Fresh texture with a cooldown

1. Chat settings: `volatility` (0.3) and `maxLevel` (2).
2. An LLM node rates "calmer, same or tenser than the last turn?" (a relative question: absolute 0–10
   ratings cluster) → Parse JSON → State Write `scene.mood` (`set`).
3. **Trigger** with volatility from Chat Settings, a signal from a small "is the scene stagnating?"
   classifier, a cooldown of 3 turns for level 2.
4. On `fire`: **Draw** from "Northern Wastes" with `maxLevel` from the Trigger's `level`, tag filter
   from the scene, avoid recent draws on.
5. The preset words the drawn entry by level and places it at depth 2.

Nodes: Chat Settings, LLM (rating), Parse JSON, State Write, LLM (classifier), Trigger, Draw, plus the
usual LLM and Chat Output. Delete the reply and the draw, the cooldown and the mood all go back.

The seeded "Fresh texture (example)" is a smaller version without the rating and the classifier: Chat
Settings → Trigger → Draw → (Pick Fields → State Write `scene.injected`) and a preset that words Draw's
`text` by its `level`.

### Rolling summaries

1. A state definition `memory` with a list key `summaries` (no cap).
2. Reply part: Memory (all messages) → Unlinked Messages (`memory.summaries`) → the LLM's history input,
   and a preset entry `{{#each (linked state.memory.summaries)}}{{text}}{{/each}}`.
3. After reply: After Reply → Next Chunk (`memory.summaries`, chunk size 20, raw window 16) → LLM (the
   user's summary preset, asking for gist plus names and open threads) → State Write (`memory.summaries`,
   `add`, `messages` from Next Chunk's `link`).

The reply never waits for a summary, a failed summary never costs a reply, and editing an old message
makes its chunk fall back to raw text until it is summarized again. This is the seeded "Rolling summaries
(example)".

### Author's note

A `text` chat setting `authorsNote`, and a preset entry at depth 3 rendering
`{{#if settings.authorsNote}}[Author's note: {{settings.authorsNote}}]{{/if}}`. No state involved.

### World lore across a campaign

Three chats use workflows whose Recall node reads "Northern Wastes". The user adds an entry about a
place invented in one chat; every chat recalls it from the next turn on. Nothing is written by the
chats themselves until shared writable state exists (Part 7.4).

## Data and storage

All additive and backward compatible (AGENTS.md "Data compatibility"):

| Data | Where | Shape |
| --- | --- | --- |
| Chat settings declarations | Workflow record | `settings: SettingDef[]`, default `[]` |
| Chat settings values | Session record | `settings: Record<string, unknown>`, default `{}` |
| State definitions | `data/state/definitions/<slug>.yaml` | YAML records, `YamlRepository` |
| Story state | Session record | `state: { turns: TurnEntry[] }`, default empty. `TurnEntry = { executionId, at, completed, replies, writes, postExecutionId?, postStatus?, postError?, linkWarnings? }` (the seed is in the execution log); scalar writes store the value **after** the write, collections store `add`/`remove` with item ids |
| Summaries and other linked items | Story state | Collection items with `messages: { ids, fingerprint }`; link status is computed, never stored |
| Example seeds ledger | `data/.seeded.json` | `<pack>/<kind>:<id>` lines: examples already created once, so a deleted one is not recreated |
| Authored collections | `data/collections/<slug>.yaml` | YAML records, `YamlRepository`, live reload |
| Execution traces | Execution log | Per node: `stateReads`, `stateWrites`, `roll`, `draw`, `reason`; per run: `seed`, `settings` |

- The current story state is a **pure function** in `shared`: definitions + turn entries + the set of
  surviving turns → values and meta. Link status is another pure function: a link + the current
  messages → intact, changed, partial or gone.
- Story state and the replies are committed in the **same session write** (`settleTurn`; the after-reply
  part's writes in `settlePostRun`): no second file, no recovery step. Linked writes are checked against
  the messages in that same write.
- Session files are rewritten while a reply streams; caps on collections keep the state part small. If
  sessions grow too large, story state can move to a sidecar file with the session write
  still as the commit point.
- Change events: `stateDefinitions.changed` and `collections.changed` (file-backed, like presets and
  providers); session changes keep using `sessions.changed`.

## API (contract first)

- State definitions: list, get, create, update, delete (`409` on renaming a definition with data, or
  deleting one that chats use, with the list of chats).
- Collections: list, get, create, update, delete (`409 COLLECTION_IN_USE` while a Recall or Draw node uses
  one).
- Workflow `settings` travel in the workflow record (no new endpoint).
- Chat settings values: `PATCH /api/sessions/:id` gains `settings` (a partial map; `null` resets a key to
  its default). It is a metadata patch: it doesn't advance `updatedAt`.
- Story state and settings are stored in the session (`GET /api/sessions/:id` returns them raw). The chat
  reads a computed view from `GET /api/sessions/:id/state` (values and meta per key, history for
  sparklines, per-turn writes and after-reply status, link status and positions of linked items), so the
  web app never reimplements the fold or the link rules.

## Templates

New namespaces, all driven by catalogs (never hand-written lists):

| Namespace | Source of truth | Example |
| --- | --- | --- |
| `settings.<key>` | Settings declared by workflows | `{{settings.authorsNote}}` |
| `state.<definition>.<key>` | State definitions | `{{state.scene.tension}}` |
| `trigger.turn` | Engine | `{{trigger.turn}}` |
| helper `linked` | Message links (Part 3) | `{{#each (linked state.memory.summaries)}}{{text}}{{/each}}` |

Unknown paths keep the existing behaviour: they render empty, with a warning in preset validation.

## Phases (all built)

1. **Engine foundations:** Parse JSON, per-run seed, Random, sinks.
2. **Chat settings:** declarations and editor tab, session values and `PATCH`, Chat Settings node,
   `{{settings.*}}`, chat panel.
3. **Authored collections:** schema, repository, watcher, API, editor; Recall and Draw.
4. **Story state** (4a backend, 4b web): definitions and their editor, the fold, State Read/Write,
   `{{state.*}}`, Draw's avoid-recent, panel, chips, delete confirmation.
5. **Post-turn runs:** After Reply, the post part in the chat's queue slot, its log, failure reporting.
6. **History summaries**, first as a separate store, then (6b) as message links on story state (Part 3).
7. **Trigger**, Pick Fields, the example packs and the user guide.

Each phase updated README (technical), AGENTS.md (contracts) and `docs/TEMPLATING.md`; details per phase
are in [state-impl/HANDOFF.md](state-impl/HANDOFF.md).

## Open questions

Settled by the build: the UI says "Chat settings", "Story state" and "Collections"; Draw and Trigger keep
their own state as implicit per-node keys (visible in the panel and undone with the reply); chunks are
counted in messages (tokens are a follow-up). Still open:

1. **Edited replies:** is the "edited after it was stored" mark enough, or should a workflow be able to
   react to it (for example, re-rate tension on the next turn)?
2. **Collections attached to characters:** should importing a card with an embedded lorebook create a
   collection automatically, or only on request?
