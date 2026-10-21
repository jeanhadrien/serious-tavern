# Chat view — agent notes

Story state in the chat (chips, delete check, linked items, after runs) is in `story/AGENTS.md`.

## The token path
`useChat` re-renders on every streamed token. Nothing that fetches, or depends on more than the streaming rows, may sit in that path: memoize what the token path passes on, and keep prop identities stable.

## Server-computed views
- `startSessionLoader` is the one loader for what the server computes per chat (story state, message statistics): this chat's `sessions.changed` plus the caller's `alsoOn` events, debounced, one more fetch for a change during a fetch. A new view of this kind is a new caller, not a new loader.
- `useMessageStats` returns a map that keeps its identity until a load delivers a new one; `MessageList` passes each message only its own entry. The web never reads the `showMessageStats` setting: no map means nothing is shown.

## Composer draft and copy
- **The composer draft is per chat in `localStorage`** (`st.composer.<sessionId>`), never in the token path. Only typing writes it (`useChat.setContent`, stable identity, debounced by `createDraftSaver`, which carries the chat id with the pending text).
- `enter` (open, create, close) flushes the previous chat's draft and loads the new one; `pagehide` and unmount flush; `send` removes the stored draft before the request, and only a cancelled queued message is put back.
- Copy copies the stored `content`, never `reasoning`.

## Streaming and messages
- The chat publishes run activity to the editor through `stores/runActivity.ts` (workflow id and node statuses from `onRun`/`onNode`, `finish()` in the stream's `finally`). That is all it publishes: never session data, and never anything per token, to another view.
- `streamMessage` never toasts; `useChat` decides, through `notifyError`.
- Local row bookkeeping lives in the pure helpers of `turnMessages.ts`. Rows with `status: 'streaming'` are local until the turn settles. Streaming rows are keyed by `runId` + node id. A frame with `reset: true` clears the row's text before applying the delta.
- A row still streaming has a `runId` but no saved log: never render `ExecutionDetails` for it. Open a message's log with `messageLogId(message)` (`runId ?? executionId`).
- Every message element keeps `data-message-id` (both roles), and a turn's `data-execution-id` is on its user message too. Don't drop them when refactoring `ChatMessageView`: scrolling and markers rely on them.
- Message edit/delete never re-run a workflow. Local edit/delete match by id, so inactive rows riding in `session.messages` are untouched.
- Chat Escape stops a reply only when `chat.busy`, which is false while only workflows after the reply run. The composer acts on Escape only while busy.

## Alternatives (regenerate, swipes)
- `Chat.tsx` computes `activeMessages(session.messages)` once per change of the messages and gives it to the thread, the chips and the delete check: never hand them the raw list.
- The exception is `alternativesOfLastTurn`: it reads ALL the messages (inactive replies are what make alternatives), is computed in `Chat.tsx`, and is `null` while `busy` (an empty-send run would look like it belongs to the previous turn). `MessageList` hands the controls to the `lastReplyId` message only.
- A regenerate shares `useChat`'s `runStream` with a send (rows `streaming` until settle, errors through `notifyError`). The shown replies stay until `turn.start`, are then marked inactive locally (`replaceLastTurnReplies`), and `settleRegenerate` either keeps them hidden next to the new rows or, when the run saved no reply, shows them again.
- Swipe is a `useMessageActions` mutation, behind the same pending gate as edit and delete; only the answer's `messages` are taken, local settings stay. Its buttons are disabled while a workflow after the reply runs (the server would answer `409 TURN_RUNNING`).

## The chat panel
- `ChatPanel` (sections: Settings, On reply, Story state) is local state of the chat view, not a layout view: it never touches `layout/state.ts`. It is `memo`, and its props keep their identity across streamed tokens. Its width (`chat-panel`) lives in its own state, never in a prop.
- **Settings** save through `useChat.updateSettings`, which merges only `settings` from the PATCH answer into the open session (never its messages) and isn't gated by a running turn. One PATCH in flight, so answers arrive in order.
- **On reply** is the only editor of the reply list (the header has no workflow select). It saves through `createReplySaver`/`useChat.updateReplyList`: one PATCH in flight, never gated by a running turn, only `triggers`/`workflowId` taken from the answer. `Chat.tsx` memoizes `replyWorkflows` on `session.triggers` and `workflowId` so tokens don't re-render the panel. A new chat copies the open chat's list.
- Header metadata patches keep the local `settings` and reply list (`withStoredMetadata`).
- "Show in Story state" goes through `Chat.tsx`'s one-shot `reveal` request: the chat view owns the panel's open state, and `ChatPanel` scrolls to the row marked `data-item-id`, then clears the request through `onRevealed`. Both callbacks keep their identity.
