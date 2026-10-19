# Frontend UX

Design reference for how the web app behaves under the user's hands: keyboard, Escape, drag and drop, resizing, confirmations, unsaved work. `FRONTEND-LAYOUT.md` says **where** things are; this file says **how they behave**.

Status: agreed (October 2026), being built. The build order at the end marks what is done.

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
- Escape **never stops an after-reply run**. It runs quietly and the user may not know it is there; its own Stop button stays the way to stop it. This may be revisited.
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

- **Inside a draft, no confirmation.** Removing a preset entry, a state key, a canvas node or a setting row only changes the draft. Revert, or undo on the canvas, gets it back.
- **Deleting something stored asks.** A chat, character, persona, preset, workflow, provider, collection, state definition or message. The dialog names the item and the consequences when known (workflows that use it, story state the delete undoes).
- **Leaving unsaved changes** asks Save / Discard / Cancel (see Unsaved work).
- **One building block:** `confirm({ title, body, actions })` returns a promise of the chosen action. It is built on `<dialog>` (modal). Focus starts on the safe action, Escape cancels, and it works on phones. `body` can hold structure (a list of state changes), not only text.
- It replaces every `window.confirm` (8 call sites today).
- A real Undo after a delete would need a trash on the server: recreating a record gives it a new id, which breaks references. It is a later idea, not part of this design.

## Drag and drop

- **Library: dnd-kit** (`@dnd-kit/core` + `@dnd-kit/sortable`, the stable line). It handles mouse, touch and pen through pointer events, keyboard dragging and screen-reader announcements, and later covers dragging between lists and drop targets.
  - It is wrapped once in a `SortableList` component. Pages never import dnd-kit directly, so moving to its rewrite (`@dnd-kit/react`, 0.x today) touches one file.
  - The reorder itself is a pure function (`moveItem(list, from, to)`), as `reorderEntries` is today.
- **Every reorderable list uses `SortableList`**, with a drag handle, its up/down buttons kept, and `Alt+↑/↓` on the focused row. Today there are five, each with its own code:
  - preset entries (the only one with drag, through HTML5 drag-and-drop, which doesn't work on touch);
  - collection entries;
  - provider overrides;
  - workflow chat settings;
  - the collection picker in Recall/Draw (node-ui).
- **Not dnd-kit:**
  - The workflow canvas: React Flow owns node and edge drags.
  - Files dropped from the computer: the browser's file drop (`EntityDropZone`). A single drop handler that routes a file to the right importer by type (card PNG, preset JSON, lorebook) is a later step.

## Resizing

- The side columns already resize (`layout/ResizeHandle.tsx`, widths in `localStorage`).
- That handle becomes a generic **splitter**: horizontal or vertical, pointer and keyboard (arrows), double-click resets to the default size. Sizes are remembered per browser under a stable key (`useStoredSize(key, default, min, max)`, with the same guarded `localStorage` access as `layout/widths.ts`).
- It is used inside editors: the preset editor's panes (entry list, entry editor, preview), the workflow node config panel, the chat panel.
- Later, optional: dragging a side column below its minimum collapses it.

## Editors

- **Shared draft hook** (`useDraft`): holds the draft and the saved snapshot, computes `dirty`, offers `load`/`clear`/`revert`, reports to the editor store, applies its commands and registers the save used by the unsaved-work dialog. The six editors (characters and personas, providers, collections, state definitions, presets, workflows) move onto it one at a time, without behaviour changes beyond this design.
- **Shared editor header**: back or close, the item name, the same unsaved marker ("Unsaved changes"), then actions in a fixed order: Save, Revert, Duplicate, Delete. Read-only items (built-in providers, imported presets) show why and keep only what applies.

## Features in this round

- **Composer draft per chat.** The text being typed is kept per chat across switching chats and reloads (per browser, `localStorage` keyed by session id, guarded like `layout/widths.ts`), and cleared on send.
- **Copy a message.** A button in the message actions copies its text (raw Markdown). A clipboard failure is a toast.
- **Workflow canvas:**
  - **Drag to empty space.** Dropping a connection on empty canvas opens a node picker at that point, listing only node types with a port that accepts the connection (through `canConnect`). Picking one creates the node there and connects it.
  - **Undo/redo.** The editor keeps a history of canvas snapshots (nodes, edges, configs). A drag counts once (recorded on drag stop) and typing in a config field is grouped. The history resets when another workflow opens; saving doesn't clear it.
  - **Copy/paste nodes.** Copies the selected nodes and the edges between them; paste gives them new ids and offsets them. It works across tabs (the system clipboard carries JSON). A second Chat Input is not pasted (a toast says why).
- **Swipes and regenerate.** Agreed, but they change stored messages and must fit story state (a regenerated turn replaces the old turn's writes). They get their own short spec before any code.

## Not now (decided)

- Quick switcher (`Ctrl+K`).
- Search inside a chat (the browser's `Ctrl+F` is enough).
- List extras: inline rename, duplicate everywhere, sorting and pinning.
- Dragging a character or persona onto the chat.
- Focus mode (hiding L and R).
- Escape stopping an after-reply run.
- Undo after a delete through a server trash.

## Build order

One commit (or a few) per step; each passes `npm run check`.

1. **Confirm dialog** (`components/dialog/`), replacing every `window.confirm`. Done; deleting a chat now asks too.
2. **Unsaved-work guard**: Save / Discard / Cancel on switching items (editor store) and the `beforeunload` warning. Done.
3. **Escape and shortcuts**: the pure decision, the document listener, layers, area handlers, `Ctrl+S`; the one-off listeners move onto it; Escape stops a reply in the chat.
4. **Shared draft hook and editor header**, one editor at a time.
5. **`SortableList`** (dnd-kit) across the five reorderable lists.
6. **Splitter** inside editors.
7. **Features**: composer draft, copy message, then the canvas (drag to empty space, undo/redo, copy/paste), then the swipes spec.

## Testing

- The decisions are pure functions with table tests (Escape steps, reorder, the switch guard, the undo history, picker filtering).
- Components get SSR tests where they render something checkable (`renderToStaticMarkup`, which runs no effects).
- Each step gets a live check with Playwright (Chromium in the cloud container) at 1400x900 and 390x844, against a temp data dir.
