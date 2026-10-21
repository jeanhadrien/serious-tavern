# Fork a chat from a reply (spec and plan)

A fork is a new chat that starts as a copy of an existing one, cut after a chosen reply. It copies stored messages and
story state, so the data rules of `AGENTS.md` apply in full: additive, backward compatible, stored records never
rewritten on read.

## What the user gets

- A **Fork chat from here** button (lucide `GitBranch`) on assistant replies.
- Clicking it on `Ass2` of `User1, Ass1, User2, Ass2, User3, Ass3` creates a new chat holding `User1, Ass1, User2, Ass2`
  and opens it. The source chat is untouched.
- The fork continues exactly where the source stood after that reply: same story state, same turn numbers, same reply
  list, settings, character and persona. Message links (summaries) stay intact, and every reply still opens its log.
- The forked turn keeps its alternatives: if `Ass2` had been regenerated, the fork can swipe between them and
  regenerate it, since it is the fork's last turn. (This is "swipe an older turn" by forking at it.) This is an
  **app-wide setting**, on by default: "Forks keep the alternatives of the reply they start from" in Settings. Off, a
  fork holds no hidden alternative at all (only what the chat shows).

## The model: a fork cuts by turn, never by message position

**Story state is per turn, not per reply.** A turn is present while ANY of its replies is (`turnPresence`), and then
all its writes apply. So the cut must fall at a turn's end:

- **Fork points are the last reply of each turn.** A turn can have several replies (several workflows in the reply list,
  or several Chat Outputs). Forking after its first reply would keep the turn present with every write of the runs behind
  the replies that were cut. The button appears only on the last shown reply of a turn; with one reply per turn (the
  common case) that is every assistant message.
- **No fork from a user message** (user decision). A user message has no reply of its own to stop at.
- **Messages are not contiguous per turn.** A regenerated turn's inactive replies sit before the shown ones in
  `session.messages`, so "everything before message M by index" is not the rule either.
- **Turn entries can't be copied wholesale.** A completed turn with `replies === 0` (a turn that only wrote state) counts
  with no message at all. Copying every entry would bring the writes of a later reply-less turn into the fork.

**Rules (shared, pure, in a new `packages/shared/src/fork.ts`, with table tests):**

- `forkPoints(messages)`: the ids of the messages a fork may start from. These are active (`activeMessages`), settled
  (not `streaming`) assistant messages that are the last active assistant message of their turn. A turn is the
  `executionId`; a reply without one (older chats) is a turn of its own.
- `forkCut(messages, state, messageId, { keepAlternatives })`: `{ messages, state }` for the new chat, or `undefined`
  when `messageId` is not a fork point (the caller answers from that, like `withActiveAlternative`).
  - **The turn group of M** (when M has an `executionId`): every row whose `executionId` is the root or whose
    `alternativeOf` is the root, with root = `M.alternativeOf ?? M.executionId`. That covers the turn's user message,
    every alternative's replies, active or not. Without an `executionId`, the group is M alone.
  - **Messages:** every raw message up to the group's last index, in stored order, unchanged (same ids, same fields,
    unknown fields included; `inactive` rows of earlier turns are kept as they are, harmless and invisible).
    `streaming` rows are left out (defensive: the server refuses a running chat anyway).
  - **`keepAlternatives: false`:** the kept rows are filtered through `activeMessages`, so the fork holds no inactive
    message at all (neither the forked turn's alternatives nor older turns' hidden ones). The state rule below is the
    same, computed from what is kept: entries of dropped alternatives before the cut stay, harmlessly absent (no reply).
  - **State:** let E be the `executionId`s of the kept messages. Keep the raw `state.turns` entries up to and including
    the LAST entry whose `executionId` is in E; drop every entry after it. None in E: no entries. Unknown keys of
    `state` and raw entries this version cannot read survive as stored (the `withTurnEntry` style: decide with the raw
    `executionId`, never re-serialize parsed entries). This keeps reply-less turns from before the cut and drops later
    ones.
  - **The property to test:** `foldStoryState` over the fork equals the fold over the source with the later turns
    removed. Turn numbers continue, and Trigger cooldowns, Draw's `avoidRecent` and node state follow with no special
    case.

## App settings (new, small resource)

The app has no app-wide preference yet. The frontend is a thin client, so it lives on the server, not in
`localStorage`.

- **Shared** (`packages/shared/src/app-settings.ts`): `appSettingsSchema`, `.passthrough()`, one field for now:
  `forkKeepsAlternatives: boolean`, default `true`. `readAppSettings(raw: unknown)` never throws: a missing or
  non-object value gives the defaults, a field of the wrong type reads as its default, unknown keys are kept.
- **Contract** (`packages/shared/src/api/app-settings.ts`, wired like the other endpoint groups):
  - `getAppSettings`: `GET /api/app-settings`, the settings with defaults filled in.
  - `updateAppSettings`: `PATCH /api/app-settings`, a partial body (`forkKeepsAlternatives?: boolean`), merged into
    the stored file, answering the whole settings.
- **Storage:** one file, `data/app-settings.json`, atomic writes (`atomicWrite`), its own lock (read, merge and write
  under it).
  - Missing: the defaults. Nothing is written until the first PATCH.
  - Unknown keys in the file survive a PATCH.
  - A file that is not valid JSON is never overwritten: GET answers the defaults and logs a warning; PATCH answers
    `500 APP_SETTINGS_UNREADABLE` naming the file.
  - It is on `AppContext` (e.g. `appSettings`), created in `context.ts`.
- **No change event yet:** only the Settings page reads it, on mount. The fork reads it on the server at fork time.

## Server

**Fork:** `POST /api/sessions/:id/fork`, body `{ messageId }` (`forkSessionSchema`), answer `201` with the new session
(`sessionSchema`). Contract first in `packages/shared/src/api/sessions.ts` (`forkSession`).

- **Errors:**
  - `404` for an unknown session, and for an unknown or inactive message (as message edit/delete do).
  - `400 NOT_A_FORK_POINT` for a message that is not a fork point (a user message, a reply that isn't its turn's last).
  - `409 TURN_RUNNING` while a job holds the source's queue slot (turn, regenerate, run after the reply).
- **No forking a running chat** (user decision). A copied `running` run would read in the fork as "interrupted by a
  server restart" (`TurnRegistry.hasPostRun` is keyed by session id), and streaming rows would be copied mid-write.
  - `turns.isRunning` is checked while holding the source's session lock, so a job can't start between the check and
    the read. Read the source with `sessions.silent.update(id, current => current)`, returning it unchanged; that is
    the repository's only locked read. It rewrites identical bytes and publishes nothing.
  - The source is never modified: its `updatedAt` stays.
- **The new session** (saved through the notifying `sessions.save`, so one `sessions.changed` for the new id):
  - `id`: new UUID.
  - `title`: `<source title> (fork)`.
  - `createdAt`/`updatedAt`: now, so it tops the recency-ordered chat list.
  - Copied from the source as stored (raw, never parsed, unknown keys kept): `workflowId`, `triggers`, `characterId`,
    `personaId`, `settings`, and any other top-level key the server does not own.
  - `messages`/`state`: `forkCut`'s result, with `keepAlternatives` from the app settings' `forkKeepsAlternatives`.
  - `forkedFrom: { sessionId, messageId }`: a new optional field on `sessionSchema` (additive). It is stored for
    provenance and not used anywhere yet (user decision).
- Nothing is validated beyond the source's existence. A workflow, character or persona the source names but that was
  deleted since is copied as is; the fork behaves like the source would.
- **Ids are kept on purpose:** message ids, `executionId`, `runId`, `alternativeOf` stay as in the source.
  - Message links store message ids (new ids would turn every summary `gone`).
  - Replies open their logs by `runId ?? executionId`, so the fork shares the source's execution logs. This works
    because no code deletes logs or checks a log's `sessionId` (which still names the source). Write this into
    `AGENTS.md`: a future log cleanup per chat must not delete logs a fork still points to.
- Service in `apps/server/src/services/fork.ts`, route in `routes/sessions.ts` (thin, like the others).

**Tests** (server):
- Fork at a middle reply: the fork has the cut messages, the source is unchanged.
- The fork's `GET .../state` equals the state the source had after that turn; a message sent in the fork gets the next
  `trigger.turn`.
- A turn with two workflows: only its last reply is a fork point.
- A forked turn with alternatives: the fork can swipe and regenerate it. With `forkKeepsAlternatives` off (set
  through the API), the fork has no inactive message and one alternative.
- App settings: defaults with no file, PATCH merges and keeps unknown keys, an unreadable file is not overwritten.
- A summary (linked item) written before the cut is `intact` in the fork.
- A reply-less turn after the cut does not apply in the fork; one before it does.
- A forked reply's log opens.
- The errors: `409 TURN_RUNNING` with a held run after the reply (`test-support/post.ts`), `400 NOT_A_FORK_POINT`,
  `404`s.
- One `sessions.changed` for the new id.
- The contract coverage test in `app.test.ts`.

## Web

- `apps/web/src/api/sessions.ts`: `sessionsApi.fork(id, { messageId })`.
- `useChat.fork(messageId)`: the same shape as `create`:
  - it does nothing while `busy` or while a message change is pending;
  - `++opening`, call the API, `enter(next)` (which flushes the source's composer draft; the fork starts with an empty
    one), `alerts.info('Chat forked')`, then `refresh()`.
  - `useChat.ts` is already ~310 lines (a known follow-up in `FRONTEND-UX.md`): keep the addition small, or put it
    next to `useMessageActions` if that reads better.
- `Chat.tsx` computes `forkPoints(activeMessages)` once per change of the messages (memoized, never in the token path)
  and passes the set to `MessageList`, which gives `ChatMessageView` an `onFork` only for those ids.
- The button is an `IconButton` (`GitBranch`, label and title "Fork chat from here") in the message's action row. It is
  disabled while the chat is `disabled` (busy or saving a message change) and while a run after the reply works (the
  server would answer `409`, same as the swipe buttons' `swipeDisabled`).

- **Settings page** (`pages/Settings.tsx`, the form in L): a "Chats" section with one checkbox, "Forks keep the
  alternatives of the reply they start from", saved on change through `appSettingsApi.update` (new client
  `api/appSettings.ts`), loaded on mount. Put it in its own component under `pages/settings/` so `Settings.tsx` stays
  a thin composition.

**Tests** (web): the pure parts (which messages get the button). **Live check:** a chat with three turns, fork at the
second reply, check that the fork opens with two turns, that its Story state panel matches the source's state at that
point, then send a message in the fork. Also fork at a regenerated reply and swipe in the fork.

## Order of work (each its own agent)

1. **Shared:** `fork.ts` (`forkPoints`, `forkCut` with `keepAlternatives`), `forkedFrom` on `sessionSchema`,
   `app-settings.ts`, table tests including the fold property above.
2. **Server:** the contracts (fork and app settings), the app settings store, `services/fork.ts`, the routes, the tests
   above. Update `README.md` (Chat: forking; App settings) and `AGENTS.md` (Key contracts: a **Fork** bullet with the
   cut rule, kept ids and shared logs; an **App settings** bullet).
3. **Web:** API clients, `useChat.fork`, the button, the Settings toggle, tests of the pure parts, `README.md`. Live
   check as above, plus the toggle off.

## Out of scope

- Forking from a user message.
- Showing `forkedFrom` (a "Forked from …" link).
- Copying the composer draft, or forking a running chat.
- Copying execution logs (they are shared, see above).
