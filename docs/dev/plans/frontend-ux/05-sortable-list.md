# Step 5: SortableList (dnd-kit)

Spec: `docs/dev/design/FRONTEND-UX.md`, Drag and drop. One reorderable list component, built on dnd-kit, used by every reorderable list in `apps/web`.

## Decision: node-ui's collection picker keeps its buttons

The fifth reorderable list is the Recall/Draw collection picker (`packages/node-ui/src/panels/CollectionPicker.tsx`). node-ui can't import from `apps/web`, and the picked list is short and rarely reordered. It keeps its up/down buttons and gains `Alt+↑/↓` on its rows, but no drag. Record this in `docs/dev/design/FRONTEND-UX.md`.

## 1. Dependencies

Add to `apps/web/package.json` (`npm install -w @st/web …`):
- `@dnd-kit/core@^6.3.1`
- `@dnd-kit/sortable@^10.0.0`
- `@dnd-kit/utilities` (for `CSS.Transform`), only if needed

Check the lockfile diff is limited to these. knip must stay green.

## 2. `apps/web/src/components/sortable/`

- `moveItem.ts`: `moveItem<T>(list: readonly T[], from: number, to: number): T[]`. Pure, returns a new array, out-of-range or `from === to` returns a copy unchanged. Table tests.
- `SortableList.tsx`: the only file that imports dnd-kit.

  ```tsx
  <SortableList
    items={T[]}
    getId={(item: T) => string}          // stable for the life of the draft
    onMove={(from: number, to: number) => void}
    disabled?={boolean}                   // read-only lists render rows without handles
    label={(item: T) => string}           // for the handle's aria-label: "Drag to reorder <label>"
    renderItem={(item: T, row: { index: number; handle: ReactNode; moveUp?: () => void; moveDown?: () => void }) => ReactNode}
  />
  ```

  - Sensors: `PointerSensor` with `activationConstraint: { distance: 4 }` (clicks on the row still work), and `KeyboardSensor` with `sortableKeyboardCoordinates`.
  - `handle` is a button with the lucide `GripVertical` icon (`aria-label` + `title`). The listeners go on it, and CSS `touch-action: none` on it only, so touch scrolling still works on the rest of the row.
  - Vertical lists only: `verticalListSortingStrategy`.
  - `Alt+ArrowUp` / `Alt+ArrowDown` on any focused element inside a row (not inside a text field: `input`, `textarea`, `select`, contenteditable) calls `onMove(index, index ± 1)`, `preventDefault()`, and keeps focus on the moved row.
  - `moveUp`/`moveDown` are given to `renderItem` (undefined at the ends), so rows keep their up/down buttons through one code path.
  - Screen-reader announcements: dnd-kit's defaults are fine; give `accessibility.screenReaderInstructions` a one-line text.
- `sortable.css`: handle and dragging-row styles only (an outline or reduced opacity while dragging; no animation beyond dnd-kit's transform).

## 3. The four lists in `apps/web`

| List | File | Today |
|---|---|---|
| Preset entries | `pages/presets/PresetEntryList.tsx` | HTML5 drag-and-drop + up/down; `reorderEntries`/`moveEntry` |
| Collection entries | `pages/collections/CollectionEntryList.tsx` | up/down (`onMoveEntry`) |
| Provider overrides | `pages/providers/ProviderFields.tsx` | up/down (`move(index, ±1)`) |
| Workflow chat settings | `pages/workflows/SettingRow.tsx` and its parent | up/down (`onMove(±1)`) |

- Each keeps its up/down buttons (now wired through `moveUp`/`moveDown`) and its existing move logic or `moveItem`.
- **Preset entries:** remove the HTML5 drag-and-drop code (the `draggable` attributes, `onDragStart`/`onDragOver`/`onDrop`, `dropTarget` state, `belowMidpoint`, `dropAtEnd`). Keep `moveEntry` if it is still used, else delete it and its tests. Imported (read-only) presets have no handles (`disabled`); the existing test that expects `draggable="false"` changes to assert no handle is rendered.
- **Stable ids:** `getId` must not change while dragging. Preset entries have ids. For rows without one (collection entries, whose ids are positions; provider overrides; setting rows), use the draft's local uid if there is one. If there is none, add a draft-local uid that is never sent to the server, and check the dirty comparison ignores it (`collectionDraft.ts`, `providerDraft.ts`, `settingsDraft.ts`).
- Selection that follows an item (the preset's selected entry, the collection's open entry) must follow it after a move, as the up/down buttons do today.

## 4. node-ui collection picker

`packages/node-ui/src/panels/CollectionPicker.tsx`: `Alt+ArrowUp/Down` on a focused row's buttons moves it, through the same handler as its up/down buttons. No new dependency in node-ui.

## 5. Tests

- `moveItem.test.ts` (table).
- SSR test of `SortableList`: rows render through `renderItem`, handles carry their labels, and `disabled` renders no handle.
- Adjust `ImportedPreset.test.tsx` and any test that relied on HTML5 drag attributes.
- The Alt+arrow handler as a pure function (`keyMove(event, index, length) → target index | undefined`), with table tests.

## 6. Docs

- `AGENTS.md`, `apps/web` → `components/`: a **Reordering** bullet. Lists reorder only through `components/sortable/SortableList` (never import dnd-kit elsewhere), keep up/down buttons, and need stable draft ids.
- `README.md`: where the preset editor's drag reorder is described, say it uses SortableList (handle, keyboard, touch).
- `docs/dev/design/FRONTEND-UX.md`:
  - the Drag and drop section: the node-ui decision above;
  - the build order: mark step 5 done.

## Done when

- `npm run check` passes.
- No HTML5 `draggable` reordering is left (`grep -rn "draggable\|onDragStart" apps/web/src`; the node palette's drag onto the canvas stays, it is not a reorder).
- Live check (orchestrator) at 1400x900 and 390x844:
  - drag a preset entry by its handle with the mouse, and with touch emulation on the phone size;
  - `Alt+↓` moves a collection entry;
  - the up/down buttons still work.
