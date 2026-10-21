# Frontend UX

Design reference for how the web app behaves under the user's hands: keyboard, Escape, drag and drop, resizing, confirmations, unsaved work. `FRONTEND-LAYOUT.md` says **where** things are; this file says **how they behave**.

Status: agreed and built (October 2026); open items are under Follow-ups.

Functionality comes before style. Nothing here asks for visual polish.

## Principles

1. **Reusable building blocks first.** Each behaviour below is built once, as a shared component or hook, and every page uses it. No page re-implements Escape, drafts, confirmations, reordering or resizing.
2. **One way to work with every resource.** Every resource is a list and an editor. Every editor uses the same draft hook and the same header, with the same actions in the same places.
3. **Never lose work silently.** Leaving a dirty draft asks first. Escape and Back never discard anything. Closing or reloading the tab warns while something is dirty.
4. **Escape closes the innermost thing.** It is one ordered rule, not a key each component handles its own way (see Escape).
5. **Every drag has a non-drag equivalent.** Buttons, keys or a menu do the same thing, so phones and keyboards can do everything.
6. **Anything that splits can be resized.** Sizes are remembered per browser.
7. **Rules are pure and tested.** Decisions (which layer Escape closes, what a reorder produces, whether a switch needs a dialog) are pure functions with unit tests, like `layout/state.ts` and `pages/chat/keyboard.ts`. Components only wire them up.
8. **Native and plain.** Native elements (`<dialog>`, `<details>`, `<select>`, `<button>`), no animation. Colors and sizes come from a few CSS variables, so a later restyle is cheap.

## Escape

Each Escape press does exactly one thing, the first one that applies:

1. **A field handles it itself.** Only these do:
   - an open dropdown or combobox closes (the model picker);
   - the message editor cancels the edit;
   - the composer stops the reply while one is generating (see step 4).
2. **An open popover, menu or dialog closes.** The most recently opened one first.
3. **Focus leaves the field.** If focus is in a text field, select or other input, Escape only leaves it. Focus moves to the area the field is in (its view), not to the page, so the next Escape still knows where it is.
4. **The area with focus closes one level.** "Area" is the layout view that contains focus:

   | Area | Escape |
   |---|---|
   | Chat | closes the chat panel if open; otherwise stops the reply if one is generating (same as the Stop button: the partial reply is kept, a queued message is cancelled) |
   | Narrow editor | back to its list (the draft is kept) |
   | Wide editor | its own inner layers first (selection on the canvas, the node config panel, the preset entry editor); then closes the editor (the draft is kept, the chat returns to M) |
   | A list | nothing |

Rules:
- Escape **never discards** a draft. Every editor stays mounted, so closing one only hides it.
- Escape **never stops workflows running after the reply**. They run quietly and the user may not know it is there; its own Stop button stays the way to stop it. This may be revisited.
- Escape only stops a reply when **the chat is the area with focus**. Escape inside the workflow editor while a reply streams in R acts on the editor.
- Escape is not browser Back. Back keeps stepping through layout history in the URL (`useLayoutUrl`).

### Mechanism

- One `keydown` listener on the document handles Escape. It ignores events a field already handled (`defaultPrevented`).
- Popovers, menus and dialogs register a **layer** while they are open (`useEscapeLayer(open, close)`). Layers form a stack; the newest closes first.
- Each layout view declares what Escape does in its area (an area handler). The listener finds the area from the focused element's view (`[data-view]`).
- Leaving a field focuses its view's section (`tabIndex={-1}`).
- The decision (which step applies) is a pure function over a small description of the situation, with table tests. The existing one-off listeners (`TurnChip`, `LinkMarker`, the composer, the message editor, the model picker) move onto it.

## Shortcuts

| Keys | Where | Does |
|---|---|---|
| `Escape` | everywhere | see Escape |
| `Ctrl/Cmd+S` | an editor with focus | saves it; the browser's "save page" is always suppressed |
| `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+Y` | workflow canvas (not inside a field) | undo, redo |
| `Ctrl/Cmd+C`, `Ctrl/Cmd+V` | workflow canvas (not inside a field) | copy, paste nodes |
| `Alt+↑`, `Alt+↓` | a focused row of a reorderable list | moves it |
| `Enter`, `Shift+Enter`, `Ctrl/Cmd+Enter` | composer, message editor | unchanged (`pages/chat/keyboard.ts`) |

- Shortcuts are scoped: global, then per area (chat, canvas, editor). A field keeps its native keys (text undo, copy, paste) and wins over area shortcuts.
- All shortcuts are declared in one module, so a later help list or rebinding has a single source.
- When something closes (dialog, popover, editor), focus returns to the element that opened it, or to its row in the list.

## Unsaved work

- **Switching items.** When a list asks its editor to open another item while the draft is dirty, a dialog asks **Save / Discard / Cancel**:
  - Save saves, then opens the new item. A failed save opens nothing.
  - Discard drops the draft and opens the new item.
  - Cancel keeps everything as it is.

  This lives in the editor store (`stores/editorStore.ts`), so every list gets it. The editor registers its save (`useEditorSaver`) so the dialog can offer it, and every caller asks `confirmSwitch(id)` before `open`.
- **Closing or reloading the tab** while any editor is dirty triggers the browser's own "leave site?" warning (`beforeunload`).
- **Escape, Back, back arrows and closing a wide editor never discard.** The editor stays mounted, and the dirty dot shows where the draft is.
- Live disk sync (`useFileSync`, the preset live sync) keeps its current rules.

## Confirmations

- **Inside a draft, no confirmation.** Removing a preset entry, a state key, a canvas node or a setting row only changes the draft. Revert, or undo on the canvas, gets it back. A chat's On reply list is not a draft (every change saves at once) but removing a row asks nothing either: the workflow itself is untouched and Add workflow brings it back.
- **Deleting something stored asks.** A chat, character, persona, preset, workflow, provider, collection, state definition or message. The dialog names the item and the consequences when known (workflows that use it, story state the delete undoes).
- **Leaving unsaved changes** asks Save / Discard / Cancel (see Unsaved work).
- **One building block:** `confirm({ title, body, actions })` returns a promise of the chosen action. It is built on `<dialog>` (modal). Focus starts on the safe action, Escape cancels, and it works on phones. `body` can hold structure (a list of state changes), not only text.
- It replaces every `window.confirm` (8 call sites today).
- A real Undo after a delete would need a trash on the server: recreating a record gives it a new id, which breaks references. It is a later idea, not part of this design.

## Drag and drop

- **Library: dnd-kit** (`@dnd-kit/core` + `@dnd-kit/sortable`, the stable line). It handles mouse, touch and pen through pointer events, keyboard dragging and screen-reader announcements, and later covers dragging between lists and drop targets.
  - It is wrapped once in a `SortableList` component. Pages never import dnd-kit directly, so moving to its rewrite (`@dnd-kit/react`, 0.x today) touches one file.
  - The reorder itself is a pure function (`moveItem(list, from, to)`), as `reorderEntries` is today.
- **Every reorderable list uses `SortableList`**, with a drag handle, its up/down buttons kept, and `Alt+↑/↓` on the focused row. Today there are six, each with its own code:
  - preset entries (the only one with drag, through HTML5 drag-and-drop, which doesn't work on touch);
  - collection entries;
  - provider overrides;
  - workflow chat settings;
  - the chat panel's On reply list (see Chat panel: On reply);
  - the collection picker in Recall/Draw (node-ui).
  - **Decision:** the collection picker in node-ui can't import from `apps/web`, and its list is short and rarely reordered. It keeps its up/down buttons and gains `Alt+↑/↓` on its rows, but no drag and no dnd-kit. The other four use `SortableList`.
- **Not dnd-kit:**
  - The workflow canvas: React Flow owns node and edge drags.
  - Files dropped from the computer: the browser's file drop (`EntityDropZone`). A single drop handler that routes a file to the right importer by type (card PNG, preset JSON, lorebook) is a later step.

## Resizing

- The side columns resize (`layout/ResizeHandle.tsx`, widths in `localStorage`); a double-click on a handle resets that column.
- One generic **splitter** (`components/splitter/`): horizontal or vertical, pointer and keyboard (arrows), double-click resets to the default size. Sizes are remembered per browser under a stable key (`useStoredSize(key, { initial, min, max })`, with the same guarded `localStorage` access as `layout/widths.ts`).
- It is used inside editors, only where the panes sit side by side. A stored size is applied through a CSS custom property that only the side-by-side rules read, and the splitter is hidden in the stacked and overlay layouts (container queries decide).

  | Split | Default / min / max | Where |
  |---|---|---|
  | Chat panel width | 320 / 260 / 640 | next to the thread; none when the panel overlays it (chat container up to 760px) |
  | Workflow node config and chat settings panel (one shared width) | 300 (settings: 340) / 240 / 720 | beside or floating over the canvas; none when it covers the canvas (editor container up to 560px) |
  | Preset entry list vs entry editor | 320 / 220 / 640 | the two-column layout (editor container 641 to 1000px); none in the wide three-column layout and none when stacked |

- Later, optional: dragging a side column below its minimum collapses it; the preset preview pane; vertical splits (the component supports `orientation`, nothing uses it yet).

## Editors

- **Shared draft hook** (`useDraft`): holds the draft and the saved snapshot, computes `dirty` (a key per value, JSON by default), offers `load`/`set`/`clear`/`revert` and reports to the editor store. It does not apply the store's commands or register the saver: each editor does that, because what "open" and "save" mean differs. Not every editor fits it, so it is used where the draft is a plain copy of the saved item:

  | Editor | `useDraft` | Why |
  |---|---|---|
  | Characters, personas | yes | plain draft vs saved snapshot |
  | Presets | yes | the draft is the saved `Preset`; the live sync reads the saved key and the selected entry stays local |
  | Providers | header only | the draft is a text form (`ProviderDraft`) of a different type than the saved record; dirty and the live sync are keyed on that pair |
  | Collections | header only | async load, text drafts, Revert re-reads from disk |
  | State definitions | header only | compiled text drafts, name lock |
  | Workflows | header only | the canvas holds the draft |

- **Shared editor header**: back or close, the item name, the same unsaved marker ("Unsaved changes"), then actions in a fixed order: Save, Revert, Duplicate, Delete. Read-only items (built-in providers, imported presets) show why and keep only what applies.

## Features in this round

- **Composer draft per chat.** The text being typed is kept per chat across switching chats and reloads (per browser, `localStorage` keyed by session id, guarded like `layout/widths.ts`), and cleared on send.
- **Copy a message.** A button in the message actions copies its text (raw Markdown). A clipboard failure is a toast.
- **Workflow canvas:**
  - **Drag to empty space.** Dropping a connection on empty canvas opens a node picker at that point, listing only node types with a port that accepts the connection (through `canConnect`). Picking one creates the node there and connects it.
  - **Touch.** On a coarse pointer the handles get an invisible hit area (the drawn handle keeps its size; it stays within the port's row so it doesn't steal taps meant for selecting the node) and a dropped connection snaps to a handle within 40px instead of React Flow's 20. Checked by hand with DevTools touch emulation, not in tests.
  - **Undo/redo.** The editor keeps a history of canvas snapshots (nodes, edges, configs). A drag counts once (recorded on drag stop) and typing in a config field is grouped. The history resets when another workflow opens; saving doesn't clear it.
  - **Copy/paste nodes.** Copies the selected nodes and the edges between them; paste gives them new ids and offsets them. It works across tabs (the system clipboard carries JSON). A second Chat Input is not pasted (a toast says why).
- **Chat panel: On reply.** The chat's workflows live in the chat panel's first section, not in the header. A row is the workflow's name (a link that opens it in the editor), an on/off checkbox, move up, move down and remove (never on the only row); the rows reorder by drag, buttons or `Alt+↑/↓`, and an Add workflow dropdown lists the workflows not listed yet.
  - Every change saves at once. It is never disabled by a running reply (unlike the title and character/persona selectors): the list applies from the next message, and the panel says so.
  - One save is in flight at a time; changes made meanwhile are sent together as the newest list, so what the panel shows is always the last thing the user did, and a failed save (toasted) falls back to what the server holds.
  - Escape and focus follow the chat panel's rules: the select and checkboxes are fields (Escape leaves them first), and Escape then closes the panel.
  - A new chat copies the open chat's list, order and switches included.
- **Several runs in a turn.** The chip under the last reply of a turn that ran more than one workflow (including the workflows listed below the one that replies, which run after it) lists each run, in order, with its result and log. The "waiting" indicator names the running workflow when the chat runs several.
- **Swipes and regenerate.** Agreed, but they change stored messages and must fit story state (a regenerated turn replaces the old turn's writes). They get their own short spec before any code.

## Not now (decided)

- Quick switcher (`Ctrl+K`).
- Search inside a chat (the browser's `Ctrl+F` is enough).
- List extras: inline rename, duplicate everywhere, sorting and pinning.
- Dragging a character or persona onto the chat.
- Focus mode (hiding L and R).
- Escape stopping workflows running after the reply.
- Undo after a delete through a server trash.

## Build order

One commit (or a few) per step; each passes `npm run check`.

1. **Confirm dialog** (`components/dialog/`), replacing every `window.confirm`. Done; deleting a chat now asks too.
2. **Unsaved-work guard**: Save / Discard / Cancel on switching items (editor store) and the `beforeunload` warning. Done.
3. **Escape and shortcuts**: the pure decision, the document listener, layers, area handlers, `Ctrl+S`; the one-off listeners move onto it; Escape stops a reply in the chat. Done.
4. **Shared draft hook and editor header**, one editor at a time. Done.
5. **`SortableList`** (dnd-kit) across the reorderable lists: four on dnd-kit, the node-ui picker with buttons and `Alt+↑/↓`. Done.
6. **Splitter** inside editors. Done.
7. **Features**: composer draft and copy message (7a), the canvas (drag to empty space, undo/redo, copy/paste), and regenerate and swipes. Done.

## Follow-ups

Not scheduled; found while building:

- `pages/chat/useChat.ts` is about 310 lines (the shared send/regenerate stream stays inside the hook for its refs). Split it by concern.
- Provider overrides are YAML text, so they are not a reorderable list; only the reasoning fields are.
- Later, as decided: collapsing a side column by dragging, Escape stopping workflows running after the reply, swiping older turns, swiping with ←/→, deleting one alternative, a help list built from `SHORTCUTS`.
- `apps/server/src/storage/directory-watcher.test.ts` ("reports a burst of writes once") failed once under load during this work and passed on reruns; it predates it.

## Testing

- The decisions are pure functions with table tests (Escape steps, reorder, the switch guard, the undo history, picker filtering).
- Components get SSR tests where they render something checkable (`renderToStaticMarkup`, which runs no effects).
- Each step gets a live check with Playwright (Chromium in the cloud container) at 1400x900 and 390x844, against a temp data dir.
