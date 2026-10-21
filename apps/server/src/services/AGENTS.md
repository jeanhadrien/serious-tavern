# Server services: turns, runs, story state — agent notes

The core model (turn, run, reply and after sections) is in the root AGENTS.md; the shared rules in `packages/shared/src/state/AGENTS.md` and `packages/shared/src/links/AGENTS.md`.

## The chat queue
- Jobs sent to one session (a message, an empty send, a regenerate) run one after another; different sessions run concurrently. A write that must not overlap a running job (a swipe, a fork) checks `TurnRegistry.isRunning` **inside** its `update` callback, never before it.
- **Empty sends:** `content` may be empty or omitted. No user message is stored, `userMessage` is absent from the result and failure details, and the turn runs with `trigger.message` set to `''`. Editing a message to empty stays rejected.
- Creating a session takes a `workflowId` (legacy shape) or a `triggers` list, exactly one. Sessions store `characterId` and `personaId`, which the server loads and passes to the executor.
- Session `updatedAt` means last message activity: only a send or a regenerate advances it. Message edit/delete, swipes and metadata patches leave it unchanged.

## Streaming, stop and failures
- The web sends through `POST /api/sessions/:id/messages/stream` (SSE, `turnEventSchema`); the plain `POST .../messages` stays for non-streaming callers. A regenerate (`.../regenerate/stream`) shares the plumbing (`streamJob`) and the queue slot; a refusal before it starts is a plain JSON error.
- Stop is `POST .../stop` only: the stream stays open and ends with `turn.error` `TURN_STOPPED`. Aborting the fetch is only a fallback, seen as a `disconnect`.
- Failed and stopped turns carry `turnFailureDetailsSchema` in `details` (saved user message, replies so far as `partial` rows, execution), so the client settles from the payload and never refetches to guess.
- The message routes watch the client from the moment the request arrives (`clientLifetime`): a queued message whose client leaves is cancelled before it starts and stores nothing (`TurnOptions.keepRunning`: the plain endpoint only cancels before the start).
- Deleting a chat calls `turns.stop(id)` first. `TurnRegistry.close()` (an unconditional `onClose` hook) stops running jobs with reason `shutdown` and awaits them.

## Settling a turn
- `settleTurn` appends the turn's entry in the same session update that saves the replies, for every turn (see turn presence). It also sets `sourceNodeId` on the replies of passthrough Chat Outputs (`passthroughSources`); `TurnStream` does the same on streaming rows.
- Every later run settles into the entry only through `withRunSettled`.
- The link commit check (`commitLinks`) runs inside `sessions.silent.update`, from `settleTurn`, `withRunSettled`'s callers and `settleAfterRun`, against the history as it is then. Both runners save the execution log again with its warnings. The minimal-error settle fallback drops linked writes like other writes.
- On a step reset from the tool loop, `TurnStream` clears the content and unsent text of the rows that LLM feeds, and the next `node.delta` frame carries `reset: true`.

## The reply list
- **Run k sees what runs 1..k-1 did:** their committed writes (`foldSession` with `including: turnId`, so the turn counts while it runs) and the chat as it stands (from the first reply on: the turn's user message, then the replies). `foldRun` is the one way a later run folds its start state. Every fold made for a run passes its `workflowId`.
- `startTurn` splits the list into sections. An empty reply section completes the turn at once with no reply (`execution` is absent from the result). A failed run keeps what it completed and the next runs still run, in both sections; a stop ends the list.
- `startTurn` snapshots the resolved chat settings; the run records them in `execution.settings` and the resolver's issues in `execution.warnings`.
- **`foldWith` for every run:** the server builds the read-your-own-writes closure from the exact arguments of that run's snapshot (`foldWithOf`: `startTurn` for a first run, a regenerate's included, `foldRun` for later runs and the after section). It re-runs the shared fold with `FoldInput.pending`: extra writes folded after everything stored, counted as the running turn's. A new place that runs a workflow for a turn must pass a `foldWith` built the same way; the preset preview passes none.
- Every run gets the turn id (`turnId` option), reply and after section, regenerate included.

## The after section holds the turn's queue slot
- It is NOT a second `TurnRegistry.run` (that would queue behind a message already waiting). The turn's action adds the announced run ids to `turn.postRunIds` BEFORE the settle write and sets `turn.after` right after `sessions.changed` is published. The registry resolves the caller's promise first (the response or `turn.complete` goes out; the stream isn't held open), then runs `after(run)` with a `RunningTurn` of its own before releasing the slot.
- So the next message waits for it, and `POST .../stop` stops whichever job is running (a queued message is never the target).
- After-section runs are announced `running` in the write that settles the last reply-section run, so the chat never shows a gap.
- It never throws: a failure is that run's `error`; a user stop ends the running run as `stopped` and records the rest as `stopped` (a `shutdown` stop records the interrupted `error`, like a crash); completed nodes' writes are kept in all cases; a log that can't be saved is warned and the run still settles; a deleted session makes the settle a no-op. Each run settles with one `sessions.changed`.
- Tests that hold an after run use `test-support/post.ts` (`gateNode`, `postHarness`, `waitForPostRun`) and always release it or rely on `app.close()`.

## The state view (`GET /api/sessions/:id/state`)
- Keep it small (see the shared notes). Before believing a stored `running` that the registry doesn't hold, it reads again, up to three times: a run commits its result before the registry lets go of it.
- The per-turn `postStatus`/`postExecutionId`/`postError` are derived from the `post` runs (`postOfEntry`); nothing stores them.
- Linked items carry `link: { status, replaced, repeated, count, missing, firstIndex, lastIndex, firstMessageId, lastMessageId, messageIds }` (`withLinkViews`): 1-based positions among the history messages, no positions for a `gone` item, nothing for node keys.
- Thread items appear only as summaries (`viewThreadItem`), never with their exchange.

## Messages, alternatives and fork
- **Message edit/delete** change stored content only and never re-run a workflow. An edit stamps `editedAt`; a delete only changes which turns count. An inactive message is `404`.
- **Regenerate** is a job in the chat's queue like a message. `regenerateTarget` (inside `startTurn`'s update, so it judges the chat when the job starts; `409 NOTHING_TO_REGENERATE` otherwise) gives `trigger.message` (the user message sharing the root's `executionId`, else `''`), the history WITHOUT that user message, and the messages to fold over (the last turn's replies left out, so `trigger.turn` and `{{state.*}}` are the original's). No user message is stored.
  - `settleTurn`'s `regenerate: { rootId }` stamps `alternativeOf` on the new replies (and on the streaming rows from the start) and marks every reply of the group inactive, in the update that appends the entry.
  - With no reply row, the messages are untouched and the entry is stored `completed: false` (a completed turn without replies would count and double the writes), and no after section follows.
- **Swipe** (`PATCH .../alternative`) only flips `inactive` through `withActiveAlternative` under `sessions.update`. `409 TURN_RUNNING` (checked inside the callback) while a turn, regenerate or after run is going; `400 NOT_AN_ALTERNATIVE` for anything but an alternative of the last turn; one `sessions.changed`.
- **Fork** (`POST .../fork`): the server never re-implements the cut. `400 NOT_A_FORK_POINT` when `forkCut` gives `undefined`, `404` for an unknown chat or an unknown or inactive message, `409 TURN_RUNNING` checked inside the source's locked read (`sessions.silent.update(id, current => current)`). The source is never modified, `updatedAt` included.
  - The fork is a raw copy, `{ ...source, id, title: '<title> (fork)', messages, state, forkedFrom, createdAt, updatedAt }`, saved through the notifying `sessions.save`. Stored sessions aren't parsed on read, so everything else is copied as stored and never validated.
  - **Ids are kept on purpose** (message ids, `executionId`, `runId`, `alternativeOf`): links store message ids, and replies open their logs by `runId ?? executionId`. So **a fork shares the source's execution logs**; a future per-chat log cleanup must not delete logs a fork still points to.
  - The app setting `forkKeepsAlternatives` (default on) decides whether the fork keeps inactive messages.

## Chat settings
Only `PATCH /api/sessions/:id` changes them: a partial merge where `null` removes any key; a non-null value for an undeclared key, or one that doesn't fit, is `400 CHAT_SETTING_INVALID` and writes nothing (`mergeSettings`). Turns never write them, and edits, deletes and regenerates never rewind them.
