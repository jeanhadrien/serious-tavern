# Step 2: unsaved-work guard

Spec: `docs/dev/design/FRONTEND-UX.md`, Unsaved work. **Depends on step 1** (`dialogs.ask` in `components/dialog/dialogStore.ts`).

Today a list replaces a dirty draft without asking: `editorStore.open` names the new item clean, and the editor's `open` handler loads it (for example `useEntityEditor`'s `choose`). The tab also closes without warning.

## 1. The editor store asks before a switch: `apps/web/src/stores/editorStore.ts`

Add to `EditorStore<T>`:

```ts
/** Editor side: what the unsaved-work dialog offers. `label` names the open item; `save` resolves true once saved. */
setSaver(saver: { label(): string; save(): Promise<boolean> } | undefined): void;
/**
 * List side: resolves true when the editor may open `nextId` now. True at once when `nextId` is the open item or
 * the draft is clean; otherwise asks Save / Discard / Cancel.
 */
confirmSwitch(nextId?: string): Promise<boolean>;
```

- `createEditorStore<T>(ask = dialogs.ask.bind(dialogs))`: the dialog function is injectable, for the tests.
- The dialog: title `Save changes to "<label>"?`, body `You have unsaved changes. Opening something else replaces them.`. Actions: `{ id: 'save', label: 'Save', kind: 'primary' }` (only when a saver is registered) and `{ id: 'discard', label: 'Discard changes', kind: 'danger' }`; `cancelLabel: 'Cancel'` (Decision, orchestrator: was "Keep editing", but Cancel leaves a narrow editor's list on screen, so the label promised too much). With no saver, the label is `the open item`.
- `save`: `await saver.save()`; true resolves true, false resolves false (a failed save already toasts). `discard` resolves true: the `open` that follows replaces the draft, as today. `cancel` resolves false.
- `confirmSwitch()` with no argument means "something else replaces the open item" (create, import).
- Add a hook `useEditorSaver(store, saver)` that registers the latest saver (through a ref, so a new function each render doesn't re-register) and unregisters on unmount.
- `open`, `discard`, `report` and `useEditorCommands` don't change. **The guard is the callers' job:** `await confirmSwitch(id)` before `open`.

## 2. Every editor registers its saver

Each `save` must resolve `Promise<boolean>`: true when saved, false on validation failure, API error or read-only. Change the return values without changing anything else they do.

| Editor | Save lives in | Label |
|---|---|---|
| Characters, personas | `pages/entities/useEntityEditor.ts` | `draft.name` |
| Providers | `pages/providers/useProviderEditor.ts` | the draft's name |
| Collections | `pages/collections/useCollectionEditor.ts` (`saveCollection` resolves undefined on failure) | the draft's name |
| State definitions | `pages/stateDefinitions/useStateDefinitionEditor.ts` (`saveStateDefinition` returns a `SaveOutcome`) | the draft's name |
| Presets | `pages/Presets.tsx` `save` | the draft's name |
| Workflows | `pages/workflows/useWorkflowEditor.ts` `save` (already `Promise<boolean>`) | the draft's name |

## 3. Every path that replaces the open item asks first

Before each of these, `if (!(await <store>.confirmSwitch(id))) return;`. It goes **before** any server write or layout change, so Cancel leaves everything (draft, URL, layout) untouched.

| Call site | What it does |
|---|---|
| `pages/providers/ProviderListView.tsx` (`providerEditorStore.open`) | open from the list |
| `pages/workflows/WorkflowList.tsx` (`open`, `create`) | open, create |
| `pages/workflows/workflowActions.ts` (duplicate → `open(copy)`) | duplicate (ask before duplicating) |
| `pages/presets/PresetListView.tsx` | open from the list |
| `pages/presets/presetActions.ts` (create, duplicate) | ask before creating or duplicating |
| `pages/entities/EntityListView.tsx` (`open`, `create`, `importFiles`) | open, create, import (`confirmSwitch()`) |
| `pages/stateDefinitions/stateDefinitionActions.ts` (`showStateDefinition` and its callers; create/duplicate if any) | open, link |
| `pages/collections/collectionActions.tsx` `openCollection` (+ create/duplicate if any) | ask before fetching |
| `layout/useLayoutUrl.ts` `openItem` | only for a link (not `fromHistory`, which already never discards): ask before `source.editor.open`; on Cancel return, and the URL is written back to what is shown |
| Duplicate buttons inside editors (provider, state definition, …) that open the copy | ask before duplicating |

Check with `grep -rn "EditorStore.open(\|editorStore.open(" apps/web/src` that every caller is covered, plus editors' own local open/choose paths reached from a button (duplicate, import onto the editor). An import dropped onto a dirty editor already keeps the draft (`useEntityEditor.importFiles`); leave that.

If the same item is clicked again (`nextId === currentId`), nothing is asked, as today.

## 4. Warn before closing or reloading the tab

`apps/web/src/layout/useUnsavedWarning.ts`: `useUnsavedWarning(dirty: boolean)` adds a `beforeunload` listener only while `dirty` (`event.preventDefault(); event.returnValue = '';`). `Shell.tsx` calls it with its existing `anyDirty`.

## 5. Tests

- `stores/editorStore.test.ts`, table-driven with a fake `ask`:
  - same id → true, no dialog;
  - clean → true, no dialog;
  - dirty + save (saver true) → true, the saver is called once;
  - dirty + save (saver false) → false;
  - dirty + discard → true;
  - dirty + cancel → false;
  - no saver → the dialog offers only Discard, and its title uses `the open item`;
  - `confirmSwitch()` (no id) while dirty asks.
- `useUnsavedWarning`: a small test that the listener is added only while dirty (a fake `window` or `vi.spyOn(window, 'addEventListener')`). Skip it if the test environment has no `window` (check what other web tests do); the pure logic is trivial.

## 6. Docs

- `AGENTS.md`, the editor store bullet under `layout/`: callers ask `confirmSwitch(id)` before `open`; editors register a saver with `useEditorSaver`; Cancel must leave everything untouched (ask before any write or layout change).
- `README.md`: one sentence where the web editors are described.
- `docs/dev/design/FRONTEND-UX.md` build order: mark step 2 done.

## Done when

- `npm run check` passes.
- Live check (orchestrator):
  - edit a character, then click another: Cancel keeps the draft; Discard opens the other one; Save saves, then opens it;
  - the same with a preset (a wide editor);
  - reloading with a dirty draft shows the browser's warning.
