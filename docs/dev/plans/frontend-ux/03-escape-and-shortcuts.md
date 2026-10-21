# Step 3: Escape and shortcuts

Spec: `docs/dev/design/FRONTEND-UX.md`, Escape and Shortcuts. **Depends on step 2** (`Ctrl+S` uses the savers editors register with `useEditorSaver`).

## 1. The pure decision: `apps/web/src/keyboard/escape.ts`

```ts
export interface EscapeSituation {
  handled: boolean;        // event.defaultPrevented: a field already acted on it
  inDialog: boolean;       // the target is inside an open native <dialog> (it handles Escape itself)
  layers: number;          // open popovers/cards registered with useEscapeLayer
  inField: boolean;        // focus is in an input, textarea, select or contenteditable
}
export type EscapeStep = 'none' | 'layer' | 'leaveField' | 'area';
export function escapeStep(situation: EscapeSituation): EscapeStep;
```

The order: `handled` or `inDialog` gives `none`, then `layer`, then `leaveField`, then `area`. Write table tests in `keyboard/escape.test.ts`.

## 2. Layers and areas: `apps/web/src/keyboard/escapeRegistry.ts`

- `useEscapeLayer(open: boolean, close: () => void)`: while `open`, pushes `close` on a module-level stack and pops it on close or unmount. The newest layer closes first, using the latest `close` through a ref.
- `useEscapeArea(viewKey: ViewKey, handler: () => boolean)`: registers what Escape does in a layout view. The handler returns true when it did something. Several handlers per view key are tried newest first, so a page's inner handler runs before the default.
- `areaOf(element)`: the `data-view` of the closest `[data-view]` ancestor.
- The area of a key press is the focused element's view. If focus is on `body`, it falls back to the view of the last `pointerdown` (record it with a capture listener), so a click on a non-focusable part of a view still counts.

## 3. The listener: `apps/web/src/keyboard/useEscapeKey.ts`, called once in `Shell.tsx`

One `keydown` listener on `document` (bubble phase, so React's handlers, attached to the root, run first):
- Ignores anything but a plain `Escape`, and IME composition (`isComposing`, `keyCode === 229`).
- Builds the situation, then:
  - `layer` closes the newest layer;
  - `leaveField` focuses the field's view section;
  - `area` runs the area's handlers until one returns true.
- `Shell.tsx`: each view `<section className="view" data-view=…>` gets `tabIndex={-1}`, with no focus outline for that section only (CSS `section.view:focus { outline: none }`).

## 4. What each area does

| Area | Handler | Where |
|---|---|---|
| `chat` | the chat panel is open → close it; else `chat.busy` → `chat.stop()` (the composer's Escape: stops the reply or cancels a queued message); else nothing | `pages/Chat.tsx` (it owns `panelOpen`); check that `busy` is false while only an after-reply run is running (the spec forbids stopping that) and say so in the report |
| narrow editors (`editor:providers`, `editor:stateDefinitions`, `editor:characters`, `editor:personas`, `editor:collections`) | `closeEditor(resource)` (back to the list, the draft is kept); then focus the list's selected row if there is one, else the list's view section | default, registered in `Shell.tsx` for every narrow editor view |
| `editor:settings` | nothing (it has no list) | — |
| `editor:workflows` | a node is selected or the config panel is open → deselect / close it; else `closeEditor('workflows')` | inner handler in the workflow editor (`useWorkflowCanvas` holds `selected`), default in `Shell.tsx` |
| `editor:presets` | an entry is selected (`selectedEntryId`) → clear it; else `closeEditor('presets')` | inner handler in `pages/Presets.tsx`, default in `Shell.tsx` |
| lists | nothing | — |

Read `layout/derive.ts` (`VIEW_KEYS`) for the exact view keys, and use them; don't invent new ones. Closing a wide editor already keeps its draft (it stays mounted).

## 5. Fields that own Escape call `preventDefault()` when they act, and only then

- `pages/chat/Composer.tsx`: while `busy`, Escape stops (today's behaviour) and now also calls `event.preventDefault()`. When not busy it does nothing, so the field is left.
- `pages/chat/MessageEditor.tsx`: cancel the edit, plus `preventDefault()`.
- `packages/node-ui/src/panels/ModelPicker.tsx`: closing the open list calls `preventDefault()`; with the list closed, Escape is not handled.
- Check `packages/node-ui` and `apps/web` for other `Escape` handlers (`grep -rn "'Escape'"`) and apply the same rule.

## 6. One-off listeners become layers

`pages/chat/story/TurnChip.tsx` and `pages/chat/story/LinkMarker.tsx` replace their `document.addEventListener('keydown', …)` with `useEscapeLayer(open, () => setOpen(false))`. Closing by Escape returns focus to the button that opened the card. Keep their other behaviour (scrolling into view, outside clicks if any).

The native dialogs (`DialogHost`, `MobileMenu`) keep handling Escape themselves; the listener ignores events inside an open `<dialog>`.

## 7. Shortcuts: `apps/web/src/keyboard/shortcuts.ts`

- A declared table, the single source for a later help list:

  ```ts
  export const SHORTCUTS = [
    { keys: 'Escape', scope: 'global', description: 'Close the innermost thing (see docs/dev/design/FRONTEND-UX.md)' },
    { keys: 'Mod+S', scope: 'editor', description: 'Save the editor you are in' },
  ] as const;
  ```

- A pure `matchShortcut(event): 'save' | undefined`, where `Mod` is Ctrl, or Cmd on macOS (`metaKey`). Table tests.
- `Ctrl/Cmd+S`, handled in the same document listener (rename the hook `useKeyboard` if that reads better):
  - Always `preventDefault()` (never the browser's "save page").
  - If the area is an editor view `editor:<resource>`, call that resource's editor store saver (`ITEM_SOURCES` in `layout/useLayoutUrl.ts` maps resources to stores; move that map somewhere both can import if needed).
  - Otherwise do nothing. It works while typing in a field too.
  - The settings editor has no store. Leave it out.

## 8. Tests

- `escape.test.ts`: the decision table.
- `shortcuts.test.ts`: matching (Ctrl+S, Cmd+S, Shift+Ctrl+S is not save, a plain S is not).
- `escapeRegistry` tests: layers close newest first; an area's handlers run newest first and stop at the first true; unregistering works; `areaOf` on a nested element.
- Existing tests still pass, notably `pages/chat/chat.test.tsx` (`editorKeyAction`).

## 9. Docs

- `AGENTS.md`, under `apps/web`: a **Keyboard** bullet.
  - Escape goes through `keyboard/` (`escapeStep`, `useEscapeLayer`, `useEscapeArea`); never add a `document` keydown listener in a component.
  - A field that acts on Escape calls `preventDefault()`, and only when it acts.
  - Shortcuts are declared in `SHORTCUTS`.
- `README.md`: a short Keyboard section listing Escape and `Ctrl/Cmd+S`.
- `docs/dev/design/FRONTEND-UX.md` build order: mark step 3 done.

## Done when

- `npm run check` passes.
- No `document.addEventListener('keydown'` is left in components (`grep`).
- Live check (orchestrator):
  - type in a character field, Escape twice: the first leaves the field, the second goes back to the list with the draft kept;
  - Escape in the chat with the panel open closes it, and the next Escape stops a streaming reply;
  - Escape on the canvas with a node selected deselects it, and the next closes the workflow editor;
  - `Ctrl+S` in a dirty preset saves it.
