# Message links — agent notes

Any collection item may link to chat messages; a summary is just an item of a collection key whose items link to the messages they cover. There is no summary store, node or session field. The fold doesn't know about links: linked items live and die with the turn that wrote them, like every item. Design: `docs/dev/explorations/STATE-DESIGN-AMENDMENT-1.md`.

## Shape
- The built-in optional `messages: { ids, fingerprint }` of `collectionItemSchema` (`itemLinkSchema`). `fingerprint` is absent only between a run and the commit check. A bad stored value reads as no link and never loses the item.
- It is not a declared field. The definitions WRITE schema refuses new fields called `messages` or `link` (`RESERVED_ITEM_FIELDS`), but stored definitions that declare them stay valid: `collectionItem` never copies a value's own `messages`, so an existing declared field called `link` keeps its values (never drop data the user declared).
- **Ids only, never positions or turn counts:** deleting a message shifts every position after it.
- A stored item never has a `link`. A run's snapshot (`stateSnapshot(story, definitions, history)`) gives linked items a read-only `link: { status, ids, first? }`. Nodes and the server judge with the SAME history (`ctx.history`; the after section keeps the reply section's), so a node's status and a template's never disagree.

## Status is computed on read, never stored
- `linkStatus(link, indexById(history))` gives `intact | changed | partial | gone`.
- `analyzeLinks(items, history)` is the one function behind the planner, Unlinked Messages and the state view (status, surviving ids, 1-based positions, `replaced`, `repeated`).
- **Replaced:** a non-intact item whose surviving messages are all linked by intact items of the same key. A `gone` item is never replaced.
- **Chat order:** `chatOrder` is the one rule (by first position, newest first on ties, same-`ids` repeats after the first dropped). `linkedInChatOrder` applies it for the `linked` helper and State Read's `linked` read; `analyzeLinks` marks `repeated` with it.

## Commit-time check
`commitItemLinks` (pure; the server calls it inside the settle update, against the history as it is THEN):
- An `add` whose linked id is not among the history messages, or whose present `fingerprint` no longer matches, is dropped with a plain-language warning naming the key. A missing fingerprint is computed and stored.
- Warnings go to the turn entry's `linkWarnings` (capped by `LINK_WARNING_LIMITS`; later runs append theirs) and to the run's execution log.
- Completed nodes' linked writes of a failed or stopped run still go through the check. No pairing with `remove` writes.

## Previews
`previewWrite` never cuts an item that has a link (summary text and ids are sent whole); other items keep the 200-character cut. One-line previews, delete-dialog lines and the warnings' excerpts all use `plainPreview`.
