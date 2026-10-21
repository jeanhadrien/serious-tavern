# Turns reference

What happens on the server between a message arriving and its last run settling, and the operations that change a
chat's turns: edits, regenerate, swipes, fork. Endpoints: [api.md](api.md#chats). Story state side:
[story-state.md](story-state.md).

## The chat queue

`TurnRegistry` gives each chat one queue slot. Messages, regenerates and the after section of a turn run one after
another in it; different chats run concurrently. `POST .../stop` stops whichever job holds the slot, never a queued
one. Deleting a chat stops its job first, and `app.close()` stops every job with reason `shutdown` and waits for it
(`TurnRegistry.close()`, an `onClose` hook).

The message routes watch the client from the moment the request arrives (`clientLifetime`): a queued message whose
client leaves is cancelled when it reaches the front and stores nothing. The plain `POST .../messages` only cancels a
message that hasn't started. A queued stream gets no headers until its turn starts (there is no `turn.queued`
frame), so the web client cancels a queued message by aborting its own request.

## The reply list

`session.triggers = { reply: [{ workflowId, enabled }] }` (optional). `replyWorkflows(session)` is the only reader:
the stored list when it has at least one entry that parses (bad entries skipped, a repeated workflow keeps its first
entry), otherwise `[{ workflowId: session.workflowId, enabled: true }]`, so every older chat reads as a list of one.
`session.workflowId` mirrors the list's first entry; every write of the list writes it.

## A turn

**Start** (`startTurn`, inside one session update): every enabled workflow is prepared, in order, before anything is
stored (`NO_ENABLED_WORKFLOW`, `WORKFLOW_INVALID`); the story state is folded once with one listing of the
definitions; chat settings are resolved per workflow against its own declarations. The enabled list is split into two
sections: the **reply section** runs from the top to the **last workflow with a Chat Output node** (a static check),
the **after section** is everything below.

**Ids.** The turn's id is the **first run's execution id**. It is the turn entry's, the user message's and every
reply's `executionId`, so turn presence, alternatives, chips and links need no rule of their own. Each reply also
carries `runId`, the log of the run that wrote it; open a message's log with `runId ?? executionId`.

**Run k** starts from the turn-start state plus the writes runs 1..k-1 committed (the fold's `including: turnId`,
which counts the turn as present whatever its replies and reads as of that turn, so `trigger.turn` is the same for
every run), and from the turn-start history plus the replies those runs saved. `trigger.message` is the same for every
run; Chat Input's `replies` are the replies saved above. Node-private state is scoped by workflow: the engine stamps
every node write target with the run's workflow id, and a run reads the writes of its workflow or of none (legacy).

**Settle.** Each run settles in its own `sessions.silent.update`: the first creates the turn entry (`settleTurn`),
later ones add to it through `withRunSettled` (writes appended after everything earlier, `replies` added, `completed`
kept true only while every reply run ran to the end, `linkWarnings` appended, the run's record appended), with the link
check against the chat as it is then. One `sessions.changed` when the reply section settles.

**Failure and stop.** A run that fails keeps what it completed and **the later runs still run**; the section ends
with `WORKFLOW_EXECUTION_FAILED` for the first failure (the message names the workflow only when several ran). A
stop ends the running run and the rest of the list doesn't run. The error details carry every saved message and log.

**An empty reply section** (no enabled workflow has a Chat Output) completes the turn at once with no reply: no
`execution`, `executions: []`; the entry is created in that write and every workflow runs in the after section.

**Empty sends.** `content` may be empty or absent: no user message is stored, `userMessage` is absent from the result,
and the turn runs on the history as it is with `trigger.message` set to `''`.

## Streaming

`POST .../messages/stream` answers with `turn.start`, `run.start { runId, workflowId, workflowName }` before each
run, `node.*` events tagged with `runId`, then `turn.complete` (the persisted messages and every run's log) or
`turn.error`. Events come from the engine's `onEvent` through `TurnStream`, which also flushes the streaming rows to
the session file and handles the tool loop's step resets (`node.delta` with `reset: true`). Stop is only
`POST .../stop`: the stream stays open and ends with `turn.error` `TURN_STOPPED` and the failure details (saved user
message, replies so far as `partial` rows, logs). The client settles from that payload; aborting the fetch is only a
fallback, seen by the server as a disconnect.

## The after section

The workflows below the last replying one are not streamed. They run **after the reply section's result is sent**
(the response or `turn.complete` goes out; the stream is not held open), one after another, **in the turn's own queue
slot**: the next message waits for them, even one queued before the reply settled.

- **Announcing.** The write that settles the last reply-section run (or creates the entry, for an empty section)
  lists the after section's runs as `running` (`runs` records with `part: 'post'`), so the chat never shows a gap,
  and their ids are put on the `RunningTurn` first. Mechanically the after section is not a second registry job
  (that would queue behind a message already waiting): the registry resolves the caller's promise, then runs
  `turn.after` with a `RunningTurn` of its own before releasing the slot.
- **What a run sees.** The chat as it stands: `history` is every active message (the turn's user message, then its
  replies), and Chat Input's `replies` are the turn's replies. A summarizer therefore sees the turn's own messages.
- **When it runs.** Unless the reply section was stopped. A failed reply run doesn't prevent it. A regenerate that saved
  no reply runs none (its turn doesn't count).
- **Settling.** Each run settles through `settleAfterRun` (`withRunSettled`) inside `sessions.silent.update`, then
  publishes `sessions.changed`. A failure is that run's `error` (cut to 500 characters on the entry, whole in its log),
  never the turn's; completed nodes keep their writes whether the run failed or was stopped. The settle is retried
  once; if it still fails, a minimal write records an `error` saying the result couldn't be saved (its writes are
  lost), so the entry is never left `running`. A chat deleted meanwhile ends the run with no settle and no event.
- **Stop and shutdown.** A user stop ends the running run as `stopped` and records the rest `stopped` (not run, no
  log). A shutdown records the interrupted `error` a crash shows.
- **Restart rule**, computed on read: a stored `running` that the server doesn't hold reads as `The run was interrupted
  by a server restart.` (see [story-state.md](story-state.md#the-state-view)). Nothing is rewritten, and there is no
  startup pass.
- The "No Chat Output nodes ran" warning only appears for a workflow that has Chat Outputs, none of which ran.

## Messages

- **Edit** (`PATCH .../messages/:messageId`) and **delete** change only the targeted message, under the session lock
  (they wait for a running job instead of racing its write). An edit that changes the trimmed content stamps
  `editedAt` (display only). Neither re-runs a workflow, changes attribution or execution metadata, or touches saved
  logs; a delete can change which turns count. Inactive messages answer `404`.
- **`updatedAt`** means last message activity: a send or a regenerate advances it; edits, deletes, swipes and metadata
  patches don't, and forking leaves the source's untouched.
- Replies store a snapshot of the speaker's `name` and `characterId`, so renaming a card doesn't rename old replies.

## Regenerate and swipes

An **alternative** is an ordinary turn: its own `executionId`, turn entry, replies and after section. The alternatives
of one turn are tied by the root, the first one's `executionId`, which later ones carry as `alternativeOf`. Replies of
an alternative not shown carry `inactive: true` (absent = active). The pure rules (`activeMessages`,
`alternativesOfLastTurn`, `withActiveAlternative`, `withoutLastTurnReplies`) are in `packages/shared/src/alternatives.ts`.

- **Regenerate** runs in the chat's queue like a message and stores no user message. `regenerateTarget` (inside
  `startTurn`'s update) gives `trigger.message` (the user message sharing the root's `executionId`, else `''`), the
  history the original run saw, and the messages to fold the state over (the last turn's replies left out), so
  `trigger.turn`, `{{state.*}}` and the writes match the original turn. The whole enabled list runs again as one new
  alternative.
- **Settle** (`settleTurn` with `regenerate: { rootId }`): in the update that appends the new entry, the new replies
  get `alternativeOf` (streaming rows carry it from the start) and every reply of the earlier alternatives becomes
  inactive. A stopped or failed regenerate with a reply row settles the same way. With no reply row, the messages stay
  as they were and the entry is stored **not completed** (a completed turn without replies would count and apply its
  writes next to the alternative still shown), and no after section runs.
- **Swipe** (`PATCH .../alternative`) only flips `inactive` (`withActiveAlternative`), checks `isRunning` inside the
  update, runs nothing, keeps `updatedAt`, and publishes one `sessions.changed`. The story state follows through turn
  presence. Every run of the turn flips together, since they share `executionId`.
- Everything that means "the chat" reads `activeMessages`: run histories, links, the state view, the preset preview,
  message counts, edit and delete.

## Fork

`POST .../fork { messageId }` creates a chat that copies the source up to the end of a turn (plan:
`docs/dev/plans/fork/01-fork.md`).

- **Fork points** (`forkPoints` in `packages/shared/src/fork.ts`) are the last shown, settled reply of each turn. A
  user message is not one, and neither is a reply followed by another reply of the same turn: story state is per turn,
  so a cut inside a turn would keep writes of runs whose replies were cut.
- **The copy** (`forkCut`): the messages up to the end of the turn, in stored order and unchanged, and the turn
  entries up to the last one whose `executionId` a kept message carries, so the fork continues with the same state and
  turn numbers. The session is copied raw (reply list, settings, character, persona, unknown keys; nothing is
  validated), titled `<title> (fork)`, with fresh `createdAt`/`updatedAt` and `forkedFrom: { sessionId, messageId }`
  (stored, not read yet).
- **Ids are kept** (message ids, `executionId`, `runId`, `alternativeOf`): links store message ids and replies open
  their logs by id, so the fork shares the source's execution logs.
- The app setting `forkKeepsAlternatives` (default on) decides whether the fork keeps the forked turn's inactive
  alternatives.
- The source is read under its lock and never modified.

## Chat settings in a turn

`startTurn` resolves the session's values per enabled workflow (`resolveChatSettings`: a stored value that fits, else
the default with an issue), records them in `execution.settings` and the issues in `execution.warnings`. A change made
while a turn streams applies from the next turn. `PATCH` checks values against the union of every listed workflow's
declarations (`listedSettings`, enabled or not, first declaration of a key wins), as the list will be after the patch.
