# Step 7e: regenerate and swipes (spec and plan)

Spec: `docs/FRONTEND-UX.md`, Features in this round ("Swipes and regenerate... get their own short spec"). This file is that spec and its plan. It changes stored messages, so the data rules of `AGENTS.md` apply in full: additive, backward compatible, stored sessions never rewritten on read.

## What the user gets

- **Regenerate**: on the chat's **last turn**, a button runs the turn again on the same history (the same user message, or the same empty send) and shows the new replies in place of the old ones.
- **Swipes**: the last turn keeps every generated alternative. `‹ 2/3 ›` controls on its last reply switch between them. Switching is instant (nothing runs) and undoes or redoes the story state of each alternative, through the existing turn-presence rule.
- Only the last turn can be regenerated or swiped. Once a new message is sent after it, the shown alternative stays and the others are kept hidden (no controls), the way SillyTavern swipes only the last message.

## The model: alternatives are turns, and only the active one is present

**Decision.** An alternative is an ordinary turn: its own `executionId`, its own `TurnEntry` with its writes, its own replies and its own after-reply run. Alternatives of one turn are tied by the `executionId` of the first one (the root). Exactly one alternative is active; the replies of the others are kept but marked inactive.

This reuses the one rule story state already has (`turnPresence`): an inactive reply doesn't count, so its turn isn't present, so its writes don't apply. Swiping is just flipping which replies are active. No new fold rule.

**Message fields** (`messageSchema`, `packages/shared/src/models.ts`, additive, optional):
- `alternativeOf?: string`: on the replies of a regenerated alternative, the root `executionId`. The root's own replies don't carry it, so they need no rewrite.
- `inactive?: true`: on the replies of every alternative that isn't shown. Absent means active, so every stored message stays active.

**Rules (shared, pure, in a new `packages/shared/src/alternatives.ts`, with table tests):**
- `activeMessages(messages)`: drops `inactive` ones. **Every reader of a chat** goes through it:
  - `historyMessages` (server);
  - `turnPresence` (shared; ignore inactive messages when collecting `replied`);
  - message links (`analyzeLinks`/`indexById` callers take the history, so they follow `historyMessages`);
  - the web's rendering and its delete check (`undoneByDelete` runs the shared fold over the messages it shows).
- `alternativesOfLastTurn(messages)`: the root id, the ordered alternatives (`executionId`, created order) and which one is active. It's empty when the last turn has no assistant reply, or when a user message follows it.
- `withActiveAlternative(messages, executionId)`: returns new messages with `inactive` set on every reply of the group except the chosen execution's (cleared there). It's only valid for the last turn's group.

## Server

**Regenerate**: `POST /api/sessions/:id/regenerate/stream` (SSE, the same `turnEventSchema` as `messages/stream`) and `POST /api/sessions/:id/regenerate` (plain), contract first in `packages/shared/src/api/`.
- It runs in the session's queue like a message (`TurnRegistry`), and `POST .../stop` stops it like a turn.
- Refused with `409 NOTHING_TO_REGENERATE` when the last turn has no assistant reply (e.g. the chat is empty, or the last message is a user message whose turn produced nothing).
- **History of the run**: the active messages up to and including the last user message before the last turn's replies (or none, for an empty send). The last turn's replies are left out.
- **State of the run**: folded as if the last turn's active alternative weren't present. Compute the presence with the current active alternative's replies treated as inactive. `trigger.turn` is then the same number the original had.
- `trigger.message`: the content of that user message, or `''`.
- No user message is stored.
- **Settle**:
  - The new replies carry `alternativeOf: root` and are active, and the previous active alternative's replies get `inactive: true`, all in the same `sessions.silent.update` that appends the new `TurnEntry` (`settleTurn` gets an option for it). One `sessions.changed`.
  - A stopped or failed regenerate with at least one reply row settles the same way (the partial reply becomes the shown alternative, as a normal stopped turn keeps its partial reply).
  - With no reply row, nothing changes in the messages; the turn entry is still appended, as for every settled turn, and isn't present.
- After-reply runs: as for any turn (the new execution's).
- `session.updatedAt` advances like a sent message (it's message activity).

**Swipe**: `PATCH /api/sessions/:id/alternative` `{ executionId }`, contract first.
- 409 `TURN_RUNNING` while a job runs in the session. 400 when `executionId` isn't an alternative of the last turn.
- Writes `withActiveAlternative` through `sessions.update` under the session lock. One `sessions.changed`. It never advances `updatedAt` (like edits).
- Returns the session's messages (or the whole session, as `PATCH /api/sessions/:id` does; follow the existing contract style).

**Message edit/delete** of an inactive message: 404 like an unknown id. They act on active messages only.

**Tests** (server): regenerate replaces the shown replies and keeps the old ones inactive; the run's history and `trigger.turn`; story state follows the swipe (a write in alternative 1 and another in 2: swiping changes `GET .../state`); the post run of a regenerated turn; stop during regenerate; 409s; old sessions without the fields behave as before; the plain and stream routes; the contract coverage test in `app.test.ts`.

## Web

- `apps/web/src/api/sessions.ts`: `regenerate` (through `turnStream.ts`, generalized to the regenerate URL) and `setAlternative`.
- `useChat`:
  - `regenerate()` reuses the streaming send path (rows marked `streaming` until settle) without a user message, and the local row bookkeeping in `turnMessages.ts` gets a "replace the last turn's replies" helper (pure, tested);
  - `swipe(executionId)` patches, then applies the returned messages.
  - Both are disabled while `busy`.
- Rendering filters inactive messages through the shared `activeMessages`.
- `ChatMessageView` on the last reply of the last turn:
  - a **Regenerate** icon button (lucide `RotateCw`);
  - when there are 2+ alternatives, `‹` `n/N` `›` buttons (`ChevronLeft`/`ChevronRight`, labels "Previous alternative" / "Next alternative").
  - They are shown only on that one message.
- The delete check and turn chips keep working because they read active messages only.

## Order of work (each its own agent)

1. **Shared**: the fields, `alternatives.ts`, `turnPresence` and the tests (including the fold through presence: an inactive reply undoes its turn's writes).
2. **Server**: `historyMessages`, the regenerate routes and settle option, the swipe route, the edit/delete 404, and the tests above. Update `README.md` (Chat, Story state) and `AGENTS.md` (Key contracts: a new **Alternatives** bullet; Streaming turns; Session writes).
3. **Web**: API clients, `useChat`, the buttons, tests of the pure helpers, `README.md`. Live check: regenerate twice, swipe back and forth, and the Story state panel follows.

## Out of scope

- Swiping older turns.
- Regenerating with a different workflow.
- Keyboard swipes (←/→).
- Deleting one alternative from the UI.
- Pruning inactive replies.

These are later ideas.
