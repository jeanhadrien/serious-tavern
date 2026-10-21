# State definitions editor — agent notes

- The draft holds every value as text and keeps, per key, the properties it doesn't edit (`KeyDraft.rest`: unknown ones, an object key's `schema`), because a PUT replaces `keys` wholesale.
- Rows are keyed by a local `uid` that never counts for dirty (`draftKey`).
- `compile` is the ONLY draft-to-body path, and it doubles as the live validation (its own checks plus the shared `stateDefinitionWriteSchema`). Never validate separately.
- The key `description` is a plain field (not in `rest`): the generated tools show it to the model.
- **The name lock is reactive:** the server's `409 STATE_DEFINITION_IN_USE` on a rename makes the name read-only until the definition is opened afresh (an already open one stays locked), with "Duplicate as" and "Keep the current name". There is no up-front "has data" signal. The server's answers about the name are the pure `NameState`.
- The name check is the shared `definitionNameProblem`, used by `compile` and by Duplicate.
- Disk sync goes through `useFileSync` with `classifyDefinitionChange` (see `apps/web/AGENTS.md`).
