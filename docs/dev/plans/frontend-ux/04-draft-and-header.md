# Step 4: shared draft hook and editor header

Spec: `docs/dev/design/FRONTEND-UX.md`, Editors. **Depends on steps 2 and 3** (savers, `confirmSwitch`, Escape areas).

Every editor gets the same header, the same unsaved marker and the same actions. The simple editors also share one draft hook. No behaviour changes beyond what is listed here.

## Decision: who gets the shared draft hook

The editors differ a lot. Forcing all six onto one hook would change behaviour, which the spec rules out. So:

| Editor | `useDraft` | Why |
|---|---|---|
| Characters, personas (`useEntityEditor`) | yes | plain draft vs saved snapshot |
| Providers (`useProviderEditor`) | yes, if its file sync (`useFileSync`) maps onto `load`/`saved` without behaviour change; otherwise header only | |
| Presets (`pages/Presets.tsx`) | yes, if its live sync maps cleanly; otherwise header only | |
| Collections (`useCollectionEditor`) | header only | async load, text drafts, Discard re-reads from disk |
| State definitions (`useStateDefinitionEditor`) | header only | compiled text drafts, name lock |
| Workflows (`useWorkflowEditor`) | header only | the canvas holds the draft |

Write down in the report which way each "if" went.

## 1. `apps/web/src/pages/useDraft.ts`

```ts
export function useDraft<T extends { id: string }>(store: EditorStore<T>, options?: { key?(item: T): string }): {
  draft?: T;
  dirty: boolean;
  set(next: T): void;            // edit the draft
  load(item: T): void;           // a new saved item (open, after save, reload from disk): draft = saved = item
  clear(): void;
  revert(): void;                // draft = last saved
  saved?: T;
}
```

- `dirty` compares `key(draft)` with `key(saved)`; the default key is `JSON.stringify`. Keep the saved key memoized per load, not recomputed each render.
- It reports `(draft?.id, dirty)` to the store (`store.report`), like the editors do today.
- It does **not** apply store commands or register the saver. Editors keep calling `useEditorCommands` and `useEditorSaver` themselves, because their `open` and `save` differ.
- Tests: `pages/useDraft.test.ts`, rendered through a tiny component with `renderToStaticMarkup` or by testing the pure parts. Put the pure logic (dirty computation, revert) in a small pure module if hooks are hard to test here (check how other hooks are tested, e.g. `useSettingSaver.test.ts`).

## 2. `apps/web/src/components/EditorHeader.tsx` (+ `editor-header.css`)

```tsx
<EditorHeader
  back?={{ label: 'Back to characters', onClick }}     // narrow editors
  title={ReactNode}                                    // text, or the name input of wide editors
  dirty={boolean}                                      // shows "Unsaved changes"
  note?={ReactNode}                                    // read-only banner line (built-in provider, imported preset)
  extra?={ReactNode}                                   // page-specific buttons (workflow: Chat settings, Validate)
  actions={{ save?, revert?, duplicate?, remove? }}    // each { onClick, disabled?, title?, label? }
/>
```

- Order, left to right after the title and marker: `extra`, then **Save** (primary), **Revert**, **Duplicate**, **Delete**. An action that is `undefined` isn't rendered; read-only editors pass only what applies.
- The marker is the text `Unsaved changes` in a `.dirty-dot` span, everywhere. Tests that look for `Unsaved` keep passing.
- **Revert** is shown only while dirty. It asks nothing: the draft goes back to the saved state. The collections editor's **Discard** becomes this Revert, keeping its re-read-from-disk behaviour. Workflows and presets get Revert too: reload the saved item into the editor (workflows: through the same `load` that opening uses).
- Labels keep their current meaning: the state definition's "Duplicate…" keeps its ellipsis (it asks a name); disabled states and their `title` hints are kept.

## 3. Migrate each editor

One editor at a time, each keeping its tests green:
`EntityDetail` (characters and personas), `ProviderEditor`, `CollectionEditor`, `StateDefinitionEditor`, `PresetEditor` (its `.editor-toolbar` with the name input), and `WorkflowToolbar` (the name input as `title`; Chat settings and Validate in `extra`).

- Delete the per-page toolbar CSS that becomes unused, and keep page-specific layout CSS.
- `ImportedBanner` (presets) can stay as is or move into `note`; keep its Duplicate action.

## 4. Docs

- `AGENTS.md`, `apps/web` → `components/`: an **Editors** bullet. Every editor renders `EditorHeader`; simple ones use `useDraft`; the order of actions and the "Unsaved changes" marker are fixed there.
- `docs/dev/design/FRONTEND-UX.md`:
  - the Editors section: record the decision table above (which editors use `useDraft` and why the others don't);
  - the build order: mark step 4 done.

## Done when

- `npm run check` passes.
- Every editor shows the same marker text, and Revert appears while dirty.
- Live check (orchestrator): Revert on a character, a collection, a preset and a workflow restores the saved state.
