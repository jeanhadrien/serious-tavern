# State design, amendment 1: message links, and summaries as story state

October 2026, after phase 6. It amends [STATE-DESIGN-PROPOSAL-3.md](STATE-DESIGN-PROPOSAL-3.md) and
replaces its Part 3 storage model. It records a design discussion with the user after trying the phase 6
build; the reasoning is kept because the first design (a separate summary store) was a reasonable answer
to a slightly wrong question.

## The decision

| # | Decision |
| --- | --- |
| A1 | **Any collection item may link to chat messages.** A link records which messages the item is about and a fingerprint of their content. Summaries are one use; users can think of more (facts extracted from a message, a mood per reply, an open thread and where it started) |
| A2 | **Summaries are ordinary story state:** items of a collection key whose items link to the messages they cover. There is no separate summary store; `session.summaries` (phase 6) goes away |
| A3 | Linked items follow **the story state lifetime rule unchanged**: they live as long as the replies of the turn that wrote them. The fold does not change |
| A4 | **A link's status is computed on read** from the current messages (intact, changed, partly deleted, gone). Readers decide what to do with a broken link; Memory and Next Chunk ignore and re-plan broken summaries (the phase 6 fallback) |
| A5 | **Message ids are the only way to say which messages.** Never positions, never turn counts: a turn can have several replies or none, empty sends add no user message, and deleting a message shifts every position after it |
| A6 | Editing or deleting far-back messages is **not a flow to polish**. It must stay correct (never send a summary of text that is gone), and the chat must show which messages state depends on, but there is no re-summarize button or link editor |

Proposal 3's D3 ("summaries are tied to the messages they cover, not to the turn that wrote them")
becomes: summaries are **validated** by the messages they cover, and **live** with the turn that wrote
them.

## Why the separate store was dropped

Phase 6 stored summaries outside story state because their lifetime looked different: proposal 3 wanted
a summary to survive the deletion of the turn that wrote it. Trying it showed the cost of that split:
three stores (history, story state, summaries) with their own nodes, no way to read summaries with State
Read or templates, and the Memory node coupled to a store the rest of the state system knows nothing
about.

Under the story state rule instead:

- **Edits and deletes after a chunk** don't touch its summary (its turn's replies are untouched).
- **Edits and deletes inside a chunk** are caught by the fingerprint, not by the lifetime rule: the link
  breaks, readers ignore the summary and Next Chunk re-plans it.
- **Deleting or regenerating the turn that wrote a summary** removes it. Because a chunk is summarized
  only once it is older than the raw window, the writing turn is a recent one (messages 1–20 are
  summarized around message 36), and regenerating the latest reply is the most common edit. This is the
  one real cost, and it heals itself: the regenerated turn's after-reply run finds the chunk uncovered
  and summarizes it again (one extra LLM call). In exchange the delete confirmation lists "summary of
  messages 1–20" among what a delete undoes, for free.

## Message links

### Shape

A collection item gains one optional built-in property next to `id` and `text`:

```
{ id, text, ...declared fields, messages?: { ids: string[], fingerprint: string } }
```

- `ids` are message ids, in chat order. `fingerprint` is `fingerprintMessages` (phase 6: a stable hash of
  each covered message's id, role, name and content, in order).
- It is not a declared field: every collection accepts it, nothing declares it. The definition's
  `fields` stay text/number/boolean.
- Stored like any item: in the `add` write of the turn's entry. Old items have no `messages`; nothing is
  migrated.

### Writing a link

- `add` accepts an item with `messages: { ids, fingerprint? }` (from State Write's `value`, or from a
  node such as Save Summary).
- **The fingerprint is checked or taken at commit time**, inside the settle update that stores the
  turn's writes (`settleTurn` for the reply part, `settlePostRun` for the after-reply part), against the
  chat as it is then:
  - with a `fingerprint` (Next Chunk provides one, taken when it planned the chunk): if the messages no
    longer match, the write is **dropped** with a warning (the chat changed while the summary was being
    written; phase 6's commit check, generalized);
  - without one: the commit computes it from the current messages, so a node can link an item to "this
    reply" by id alone (After Reply's `replies` carry the ids; the turn's own messages are saved by
    then);
  - an id that is not a history message at commit time drops the write with a warning.
- Dropped writes are listed on the turn's entry (`linkWarnings`, capped, replacing phase 6's
  `summaryWarnings`) and shown on the turn's chip, as in phase 6.

### Link status (pure, in shared, computed on read)

| Status | Meaning |
| --- | --- |
| `intact` | every linked message exists and the fingerprint matches |
| `changed` | every linked message exists, but at least one was edited |
| `partial` | some linked messages were deleted (and the rest may be edited) |
| `gone` | every linked message was deleted |

The state view, the turn snapshot and the panel all use the same function. Nodes and templates see the
status as a read-only `link` property on each item of the turn-start snapshot
(`{ status, ids }`), so a preset can write `{{#each state.memory.summaries}}{{#if (eq link.status
"intact")}}…{{/if}}{{/each}}`. The stored item never holds a status.

### What the chat shows (A6)

- A message that state items link to shows a small marker; hovering or tapping lists the items ("summary
  of messages 1–20", "fact: the stranger's name") and links to them in the panel.
- Editing or deleting a linked message says so before saving ("1 summary covers this message; it will
  stop being used until it's summarized again"). It is information, not a confirmation step for edits;
  deletes already have one.
- In the Story state panel, linked items show their range ("messages 21–40 (20)"), their status and a
  jump to the first linked message (phase 6's Summaries section, generalized to every collection).

## Summaries as story state

### Setup

The user declares a collection key, for example definition `memory`, key `summaries`, **without a
`cap`** (a cap drops the oldest summaries, and Memory then sends those messages raw; the definitions
editor warns about a cap on a key used by Next Chunk). A key replaces phase 6's "set" name, so several
summary sets are several keys. Phase 7 decides how a `memory` definition is seeded (with `scene`).

### Nodes

| Node | Change from phase 6 |
| --- | --- |
| **Next Chunk** | Targets a collection key (definition + key picker, like State Read) instead of a set name. Same planning (`planNextChunk`) over that key's items that have links: the first item whose link is not intact is re-planned over its surviving messages, else the next `chunkSize` unlinked messages outside the raw window. Outputs `messages`, `text` and `chunk` (`{ ids, fingerprint, replaces? }`, `replaces` = the item id to remove) |
| **Save Summary** | Kept as a convenience sink. Targets the same kind of key; writes `add { text, messages: { ids, fingerprint } }` and, with `replaces`, a `remove` of that item, through `ctx.writeState` (so the buffering, the post-part repeated-node rule and undo are the state ones). The phase 6 `SummaryRun`, `ctx.summaries` and `ctx.writeSummary` go away |
| **Memory** | `summarySet` becomes a key (definition + key). The `history` output is unchanged (summaries for older linked runs + raw for the rest + the last N raw). New outputs, from the same `composeHistory`: `summaries` (only the summaries used, in order), `recent` (the last N raw messages) and `unsummarized` (older messages no intact summary covers). So a workflow can feed summaries and recent messages into different LLM inputs |
| **State Read** | Unchanged; on such a key it outputs the items, links and statuses included |

### Rules carried over from phase 6

- A summary is used only when its link is intact and all its messages lie before Memory's raw part (a
  straddling one stays raw: no message twice, the raw part never shrinks).
- Two intact summaries covering the same messages (possible after deleting a replacing turn when the
  edit was reverted): the first in chat order wins, the other is unused.
- One chunk per run; Next Chunk outputs nothing until a full chunk exists, so "summarize every n
  messages" needs no turn counting.

### Edge cases under the turn rule

| User does | Result |
| --- | --- |
| Deletes the turn that replaced a summary | Its `add` and `remove` are both undone: the old (broken) item comes back and is ignored and re-planned |
| Deletes a turn in the middle that wrote a summary | That summary is gone; Next Chunk re-plans the chunk on the next turn |
| Regenerates the latest reply, which wrote a summary | The regenerated turn's post run summarizes the chunk again |
| Edits message 5, then reverts the edit | The summary's link is intact again and it is used again |

## What changes in the code (phase 6b)

Phase 6 is on the working branch only, never on `main`, so the rework needs no data migration:
`session.summaries` is no longer read (a test chat's phase 6 summaries are ignored and re-summarized).

- **Shared:** the item link schema and `linkStatus`; `collectionItem` accepts `messages`; the generalized
  commit-time link check (from `commitSummaryWrites`), run on a turn's state writes before `settleTurn`
  and `settlePostRun` store them; `linkWarnings`. The fingerprint, `planNextChunk` and `composeHistory` stay,
  reading items instead of `Summary` records. `session.summaries`, `readSummaries`, the summary view and
  `summaryWarnings` go.
- **Engine:** the snapshot items carry `link`; Next Chunk, Save Summary and Memory retargeted to keys;
  `SummaryRun` removed.
- **Server:** the link check in `settleTurn`/`settlePostRun`; the state view adds `link` (status, range,
  first and last message) to items that have one; `summaries` leaves the view contract.
- **Web:** linked items in the Story state section (range, status, jump, markdown text); the message
  marker and the edit/delete note; the Summaries section is folded into the collection view.

## Later (adds to proposal 3, Part 7)

- **Summaries of summaries:** a second key whose items link to the union of the messages of the
  level-1 summaries they condense; the same planner over level-1 items.
- **Manual corrections** (Part 7.1) can discard a linked item from the panel, which then gets
  re-planned.
- **Per-message extraction recipes** (facts, moods, threads) as walkthroughs once the guide exists.
- **Token-based raw window and chunk size** (proposal 3 open question 3) still apply.

## Open questions

1. Should Memory's combined `history` output stay once the split outputs exist, or be dropped? (Kept for
   now: existing workflows use it.)
2. Should the state view send the full text of linked items (summaries can be long, and the view cuts
   write values with `previewWrite`), or should the panel fetch an item on expand? Decide when planning
   phase 6b.
