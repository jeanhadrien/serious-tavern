# Story state — agent notes

Per-chat state that workflow turns write. It lives exactly as long as the replies of the turns that wrote it. Definitions are YAML records (`data/state/definitions/`); the stored truth is `session.state.turns`. User guide: `docs/STATE-AND-LORE.md`; reference: `docs/dev/reference/story-state.md`.

## Turn presence is the one rule
- The server appends a `TurnEntry` for EVERY settled turn (success, failure, stop; writes or not), in the same session update that saves the replies.
- A turn counts iff `replies > 0` and an assistant message with its `executionId` exists (not `streaming`), or `replies === 0` and `completed`. User messages never count. Inactive replies (hidden alternatives) never count, so the shown alternative's writes are the ones that apply.
- Counting turns are numbered 1..n and the turn being run is n+1 (`trigger.turn`). Deleting a reply only changes presence; edits (`editedAt`) never touch state.
- Stored sessions are not parsed on read: read entries only through `readTurnEntries`, append only through `withTurnEntry`, never touch `session.state.turns` raw.

## The fold
- `foldStoryState` is the only interpreter: pure, never throws. The web reuses it and never re-implements it. Pass definitions oldest first (`oldestFirst`).
- Scalars are **post-values** (`increment` becomes a `set`).
- Collections store item-level `add`, `update` and `remove`. An `update` changes only an item's `text` (id, fields, link, place and turn stay); only the LLM node's write tools store it, and **a thread never takes one** (`suits` refuses it: a thread item's text is its exchange's). A new write op needs a case in the fold, `test-oracle.ts`, the random test's generator, `previewWrite` and the web's `describeWrite`.
- A stored value that doesn't fit the CURRENT definition reads as the default plus a warning, and stored data is never rewritten. That is why definition edits are always allowed.
- Node-private state (`target.kind: 'node'`) is scoped by workflow: node targets carry `workflowId`, and a node reads its own workflow's writes plus legacy ones without `workflowId`.
- The state view stays small: history keeps values only for number/boolean/enum keys (text and object points are `{ turn }`), `previewWrite` cuts long write values (`WRITE_PREVIEW_LIMIT`, `truncated`) except items with a link, and an uncapped node collection sends only its newest `NODE_ITEMS_LIMIT` items (`omitted` counts the rest). The fold itself stays uncapped for node keys: Draw's window needs every item.

## Runs on the entry
- A turn's entry records every run in `runs` (`{ executionId, workflowId, part: 'reply'|'post', status: running|completed|error|stopped, error? }`, `error` cut to `POST_ERROR_LIMIT`). `part: 'post'` is a run of the after section.
- The first reply run creates the entry. **Every later run settles only through `withRunSettled`**, which appends its writes AFTER everything earlier, so deleting the turn's replies undoes them all.
- **The restart rule is computed on read, never stored:** `effectiveRuns(entry, isLive)` reports a stored `running` that the in-process registry doesn't hold as an error ("interrupted by a server restart").
- New entries never write `postExecutionId`/`postStatus`/`postError`; read them through `postOfEntry`/`effectiveRuns`, which also cover legacy entries. When a turn has `runs`, read them, not the derived post fields.

## Definitions
- Names are template-safe and unique ignoring case. The name rule has one text (`TEMPLATE_NAME_RULE`) and one check (`definitionNameProblem`).
- A name is immutable under live data: the server refuses a rename or delete while a PRESENT turn wrote the definition (a delete also while a node uses it).
- The key `description` in `stateKeyDefSchema` is shown to the model by the generated tools.

## Node values: one rule per question
`node-values.ts` holds the rules the engine and the panels both check, never copied: which operations a key allows (`stateOpsFor`), read modes (`stateReads`), an item's fit (`collectionItem`/`itemFieldNeeds`), what a thread item is (`threadItem`). `parseDecimal` is the UI-side rule for typed number boxes; the engine never parses text into numbers.

## Thread keys
Key type `thread` (`{ cap?, description? }`): a list key whose items are LLM exchanges, `{ id, text, exchange: ConversationMessage[], input?, turnId, runId }`.
- The fold treats it as a collection (`isListKeyType`, `cap` included; items unchecked, no link check, ops add/remove/delete; never `update`). Every new switch on the key type gets a `thread` case, and code that means "a list key" uses `isListKeyType`.
- **The field is `exchange`, never `messages`:** `messages` is the built-in link to chat messages on collection items.
- `threadItem(value, input?, { keepReasoning })` is the one rule for what is stored: a non-empty list of canonical messages that parses, `reasoning` and `provider_data` stripped unless `keepReasoning` (`provenance` always stays); `input` text becomes a user message, or one message (only role, content and name kept; blank text is none).
- An item's `text` is `exchangeText` of its exchange.
- `turnId` and `runId` are stamped by the engine, never parsed out of item ids.
- **The state view never carries an exchange:** `viewThreadItem` turns an item into `{ id, text, steps, toolCalls, turnId, runId }` for `previewWrite` and the state view; the full exchange is in the execution log of `runId`.
- **TODO (later): store exchanges by reference.** Every item stays inline in `session.state.turns` for good (turns are never compacted), and the session file is rewritten whole on each streaming flush and settle. Candidates: a small item pointing to the run log's `exchange` output, or a per-session sidecar file keyed by item id. Either needs a migration plan and a rule that logs or sidecars a thread points to are never deleted (the fork already asks this of logs).

## Test support
Hand-built `ExecutionContext`s need `...stateless(nodeId)` (`packages/engine/src/test-state.ts`); `playTurn`/`newChat`/`playLater` there play a chat in memory through the real fold. Server tests use `apps/server/src/test-support/story.ts`.
