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
| A4 | **A link's status is computed on read** from the current messages (intact, changed, partly deleted, gone). Readers decide what to do with a broken link: only intact summaries are used, and Next Chunk re-plans broken ones (the phase 6 fallback) |
| A5 | **Message ids are the only way to say which messages.** Never positions, never turn counts: a turn can have several replies or none, empty sends add no user message, and deleting a message shifts every position after it |
| A6 | Editing or deleting far-back messages is **not a flow to polish**. It must stay correct (never send a summary of text that is gone), and the chat must show which messages state depends on, but there is no re-summarize button or link editor |
| A7 | **No summary-specific nodes.** Next Chunk finds messages a key doesn't cover yet, whatever the items are. Save Summary is dropped: State Write's `add` takes the link. Memory goes back to plain recent history (phase 6's `summarySet` is removed); a separate **Unlinked Messages** node drops the messages that intact items of a key already stand for |

Proposal 3's D3 ("summaries are tied to the messages they cover, not to the turn that wrote them")
becomes: summaries are **validated** by the messages they cover, and **live** with the turn that wrote
them.

## Why the separate store was dropped

Phase 6 stored summaries outside story state because their lifetime looked different: proposal 3 wanted
a summary to survive the deletion of the turn that wrote it. Trying it showed the cost of that split:
three stores (history, story state, summaries) with their own nodes, no way to read summaries with State
Read or templates, and the Memory node coupled to a store the rest of the state system knows nothing
about. The rework keeps every node generic: what makes a key "summaries" is only how the user wires it.

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

- **State Write `add` on a collection key gains an optional `messages` input.** It takes a link
  (`{ ids, fingerprint? }`, e.g. Next Chunk's `link`), a message, or a list of messages (their ids are
  taken, e.g. After Reply's `replies`). The stored item is the `value` plus that link. The input is
  `requiredIfConnected`: a skipped source skips the write. Other operations and key types don't show it.
  A `value` object's own `messages` key is ignored like any undeclared field: links only come through
  the input, so a write never links by accident.
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
status as a read-only `link` property on each item of the turn-start snapshot (`{ status, ids }`). The
stored item never holds a status.

### Reading linked items in chat order

Collection items are kept newest first (by the turn that added them). For linked items that is the wrong
order: a re-planned summary of messages 21–40 is written after the summary of 41–60. Two generic readers
give **intact linked items in chat order** (by their first linked message):

- a template helper, `{{#each (linked state.memory.summaries)}}{{text}}{{/each}}`, listed with the other
  helpers in shared (so hints and validation know it);
- a State Read option (read mode) with the same result, for wiring.

### What the chat shows (A6)

- A message that state items link to shows a small marker; hovering or tapping lists the items ("summary
  of messages 1–20", "fact: the stranger's name") and links to them in the panel.
- Editing or deleting a linked message says so before saving ("1 summary covers this message; it will
  stop being used until it's summarized again"). It is information, not a confirmation step for edits;
  deletes already have one.
- In the Story state panel, linked items show their range ("messages 21–40 (20)"), their status and a
  jump to the first linked message (phase 6's Summaries section, generalized to every collection).
  Broken items that an intact item has replaced (see Next Chunk) are collapsed under "replaced".

## Nodes

| Node | Role |
| --- | --- |
| **Next Chunk** (kept, generalized) | Targets a collection key (definition + key picker, like State Read). Over the messages outside the last `rawWindow`: the first item of the key whose link is not intact **and not replaced** is re-planned over its surviving messages; else the first `chunkSize` messages in a row that no intact item links to; else nothing (all outputs empty, downstream skipped). An item is **replaced** when intact items of the key link every one of its surviving messages, so a re-summarized chunk needs no `remove`. Outputs `messages`, `text` (transcript), `link` (`{ ids, fingerprint }`, for State Write's `messages` input) and `replaces` (the broken item's id, optional, for users who want to wire a `remove`). Nothing in it is about summaries: it finds messages a key doesn't cover yet |
| **State Write** (gains an input) | `messages` on `add` to a collection key, see "Writing a link" |
| **Unlinked Messages** (new, category History) | Input `messages` (messages, required); config a collection key. Outputs the input messages minus those that **intact** items of the key link to, in their order (`messages`), and as a transcript (`text`). Broken items hide nothing, so their messages stay raw |
| **Memory** (restored) | Back to its pre-phase-6 behaviour: the last N messages, text or messages. `summarySet` is removed |
| **Save Summary** | Dropped (A7) |
| **State Read** | Gains the "linked items in chat order" read mode |

## Summaries, wired

The user declares a collection key, for example definition `memory`, key `summaries`, **without a
`cap`** (a cap drops the oldest summaries, and their messages then reach the prompt raw again; the
definitions editor warns about a cap on a key a Next Chunk node targets). Several summary sets are
several keys. Phase 7 decides how a `memory` definition is seeded (with `scene`).

```
Reply part:
  Memory (all messages) → Unlinked Messages (memory.summaries) → LLM input "recent"      (B)
  preset entry: {{#each (linked state.memory.summaries)}}{{text}}{{/each}}               (A)

After-reply part:
  After Reply → Next Chunk (memory.summaries, chunk 20, raw window 16) ─text→ LLM (summarize)
                     │                                                          │ text
                     └─────────────── link ──────────────→ State Write (memory.summaries, add)
                                                              value ←──────────┘
```

- **B** gets every message no intact summary stands for: the raw window, the messages that don't fill a
  chunk yet, and the messages of broken summaries. Memory is set to all messages (a Last N
  would cut messages that no summary covers yet).
- **A** gets the intact summaries in chat order.
- Ordering caveat (accepted): with A and B as separate inputs, a broken summary in the middle puts its
  raw messages (in B) after later summaries (in A) until the next turn re-summarizes it.
- The raw window guarantees that summaries never cover the newest messages when they are written.

### Edge cases under the turn rule

| User does | Result |
| --- | --- |
| Edits message 5 | The summary of 1–20 is `changed`: A drops it, B shows 1–20 raw, and Next Chunk re-plans it after the next reply. The new summary replaces the old one (no `remove` needed) |
| Deletes the turn that wrote the replacing summary | The old (broken) item is no longer replaced: Next Chunk re-plans it again |
| Deletes a turn in the middle that wrote a summary | That summary is gone; its messages are unlinked, so B shows them and Next Chunk summarizes them again |
| Regenerates the latest reply, which wrote a summary | The regenerated turn's post run summarizes the chunk again |
| Edits message 5, then reverts the edit | The old summary's link is intact again; if a replacement exists too, both are intact and the first in chat order is used by `linked` (the other is collapsed as a duplicate in the panel) |

## What changes in the code (phase 6b)

Phase 6 is on the working branch only, never on `main`, so the rework needs no data migration:
`session.summaries` is no longer read (a test chat's phase 6 summaries are ignored and re-summarized).

- **Shared:** the item link schema and `linkStatus`; the "replaced" and "chat order" rules; the
  generalized commit-time link check (from `commitSummaryWrites`), run on a turn's state writes before
  `settleTurn` and `settlePostRun` store them; `linkWarnings`; the `linked` template helper. The
  fingerprint and `planNextChunk` stay (reading items instead of `Summary` records). `composeHistory`,
  `session.summaries`, `readSummaries`, the summary view and `summaryWarnings` go.
- **Engine:** the snapshot items carry `link`; State Write's `messages` input; Next Chunk retargeted to
  a key; the new Unlinked Messages node; State Read's linked read mode; Memory restored; Save Summary and
  `SummaryRun` removed.
- **Server:** the link check in `settleTurn`/`settlePostRun`; the state view adds `link` (status, range,
  first and last message, replaced) to items that have one; `summaries` leaves the view contract.
- **Web:** linked items in the Story state section (range, status, jump, markdown text, replaced ones
  collapsed); the message marker and the edit/delete note; the Summaries section is folded into the
  collection view.

## Later (adds to proposal 3, Part 7)

- **Summaries of summaries:** a second key whose items link to the union of the messages of the
  level-1 summaries they condense; Next Chunk over level-1 items instead of messages.
- **Manual corrections** (Part 7.1) can discard a linked item from the panel, which then gets
  re-planned.
- **Per-message extraction recipes** (facts, moods, threads) as walkthroughs once the guide exists.
- **Token-based raw window and chunk size** (proposal 3 open question 3) still apply.

## Open questions

1. ~~Memory has no "all messages" setting.~~ Decided: Memory gains an explicit "all messages" setting
   (additive; `lastN: 0` keeps meaning none).
2. ~~Full text of linked items in the state view?~~ Decided: linked items' text is sent whole (the view
   cuts other long values to 200 characters); a fetch-on-expand only if the view gets heavy.
