# State and creativity: follow-up plan

Written after phase 7 (October 2026), when the plan in
[STATE-DESIGN-PROPOSAL-3.md](../STATE-DESIGN-PROPOSAL-3.md) and
[STATE-DESIGN-AMENDMENT-1.md](../STATE-DESIGN-AMENDMENT-1.md) was fully built (phases 1–7, see
[HANDOFF.md](HANDOFF.md)). Nothing here is scheduled: the user decided (2026-10-19) to try the build first
and pick from this list afterwards. Each item says what it is, why it matters, and a rough size
(S: a few commits, M: a phase with UI, L: several phases).

## A. Fixes to existing behaviour (found during phases 5–7, deferred by the user)

| # | Item | Why | Size |
| --- | --- | --- | --- |
| A1 | **Validate saves an invalid draft.** The workflow editor's Validate saves before validating, so an invalid workflow is stored and the chat then fails with "Workflow is invalid". Validate should check the draft without saving (or refuse to save an invalid one with a plain message). | It can leave a chat unusable after a harmless click | S |
| A2 | **"Preset (none) not found" toast** when a fresh LLM node is dropped on the canvas: a not-set-up node should show the panel hint, not an error toast (the `unsetSettings` rule other nodes follow). | Noise on the most common node | S |
| A3 | **Post-run failure text names the node by its UUID** (`failureMessage` in `apps/server/src/services/failure.ts`); AGENTS.md wants `nodeDisplayName` (`Label #k (type)`). Both runners share the text, so the byte-for-byte reply tests change with it. | Readable errors | S |
| A4 | **A failed after-reply run stays listed** in the panel's Story state section after a later turn succeeded (e.g. the chunk was summarized next turn). List only failures whose work has not been redone, or mark them "later turns ran fine". | Stale alarms | S |
| A5 | **`packages/engine/src/executor.ts` is ~390 lines**, over the ~250-line guideline (it grew with state, links and post parts). Split by concern without behaviour change. | Maintainability | S |

## B. Small features asked about

| # | Item | Notes | Size |
| --- | --- | --- | --- |
| B1 | **Retry a failed after-reply run** (user: later). A "Retry" action on the turn's chip that runs the post part again for that turn, in the chat's queue slot, with a fresh derived seed (`${seed}:post:2`), committing like a normal post run. One-off work (facts extracted from a reply) is otherwise lost on failure; summaries already self-heal. | Needs: the turn's after-reply payload rebuilt from stored replies; the history as the reply run had it | M |
| B2 | **A message waiting behind an after-reply run gets no response bytes** until the run ends. Send an early "queued" SSE frame so the client can show it, or start streaming the user message at once. | UX of long summaries | S |
| B3 | **Nodes needed by both parts run twice** (an LLM shared by the reply and the after-reply part costs two calls). Option: let the post part reuse completed reply-part outputs of the same turn. | Cost; today the docs say "feed after-reply work from After Reply's outputs" | M |

## C. Proposal 3, Part 7 and amendment 1 "Later" (in proposal 3's order of value)

| # | Item | Notes | Size |
| --- | --- | --- | --- |
| C1 | **Manual corrections to story state** from the panel, stored as their own entry at that point of the chat (never undone by deleting a reply), including **discarding a linked item** (a summary to redo). | The most requested gap once state is used daily | M |
| C2 | **Collections attached to a chat or a character**, read by Recall/Draw set to "attached"; import of SillyTavern World Info JSON and a card's embedded `character_book`. | Lorebooks as users know them | L |
| C3 | **Summaries of summaries** (a second key whose items link to the union of their level-1 items' messages; Next Chunk over items) and a **token-based raw window / chunk size**. | Very long chats | M |
| C4 | **Shared writable state** (`partitionBy` character / persona / campaign; outbox semantics; "lock in"). Open product question: does a character forget what a deleted chat taught her? | Cross-chat memory | L |
| C5 | **Per-character state inside one chat** (group chats). | Builds on C4's partition idea | M |
| C6 | **Search over collections**: keyword (BM25) first, embeddings only with evidence. | Recall quality | M |
| C7 | **Regenerate and swipes**, with "keep the rolls". Each alternative is its own turn with its own state; summaries already redo themselves after a regenerate. | Core chat feature | L |
| C8 | **Per-message extraction recipes** (facts, moods, open threads) as guide walkthroughs and maybe example packs, now that items can link to messages. | Shows off message links | S |
| C9 | **Form editors** where YAML is still the main path (collections' advanced fields, object keys' schema). | Polish | M |

## D. Known limitations that are design choices (no action unless the user asks)

- Deleting or regenerating the turn that wrote a summary removes it; the next turn redoes it (one extra
  LLM call). Accepted in amendment 1.
- A and B inputs of the summary recipe can be out of chat order while a summary is broken (until the next
  turn). Accepted.
- Linked items' text is sent whole in the state view (local app; revisit with fetch-on-expand if heavy).
- The cap note in the definitions editor can't check which workflows use a key.
- Chunks are counted in messages, not tokens (see C3).
- Template macros inside collection entry text are not rendered.

## Suggested order if all of it were wanted

A1–A4 (one small fix phase), then C1 and C7 (the two features users hit first), then B1, then C3, C2,
and the cross-chat work (C4, C5) last since it needs product decisions.
