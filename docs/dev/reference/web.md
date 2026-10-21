# Web reference

`apps/web`: React 19 + Vite, proxying `/api` to the server. It renders and edits; it never executes workflows or
interprets story state itself. Design references: `docs/dev/design/FRONTEND-LAYOUT.md` (where things are) and
`FRONTEND-UX.md` (how they behave).

## Transport, alerts, stores

- `api/transport.ts` owns `fetch`, JSON headers (`Content-Type` only with a body), `ApiError` and toasts: every non-2xx
  is toasted unless the request passes `{ silent: true }`. Per-resource clients in `api/` use the contract's types;
  pages call methods (`sessionsApi.sendMessage(id, body)`), never paths. `api/events.ts` is the one shared
  `EventSource`.
- `alerts/`: `alerts.error|success|info|warning(message)` from anywhere, `useAlerts()` in components.
- **List stores** (`stores/`): `createListStore` holds one server list outside React. It loads on the first
  subscriber, re-fetches on its change event (the server also sends one on connect), sorts (`compareRecent` for
  workflows, presets and chats; by name for characters, personas and collections) and keeps the array identity when
  nothing changed. `useList(store)` is a `useSyncExternalStore` wrapper; `store.refresh()` fetches now, and calls in the
  same tick or during a fetch share it. Stores feed lists and pickers only; drafts and the open chat are separate
  state. Settings data (secrets, import sources) has no change events and is fetched by its page.

## The shell

`layout/` implements the three columns L | M | R.

- `state.ts` is the pure layout model (`layoutReducer`, no React): the tabs of L and R, the wide editor in M, which
  narrow editors are open, compact and phone modes, dirty flags, and each resource's editor kind (wide or narrow).
  `derive.ts` turns it into `viewSlots` (the column of each view, or `null`) and the header icons. Rules are tested in
  `state.test.ts`.
- `Shell.tsx` mounts every view once, in a fixed order, as children of one CSS grid; moving or hiding a view changes
  only its `grid-area` or `hidden`, so streaming turns, drafts, scroll positions and the React Flow canvas survive.
  `useChat` lives in the shell and feeds the chat list (in R) and the conversation (`pages/Chat.tsx`). Prop-less views
  are module-level constants (`STATIC_VIEWS`, `DIRTY_SOURCES` in `layout/staticViews.tsx`).
- **Editors by kind.** Wide (in M): workflows, presets. Narrow, in L with their list: providers, state definitions;
  settings has no list. Narrow, in R with their list: characters, personas, collections. Opening a wide editor sends
  the chat to R and hides the narrow editor; closing it brings them back.
- **Widths.** Columns are resized with `ResizeHandle` (drag, arrow keys; side minimum 180 px, M minimum 360 px),
  remembered in `localStorage`. Below 1000 px the layout is L | M (`useCompactMode`). Below 700 px (`useMobileMode`)
  it shows one column at a time (`pane`), with a menu drawer (`MobileMenu`, a native `<dialog>`) instead of the top
  bar, L icons and handles. Editors adapt with container queries (the preset editor stacks below 640 px; the workflow
  palette becomes a strip and the config panel covers the canvas below 560 px).

### The layout URL

`/?session=<id>&left=presets&wide=preset:<id>&right=character:<id>`, defaults omitted (the plain layout is `/`).

| Param | Meaning |
| --- | --- |
| `session` | The open chat |
| `left` | L's tab: `workflows` (default), `presets`, `providers`, `stateDefinitions`, `settings`; `provider:<id>` or `stateDefinition:<id>` for an open narrow editor |
| `wide` | `workflow` or `preset`, with `:<id>` for the open item |
| `right` | R's tab: `chats`, `characters`, `personas`, `collections`, or `chat` while a wide editor owns M; `character:<id>`, `persona:<id>`, `collection:<id>` for an open narrow editor |
| `edge` | One-shot highlight of an edge in the opened workflow |
| `view` | Phone only, when what is on screen differs from what the rest of the URL opens |

`layout/url.ts` holds the pure functions (`parseLayoutUrl`, `formatLayoutUrl`, `layoutHref`, ...; garbage falls back
to defaults) and `useLayoutUrl` syncs both ways. A content change (chat, editor, item) is a `push`; tab switches and
corrections are a `replace`. A URL the hook didn't write (Back/Forward, a link, a pasted URL) is `restore`d: its items
open through the editor stores once their lists load, then the real state is written back with `replace` (an id that
no longer exists closes its editor). Back/Forward never replaces an unsaved draft or switches a streaming chat; a
clicked link does replace a draft, like a click in a list. Old paths (`/workflows?workflow=…&edge=…`, `/presets?id=…`,
`/collections?id=…`, `/state-definitions?id=…`, `/characters`, `/personas`, `/settings`) are inbound aliases
(`layout/routes.ts`), because node-ui's "Edit ↗" links emit them; unknown paths become `/`.

## Editors

- **Editor stores** (`stores/editorStore.ts`, one per resource) link a list and its editor: the open id, the dirty flag
  and the list's requests (`open(item, focus?)`, `discard(id)`), applied once each by the editor (`useEditorCommands`).
  `open` sets `currentId` at once, so the URL changes once. Lists also call `useLayoutActions().openEditor` to show the
  editor; `useDirtySync` mirrors dirty flags into the reducer for the header dots.
- **Unsaved work.** Every path that replaces the open item (a list click, create, duplicate, import, a link) first
  asks `confirmSwitch` (Save / Discard / Cancel, through the dialog host), before any write or layout change. Each
  editor registers its save with `useEditorSaver`. `useUnsavedWarning` adds the browser's `beforeunload` warning.
- **The header.** Every editor renders `EditorHeader`: back (narrow editors), title or name input, the unsaved marker,
  extra buttons, then Save, Revert, Duplicate, Delete. Characters, personas and presets keep their draft in `useDraft`
  (draft plus saved snapshot); providers, collections, state definitions and workflows have drafts of their own shape.
- **Disk sync.** Editors of file-backed resources follow disk edits through `useFileSync` and the shared
  own-save-echo classifier (`classifyDraftChange`): a clean editor reloads; a dirty draft is never replaced (one
  warning; saving overwrites the file); a deleted item closes; each invalid file gets one persistent warning, cleared
  when fixed. A dirty draft the disk already holds (the editor's own save, announced before its response) is a reload.
  The preset editor keeps the selected entry by position, since entry ids are derived on read; if the preset was
  deleted, saving fails with `NOT_FOUND`.
- **Presets** (`pages/presets/`): list, editor, entries and preview. Imported presets are read-only through one
  `readOnly` prop (entries can still be selected and previewed), with a banner and **Duplicate to edit**.
- **Characters and personas** (`pages/entities/`): one list view, detail, avatar and drop components and draft logic
  for both, specialized by an `EntityKind`. Create and import (file picker or drop, on the list and the editor) live in
  `entityActions.ts`; a file dropped on a dirty editor is imported without replacing the draft.
- **Collections** (`pages/collections/`): `openCollection` fetches the whole record before switching the editor (the
  list only has summaries). Entries are an accordion; keywords, tags and weight stay text in the draft
  (`collectionDraft.ts`) and are checked on save (an unedited list is sent back as stored); unknown entry fields are
  sent back unchanged. Discard re-reads the collection first. A save answered `404` asks before recreating it (the file
  may exist but no longer parse). Rows are memoized so typing stays fast in lorebooks of hundreds of entries.
- **State definitions** (`pages/stateDefinitions/`): the draft holds every value as text and keeps the properties the
  form doesn't edit (`rest`); `definitionCompile.ts` is the only way to a request body and also produces the live
  problems. "+ New" creates `new_state` (or the first free `new_state2`...). A rename refused with
  `STATE_DEFINITION_IN_USE` shows a banner with the chats, locks the name until the definition is opened afresh, and
  offers "Duplicate as" and "Keep the current name". The editor notes, under a list key's cap, that a cap drops linked
  items' summaries.
- **Providers**: see [providers.md](providers.md#the-provider-editor).

## The workflow editor

`pages/workflows/`: controlled React Flow canvas hooks, the node view, palette, toolbar, config panel, and the tested
conversion model (unknown node types become read-only placeholders).

- **Dynamic ports.** For descriptors with `dynamicPorts`, the editor asks the server for ports on load, on config
  changes and when resources change (definitions included), ignores stale answers, refreshes React Flow's handle
  geometry, and prunes edges to ports that disappeared (with the raw setters, so the history doesn't record it). A
  failing resolution toasts once per node and restores the type's static ports; a node not set up yet toasts nothing.
- **Required inputs.** `WorkflowNode` draws a plain red dot on each input whose resolved `PortDef.required` is true
  (never `requiredIfConnected`). It never changes colour: that an input is unconnected is the engine's validation
  issue, and a client copy of the rule would break "a rule has one home".
- **Connect picker.** Dropping a connection on empty canvas opens `ConnectPicker` at the drop point. The pure
  `connectCandidates` lists the node types with a port that accepts it (an exact port before one that coerces through
  `canConnect`; no second Chat Input; dynamic types judged by their default ports), ordered by category then label.
  The new node is created and connected through the same edge rules as a manual connection.
- **History** (`canvasHistory.ts` pure, `useCanvasHistory`): up to 100 snapshots of nodes and edges (without
  selection or measurements). A step is an add, a removal, a connection, a drag that moved something, or a config
  change (changes to one node's config less than a second apart are one step). Selection, name, chat settings and
  pruned edges are not steps. Opening another workflow, Revert and closing reset it; saving doesn't. Dirty is computed
  from the canvas, so undoing back to the saved state reads as clean.
- **Copy and paste** use the native `copy`/`paste` events through the keyboard module's area handlers. The payload is
  JSON `{ kind: 'serious-tavern/nodes', version: 1, nodes, edges }` (`canvasClipboard.ts`; only edges with both ends
  selected). A paste gives new ids, offsets positions by 40 px per consecutive paste of the same text, renumbers names,
  selects what it added, skips unknown types and a second Chat Input (with an info toast), and is one undo step.
- **Chat settings panel** (`WorkflowSettingsPanel`, toggled from the toolbar, which counts problems): one row per
  declaration with type-specific fields, reorderable. Declarations are part of the draft; one that doesn't parse is a
  read-only row the user can only remove. Problems from `workflowSettingIssues` show next to their field.
- **Node panels** come from node-ui (`NodeConfigPanel`, custom panels in its `customPanels` map). The editor passes a
  `NodePanelContext`: presets, characters, providers, `loadModels`, `renderLink`, the draft's chat settings, state
  definitions and collections. `renderLink` is `PanelLink`: a collection link opens the collection editor in R and a
  definition link opens the definitions editor in L, next to the open workflow, instead of following the URL (which
  would close the workflow).

### Node-ui panels

- **Generic form:** generated from the JSON Schema; `.describe()` texts are hints; template fields hint variables from
  the macro registry. The only array editor is for `{ key, value }` rows; other arrays show as read-only JSON. A number
  field without a schema default is stored as unset when cleared (the node's own fallback applies); one with a default
  stores 0.
- **LLM:** the `ModelPicker` combobox over `loadModels` (pure logic `modelOptions.ts`, loading in `useModelList.ts`,
  which ignores answers for a previous provider and never throws), and the Tools section (`LlmTools.tsx` over
  `toolsConfig.ts`).
- **Recall and Draw:** `CollectionPicker` (picked collections in config order, unknown ids shown as
  `Unknown collection (<id>)`, up/down for Recall, an Edit link); tag lists and numbers through `DraftInput`, which
  keeps what is typed and commits only valid values.
- <a id="state-panels"></a>**State panels:** a shared `StateKeyPicker` (definitions from the catalog, then their keys as
  `name (type)`; unknown ids stay visible as `Unknown definition (<id>)`/`Unknown key (<name>)`; an "Edit definition ↗"
  link). State Read adds a Read select. State Write adds an Operation select listing only what the key allows
  (`stateOpsFor`), then a typed fixed-value editor (`StateValueEditor`): a number or amount box, a three-way boolean
  select, the enum's options, a text area, a JSON area, the item text plus one control per declared field, an item id
  box, or nothing for a reset. Clearing a control removes the setting; changing the key or operation clears it. The same
  picker, in other kinds, sets up Next Chunk and Unlinked Messages (list keys), Thread (thread keys) and the LLM's tool
  lists (any key but threads).
- **Trigger:** a custom panel for the signal rows and per-level tables (`panels/trigger.tsx`, `triggerConfig.ts`).

## The chat

`Chat.tsx` composes the focused components of `pages/chat/`: `ChatSidebar`, `ChatHeader` (character and persona
selectors, the chat panel toggle), `ChatPanel`, `MessageList`, `ChatMessageView`, `MessageContent`, `MessageActions`,
`MessageEditor`, `Composer` and `ExecutionDetails`. `useChat` owns the session, sending and streaming;
`useMessageActions` owns edits, deletes and swipes; `useStickToBottom` keeps the thread at the bottom while the reader
is within 96 px of it and observes content resizing.

- **Composer:** grows to 200 px; Enter sends, Shift+Enter adds a line, IME composition never submits. The draft is
  per chat in `localStorage` (`composerDraft.ts`), saved about 300 ms after typing and when leaving, removed on send,
  pruned for deleted chats at startup.
- **Streaming:** `api/turnStream.ts` reads the SSE events and `useChat` applies them through the pure helpers of
  `turnMessages.ts`. Rows are keyed by `runId` and node id (a reply list may reuse node ids). "Preparing a reply"
  shows until the first row exists; with several workflows `run.start` makes it read `Running <workflow>…`.
  `turn.complete` replaces the local rows with the saved messages and logs. A dropped connection resyncs the session.
  While a turn runs the chat is locked (no chat switching, creating, deleting, or message edits); a workflow running
  after the reply doesn't lock it.
- **Messages:** Markdown through `react-markdown` + `remark-gfm` with raw HTML skipped and unsafe link protocols
  rejected; soft line breaks kept with `white-space: pre-line`; links open in a new tab. Every message element carries
  `data-message-id` (and `data-execution-id`), which scrolling and markers rely on. Copy, edit and delete appear on
  hover or focus (always on touch screens). A row still streaming has no log yet.
- **Text statistics:** `useMessageStats` always calls `GET /api/sessions/:id/stats` (the web never reads the
  `showMessageStats` setting; `enabled: false` means no map, so nothing shows). It loads through the same
  `startSessionLoader` as the story state: once per chat, again 100 ms after this chat's `sessions.changed` or an
  `appSettings.changed`, and when the chat goes idle. `Chat.tsx` hands the map to `MessageList`, which gives each
  `ChatMessageView` its own entry; `MessageStats` (numbers from `statItems`) shows on non-streaming assistant replies
  only: icon plus raw number, `—` for a `null`, the explanation in the `title`.
- **Alternatives and fork:** `AlternativeControls` sits on the last reply of the last turn
  (`alternativesOfLastTurn(...).lastReplyId`, only while nothing runs). Regenerate streams through
  `streamRegenerate`; the current replies stay until the server starts the run, are hidden locally while new rows
  stream, and come back if the run ends with no reply. The fork button appears on every reply in
  `forkPoints(activeMessages(...))`, computed in `Chat.tsx` once per change of the messages.
- **The chat panel** (`ChatPanel`, local state of the chat view, not a layout view): **On reply**
  (`pages/chat/panel/ReplySection.tsx`, `replyList.ts`, saved through `createReplySaver`, which keeps one PATCH in
  flight and sends the newest whole list), **Settings** and **Story state**. Below 760 px of chat width it covers the
  messages.
- **The Settings section** shows one control per setting from `listedSettings` (the rule the server checks values
  against; it follows the saved list, never a change still being saved): a slider plus a number field for a number
  with both `min` and `max`, a number field otherwise (partial input such as `-` stays editable; an invalid number
  shows why, isn't saved, and cancels the pending save of an earlier valid prefix), a checkbox, a dropdown, a text
  field or a textarea for `multiline` text, with the description, the resolver's issue, and a reset button when a
  value is stored. Checkboxes and dropdowns save at once; typed values and slider moves after a 500 ms pause, on blur
  or when the panel closes (`saveMode`, `createSettingSaver`, one request in flight, values that came due meanwhile
  sent together, a `keepalive` send on `pagehide`). `useChat.updateSettings` takes only `settings` from each answer,
  so a change made while a turn streams never disturbs it. With no declaration, the section links to the workflow.

## Story state in the chat

`pages/chat/story/`. The web never folds state itself except for the delete check's what-if, which runs the shared
`foldStoryState`.

- **Loading.** `useStoryState` makes one fetch of the state view per open chat and shares it with the panel, the chips
  and the delete check. `startStoryLoader` (over the generic `startSessionLoader`) reloads, debounced (100 ms), after this chat's `sessions.changed` and after
  `stateDefinitions.changed` (300 ms, since a saved definition is announced twice); a change during a fetch causes one
  more fetch and drops the older answer. Streamed tokens cause nothing.
- **The panel section:** per definition a present turn wrote, each key's value, a sparkline for numbers written in at
  least two turns (inline SVG, `sparklinePoints`), and "written at turn k", which scrolls to that turn's last reply and
  flashes it. Collections are lists, newest first, with their extra fields and the cap note. **Node memory** lists
  implicit node state (named after its workflow when the chat runs several). The section also lists the newest three
  failed runs after the reply. Display kinds are read off the values (`storyModel.ts`).
- **Linked items** (`LinkedItems.tsx` over `linkedGroups.ts`): a card per linked item with its range, a status badge,
  a jump to its first message and its text, collapsed to a one-line preview. Intact items first, in chat order, then
  broken ones; replaced and repeated ones fold under "Replaced or repeated". **Markers** (`LinkMarker.tsx`,
  `linkMarkers.ts`): a link button on each message that items link to, with a card listing them and a "Show in Story
  state" action (a one-shot `reveal` request the panel consumes). Editing or deleting a linked message first shows a
  note (`changeNote`).
- **The turn chip** (`TurnChip.tsx`, `turnChips.ts`, `describeWrite.ts`) sits on the last non-streaming reply of a turn
  that still counts and stored something, ran several workflows, ran workflows after the reply, or had link warnings.
  Its inline card lists the writes in words (`scene.tension → 9`, `Draw #1 (draw): drew 'resin smell'`), notes edited
  replies, lists the runs with their logs, and shows warnings.
- **The delete check** (`undoList.ts`, `deleteConfirm.tsx`): on the trash click only, `undoneByDelete` folds the chat
  with and without the reply. When it's the last surviving reply of a turn that stored something and a value would
  change, the delete asks with a dialog listing what goes back (`scene.tension (back to 4)`, `scene.injected (forgets
  'a bell…')`); otherwise it's the inline confirmation. A key whose write the view had cut is listed as "may change".
- **Runs after the reply** (`postRuns.ts`, `postRunText.ts` for every string, `PostRunStatus.tsx`,
  `usePostRunAlerts.ts`): a quiet row above the composer while one runs, with Stop; a failure toasts once (the first
  view of a chat is a baseline, never a running-to-error transition), a stopped run never toasts. A message sent
  meanwhile shows "Waiting for the workflows after the reply to finish", and the composer's button becomes "Cancel
  queued message", which aborts that request.

## Shared building blocks

- **Dialogs** (`components/dialog/`): `dialogs.ask` and `confirmDelete`, shown by one `<DialogHost/>` (native modal
  `<dialog>`, Cancel focused, questions queued).
- **Keyboard** (`keyboard/`): one `document` listener (`useKeyboard`). Escape goes through the pure `escapeStep`
  (a field that acted, an open dialog, the newest layer, leaving a field, then the area's handlers, newest first);
  `Ctrl/Cmd+S` saves the focused editor; area shortcuts (undo, redo, copy, paste) reach the view with the keyboard
  through `useShortcutArea`. All shortcuts are declared in `keyboard/shortcuts.ts`.
- **Reordering** (`components/sortable/SortableList`, the only importer of dnd-kit): a grip handle that drags with
  mouse, touch or pen (only the handle has `touch-action: none`) or by keyboard (Space or Enter, arrows, Space to drop,
  Escape to cancel, with screen-reader announcements); `Alt+↑/↓` on a focused row (`keyMove`); up/down buttons through
  the same `moveUp`/`moveDown`; the pure `moveItem`. Items without ids get stable ones from `useRowIds`, kept beside the
  list. Used by preset entries, collection entries, provider reasoning fields, chat setting declarations and the On
  reply list. node-ui's collection picker can't import it and keeps buttons plus `Alt+↑/↓`.
- **Resizing** (`components/splitter/`): one `Splitter` and `useStoredSize`; used for the chat panel, the workflow
  config panel and the preset entry list. A stored size reaches CSS as a custom property that only side-by-side layouts
  read.
- **Dependencies:** `lucide-react` for icons, `react-markdown` and `remark-gfm` for Markdown; no HTML-processing or
  syntax-highlighting plugin. Icon-only buttons have accessible labels and titles; the scrollable thread has
  `tabIndex={0}` for keyboard scrolling (a documented Biome suppression).
