# Story state in the chat — agent notes

The web never interprets story state itself: it reads the server's state view and runs the shared fold (`foldStoryState`) where it needs a what-if. Never re-implement a rule from shared here: no fold, no link status, no position, no "replaced".

## One fetch per chat
- `useStoryState` makes ONE fetch of `GET /api/sessions/:id/state` per open chat and feeds the panel's Story state section, the reply chips and the delete check.
- `startStoryLoader` reloads (debounced, coalesced) on this chat's `sessions.changed` and on `stateDefinitions.changed` (waiting longer, since a saved definition is announced twice: by the API write and by the file watcher). `useStoryState` also reloads when the chat goes idle again.
- **Nothing in the streamed-token path changes it:** never add a fetch, a poll or a dependency there. `ChatPanel` stays `memo`, and its `story` prop is the memoized `StoryPanelData`.
- Node-private state is scoped by workflow: every reader of a node-write target (`NodeMemory` keys included) compares `workflowId` too.
- The view has no key types, so a key's display kind is read off its value (`storyModel.ts`). A thread item is recognized by its summary shape (`steps` number plus `toolCalls` list, `threadSummaryOf`), never by key type.

## Chips and the delete check
- A turn's chip joins the view's turns to the messages by `executionId` and sits on the LAST non-streaming reply of a turn that still counts and wrote something. Its card is inline, not a floating layer.
- The chip also exists for a counting turn whose after run has ended, even without writes (it is how the log is reached; every status but `running`), and for a turn with `linkWarnings` (warning icon and text). Its card embeds `ExecutionDetails` with `optional` (silent fetch, "No log was saved for this run." instead of a 404 toast).
- `scrollToTurn` goes to the turn's LAST assistant reply; a turn without a reply is shown as plain text, not a link. `scrollToMessage` finds a message by `data-message-id`.
- `undoneByDelete` runs the SHARED fold twice (with and without the reply), lazily on the trash click. It returns lines only when this is the last surviving reply of a turn that stored something and a value would change; a key whose write the view had cut is listed as "may change" rather than dropped. `deleteClick` then chooses between the dialog listing them and the inline step. Never interpret writes by hand. The delete dialog puts the change note after the list, and words an exchange as `(exchange: …)`. A list key compares items by id AND text: an undone item `update` keeps the id, so it is listed as "puts back the earlier text".

## Runs after the reply
- They ride the same state view (the turn's `runs` and the derived post fields), never a new fetch, poll or per-token dependency. `postRuns.ts` is the pure model and `postRunText.ts` holds every string.
- `PostRunStatus` (memo; props are the session id and the memoized `runningPostRun`) is a quiet row above the composer. Its Stop calls the chat's one stop, then reloads the state (so a stale row after a hard server kill clears). The composer stays unlocked.
- While a message waits for the server to start it (`useChat().queued`, until `turn.start`), Stop aborts that message's request instead of calling `POST /stop`, which would end the after run; the composer then reads "Cancel queued message".
- **The failure toast uses a baseline, never a running-to-error transition** (`nextAlerts`): the first view of a chat only records what it already holds (so a restart-interrupted run shows on its chip without toasting), later unseen failures toast once, and a stopped run never toasts.
- The panel's Story state section lists the newest three failures, so a turn without a reply and a failure from while the chat was closed stay visible.
- The thread observes its viewport too (`watchResize`), or the status row would clip the newest reply.

## Linked items and thread items
- An item of a definition's collection key carries the server's `link` (`itemLinkOf` parses it; a bad one reads as a plain item). `groupLinked` only sorts by `firstIndex` and splits on what the view says (intact first, then broken and not replaced, then the replaced and repeated ones collapsed under "Replaced or repeated").
- `itemFields`/`ITEM_BOOKKEEPING` leave `messages`, `link` and a thread summary's fields out of an item's extra fields: any new place that lists item fields goes through them.
- A linked item's text arrives whole and renders through `MessageContent` (`skipHtml`); one-line previews use the shared `plainPreview`.
- `messageLinks(view)` is computed once per view (in `MessageList`) and gives each message its linked items. `changeNote` is the single text of the edit/delete note (only for intact items). The marker is the hook `useLinkMarker` (button in the message header, card under it), never a per-token computation.
- A thread item's row shows `threadNote` ("3 tool calls · 4 steps") and a "Run log" button that mounts `ExecutionDetails` for the item's `runId` only when clicked (no log fetch per row).
- Don't name a model file like its component (`linkedGroups.ts` next to `LinkedItems.tsx`): case-only clashes fail on Windows.
