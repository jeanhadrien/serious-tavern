# Step 1: confirm dialog

Spec: `docs/FRONTEND-UX.md`, Confirmations. Goal: one dialog building block, which replaces every `window.confirm` and adds the missing confirmation on deleting a chat.

A draft of this step may exist in the container as `git stash list` → "step 1 confirm dialog". If it does, `git stash apply` it and check it against this plan instead of starting over. Its known defect is a type error in `ChatSidebar.tsx` (a `.then` callback returning `false | Promise`). If the stash is gone, build from this plan.

## 1. The store: `apps/web/src/components/dialog/dialogStore.ts`

```ts
export const CANCEL = 'cancel';
export interface DialogAction<A extends string = string> { id: A; label: string; kind?: 'primary' | 'danger' }
export interface DialogOptions<A extends string> {
  title: string;
  body?: ReactNode;                 // text or structure
  actions: readonly DialogAction<Exclude<A, typeof CANCEL>>[];  // shown after Cancel, in order
  cancelLabel?: string;             // default 'Cancel'
}
export interface DialogRequest extends DialogOptions<string> { id: number }
export class DialogStore {
  getSnapshot(): DialogRequest | undefined;   // the oldest pending request
  subscribe(listener): () => void;
  ask<A extends string>(options: DialogOptions<A>): Promise<A | typeof CANCEL>;
  answer(id: number, action: string): void;   // ignored unless id is the shown request and action is CANCEL or offered
}
export const dialogs = new DialogStore();
export async function confirmDelete(title: string, body: ReactNode = "This can't be undone."): Promise<boolean>;
```

- Follow the pattern of `alerts/store.ts`: a class with `subscribe`/`getSnapshot`, usable outside React.
- Requests queue: asking while one is shown waits its turn (FIFO). Notify listeners only when the shown request changes.
- `confirmDelete` asks with one action `{ id: 'delete', label: 'Delete', kind: 'danger' }` and resolves `true` only for it.

## 2. The host: `apps/web/src/components/dialog/DialogHost.tsx` + `dialog.css`

- `DialogHost({ store = dialogs })` reads the store with `useSyncExternalStore` and renders one native `<dialog className="confirm-dialog" aria-labelledby="confirm-dialog-title">`.
- In an effect: when a request appears, remember `document.activeElement`, call `showModal()` if not open, and focus the Cancel button (by ref; don't use `autoFocus`, Biome forbids it). When no request is left, `close()` and give focus back to the remembered element if it is still connected.
- `onCancel` (Escape): `preventDefault()` (the store decides when to close, so a queued question isn't skipped), then answer `CANCEL`. A click on the backdrop (`event.target === event.currentTarget`) also answers `CANCEL` (copy the `biome-ignore` comment pattern from `layout/MobileMenu.tsx`).
- The content is a child component keyed by `request.id`: `<h2 id="confirm-dialog-title">`, then the body (a string becomes `<p>`; anything else is rendered as is) in `.confirm-dialog-body`, then `.confirm-dialog-actions`: the Cancel button first (label `cancelLabel ?? 'Cancel'`), then one `<button className={action.kind}>` per action.
- CSS: plain and dark, like `style.css`. Width `min(480px, calc(100vw - 32px))`, body scrolls past `50vh`, actions wrap and sit on the right, `button.danger` red (it doesn't exist yet; `button.primary` does).
- Mount `<DialogHost />` once in `apps/web/src/main.tsx`, right after `<Toaster />`.

## 3. Replace every `window.confirm`

| Where | Becomes |
|---|---|
| `pages/presets/presetActions.ts` `deletePreset` | `confirmDelete(\`Delete preset "${name}"?\`)` |
| `pages/workflows/WorkflowList.tsx` `remove` | `confirmDelete(\`Delete workflow "${name}"?\`)` |
| `pages/entities/useEntityEditor.ts` `remove` | `confirmDelete(\`Delete ${kind.label.toLowerCase()} "${name}"?\`)` |
| `pages/providers/useProviderEditor.ts` `remove` | `confirmDelete(\`Delete provider "${name}"?\`)` |
| `pages/stateDefinitions/useStateDefinitionEditor.ts` `remove` | `confirmDelete(\`Delete state definition "${name}"?\`)` |
| `pages/collections/useCollectionEditor.ts` `remove` | `confirmDelete(\`Delete collection "${name}"?\`)` |
| `pages/collections/collectionActions.ts` `confirmRecreate` | `dialogs.ask` (below); rename the file to `.tsx` for the JSX body |
| `pages/chat/MessageActions.tsx` via `story/deleteConfirm.ts` | the dialog (below); rename to `.tsx` |

Afterwards `grep -rn "window.confirm" apps packages --include=*.ts --include=*.tsx` must find nothing.

**Collection recreate** (`confirmRecreate(name): Promise<boolean>`): title `Save "<name>" as a new collection?`; body paragraphs (keep the meaning of today's text): it can't be found on disk (deleted, or its file can no longer be read; see any invalid collection file warning); Recall and Draw nodes using the old one will not use the new one; to keep editing instead, fix the file, then save again. Action `{ id: 'recreate', label: 'Save as new collection', kind: 'primary' }`, `cancelLabel: 'Keep editing'`. `saveCollection`'s `confirm` parameter becomes `(name) => Promise<boolean>`, awaited. Update `collectionActions.test.ts` mocks to async.

**Reply delete that undoes story state** (`story/deleteConfirm.tsx`):
- `UndoneByDelete({ lines, note })`: `<p>Deleting this reply also undoes what its turn stored:</p>`, a `<ul>` of the lines, then `<p>{note}</p>` when there is one.
- `deleteClick(undone, note?, confirm = confirmUndoingDelete): Promise<'inline' | 'delete' | 'cancel'>`: no lines is `'inline'` without asking; otherwise it asks. `confirmUndoingDelete` asks with title `Delete the reply?`, the `UndoneByDelete` body and action `{ id: 'delete', label: 'Delete reply', kind: 'danger' }`.
- `deleteConfirmText` goes away. `MessageActions` awaits `deleteClick(undoOnDelete?.(), deleteNote)`; the inline step for ordinary deletes stays as it is.
- Rewrite `deleteConfirm.test.ts` as `.test.tsx`: the same cases with async mocks, plus `renderToStaticMarkup` checks of `UndoneByDelete` (list, then note after the list).

## 4. New: confirm deleting a chat

`pages/chat/ChatSidebar.tsx`: the trash button asks `confirmDelete(\`Delete chat "${title}"?\`, "Its messages and story state are deleted with it. This can't be undone.")` and only then calls `onDelete(id)`. Write the `.then` callback with a block body (no value returned).

## 5. Tests: `components/dialog/dialogStore.test.tsx`

- Resolves with the chosen action, and nothing is shown afterwards.
- Resolves `CANCEL` when dismissed.
- Two questions asked together: shown one at a time, oldest first; listeners notified once when the first is asked.
- Ignores an answer to another id, or naming an action not offered.
- `renderToStaticMarkup(<DialogHost store={store} />)`: title in the `h2`, a text body as `<p>`, Cancel (with `cancelLabel`) before the action buttons, `class="danger"` on a danger action. With nothing asked: an empty `<dialog>`.

## 6. Docs

- `AGENTS.md`, under `apps/web` → `components/`: add a **Dialogs** bullet. Every question goes through `dialogs.ask` or `confirmDelete`, shown by the one `<DialogHost/>` in `main.tsx` (native modal, Cancel focused, Escape and backdrop cancel, questions queue). Never call `window.confirm`. When to ask is in `docs/FRONTEND-UX.md`.
- `AGENTS.md` and `README.md`: replace every mention of `window.confirm` (the collection 404 recreate, the reply delete) and the renamed files (`collectionActions.tsx`, `deleteConfirm.tsx`).
- `docs/FRONTEND-UX.md` build order: mark step 1 done (deleting a chat now asks too).

## Done when

- `npm run check` passes.
- No `window.confirm` is left.
- Live check (orchestrator): delete a preset, cancel with Escape, then confirm; delete a chat; Escape returns focus to the trash button.
