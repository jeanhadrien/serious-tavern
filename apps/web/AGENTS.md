# apps/web — agent notes

React 19 + Vite, a thin client over the API. Layout design: `docs/dev/design/FRONTEND-LAYOUT.md`; interaction behaviour (Escape, shortcuts, unsaved work, confirmations, drag and drop, resizing): `docs/dev/design/FRONTEND-UX.md`. The chat, story state, workflow editor and definitions editor have their own notes under `src/pages/`.

## API and alerts
- Pages call the typed clients in `api/`, never raw paths. Non-2xx responses become an `ApiError` and are toasted automatically; pass `{ silent: true }` when handling the error inline.
- The client sets `Content-Type: application/json` only when there is a body: Fastify rejects an empty JSON body.
- Raise notifications with `alerts.error|success|info|warning(...)`; it works outside React too.

## Lists and editors
- **List stores** (`createListStore`, read with `useList`) re-fetch on their change event. Pages read lists from them and never keep their own copies. After a local write, call `store.refresh()` to read your own write. Drafts and the open chat session stay local state that a list refresh never touches.
- The preset, workflow and chat lists are ordered with `compareRecent` (`updatedAt` desc, then `createdAt` desc, then name).
- A resource's list and its editor are separate views that share an **editor store** (open id, dirty flag, the list's `open`/`discard` requests, applied by the editor through `useEditorCommands`).
  - `open` of another item names it as `currentId` at once: the editor applies the request in an effect, and without this the render in between wrote the previous item into the URL. An editor's `open` handler must therefore always load the item.
  - **Unsaved-work guard:** `open` never asks; its callers do. Every path that replaces the open item (list click, create, duplicate, import, a link) starts with `if (!(await store.confirmSwitch(id))) return;` (`confirmSwitch()` with no id for create and import), **before any server write or layout change**, so Cancel leaves draft, URL and layout untouched.
  - Each editor registers `{ label, save }` with `useEditorSaver` (`save` resolves true only when saved; a failed save has already toasted) so the dialog can offer Save. Back/Forward never asks, because it never discards. The shell warns on tab close or reload while any editor is dirty.
- **Every editor renders `EditorHeader`:** back for narrow editors, the title or a name input, `Unsaved changes` in a `.dirty-dot` span, `extra` buttons, then Save, Revert, Duplicate, Delete in that fixed order. An action left out isn't rendered; Revert shows only while dirty and asks nothing. Never write a per-page toolbar.
- Characters, personas and presets keep their draft in `useDraft` (draft plus saved snapshot). It doesn't apply store commands or register the saver: the editor does. Providers, collections, state definitions and workflows use only the header, since their drafts aren't a plain copy of the saved item. Their Revert: providers and definitions rebuild from the saved record (a refused rename stays locked), collections re-read from disk, workflows reload the last loaded or saved workflow.
- The disk sync of the provider, collection and definition editors is one hook, `useFileSync`, over the generic own-save-echo classifier `classifyDraftChange`. A server write is announced before its response arrives, so a dirty draft the disk already holds is a reload, and the editor's own delete is not "removed from disk". The preset editor never overwrites a dirty draft and keeps the selected entry by position (entry ids are re-derived on read).
- **Collections:** open one through `openCollection`, which fetches the whole record before switching the editor (the list only has summaries; switching first shows the previous collection and pushes a wrong history entry). Editors re-read the whole record on every `collections.changed`. A save answered `404` recreates the collection only after the user agrees: the file may exist but no longer parse, and a new id would leave Recall/Draw nodes on the old one.

## The layout shell
- `layout/state.ts` is a pure reducer (slot rules, wide vs narrow editors, compact and phone modes, dirty flags) and `derive.ts` maps it to placements and header icons. Change rules there, with tests, never in components.
- **`Shell.tsx` mounts every view exactly once, in the fixed `VIEW_KEYS` order.** Moving a view only changes its `grid-area`, hiding it sets `hidden`, so nothing remounts (streams, drafts, canvases survive). Never render a view conditionally or in a different position.
- `useChat` lives in the shell and re-renders it on every streamed token. Views that take no props are module-level constants (`STATIC_VIEWS`, with `DIRTY_SOURCES`) so React skips them; keep new views stable the same way, or memoize them.
- Providers and state definitions are narrow editors with their list in **L**; characters, personas and collections have theirs in **R**.
- **The layout lives in the URL** (`/?session=…&left=…&wide=preset:<id>&right=character:<id>`, defaults omitted; a narrow editor in L is `left=<name>:<id>`). The pure (de)serializers are in `layout/url.ts`, and `useLayoutUrl` syncs both directions. Content changes `push`; tab switches and corrections `replace`. Build in-app links with `layoutHref`.
- Legacy paths (`/presets?id=…`, `/workflows?workflow=…&edge=…`, `/collections?id=…`, `/state-definitions?id=…`, …) stay as inbound aliases in `layout/routes.ts`, because node-ui's "Edit …" links emit them.
- History navigation never discards a dirty draft or switches a streaming chat.

## Shared UI building blocks
- **Dialogs:** every question goes through `dialogs.ask({ title, body, actions, cancelLabel })` or `confirmDelete(title, body?)`, shown by the one `<DialogHost/>` (native modal `<dialog>`, Cancel focused first, Escape and the backdrop cancel, questions queue). Never call `window.confirm`. Deleting something stored asks; edits inside a draft don't.
- **Keyboard:** `useKeyboard` (called once in `Shell`) is the app's one `document` keydown listener; never add another.
  - Escape does one thing, chosen by the pure `escapeStep`: a field that acted, then an open `<dialog>` (it handles itself), then the newest layer, then leaving a field, then the area.
  - Popovers and cards register with `useEscapeLayer(open, close)`. A view's Escape is `useEscapeArea(viewKey, handler, fallback?)`: handlers newest first, the first to return true wins; `fallback: true` runs after all others (that is how every editor view gets its "close the editor" default under the pages' handlers).
  - The area is the focused element's `section.view[data-view]` (after a click on a non-focusable part, the last pointer press's view); a hidden view never has it.
  - A field that acts on Escape calls `event.preventDefault()`, and only when it acts.
  - `Ctrl/Cmd+S` always suppresses the browser's save and calls the focused editor's registered saver (only for an open dirty draft).
  - Shortcuts are declared in `SHORTCUTS` with the pure `matchShortcut`. **Area shortcuts** (undo, redo) and the native `copy`/`paste` events go to the view with the keyboard through `useShortcutArea(viewKey, handlers)`: handlers newest first, a handler returns true when it acted and only then is `preventDefault` called. `areaShortcutAllowed` keeps them out of fields (the browser's text undo works there), open dialogs and keys a field already handled. A new area shortcut is a `matchShortcut` result, an `AreaShortcut` member, a `SHORTCUTS` entry and a handler name in `useShortcutArea`.
- **Reordering:** a list reorders only through `components/sortable/SortableList`; never import dnd-kit anywhere else.
  - Keep the up/down buttons (the row's `moveUp`/`moveDown`). `Alt+↑/↓` on a focused row is handled in the row (`keyMove`), not in `keyboard/`.
  - Ids must be stable for the life of the draft: `getId(item, index)` returns the item's own id, or one from `useRowIds` (kept beside the list, never in the draft, so never sent and never dirty).
  - `useCallback` a row's `renderItem`/`label` so unchanged rows skip rendering. Read-only lists pass `disabled`.
- **Resizing:** every resizable divider is the one `Splitter` (pointer drag, arrows by `step`, double-click `onReset`; it owns no size). A remembered size is `useStoredSize(key, { initial, min, max })` (`st.size.<key>` in `localStorage`, guarded; only the user's own value is stored). A stored size reaches CSS as a custom property that only the side-by-side rules read; the stacked and overlay layouts ignore it and hide the splitter. **Never add a splitter to a stacked or overlay layout.**
- **Comboboxes** (Biome a11y): options are `div role="option" tabIndex={-1}` inside a `div role="listbox"` (an `li` fails `noNoninteractiveElementToInteractiveRole`). Each option needs `onMouseDown={e => e.preventDefault()}`, or the input's blur closes the list before the click lands.

## Conventions
- `pages/<area>/` holds components and hooks per page. Keep files focused, roughly under 250 lines. Page components take explicit, minimal props interfaces (never a whole hook result); the page file is a thin composition.
- `components/` holds shared UI pieces. Page-specific styles live next to the page (`pages/chat/chat.css`), not in `style.css`.
- Icons: `lucide-react` only. Icon-only buttons need `aria-label` and `title`.
- Markdown: `react-markdown` + `remark-gfm` with `skipHtml`. **Never render raw HTML from message content** (no `rehype-raw`).
- SSR tests (`renderToStaticMarkup`) don't run effects: a hook's initial state must already be right without them.
- Live checks in the built-in browser pane: when the app window isn't in front, the pane has a 0px viewport, never paints, and ResizeObservers don't fire. Force a size with `resize_window`, and don't trust React Flow measurements or screenshots there.
