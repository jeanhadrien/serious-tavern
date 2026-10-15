import { useEffect, useRef, useState } from 'react';
import type { Collection, CollectionSummary } from '@st/shared';
import { ApiError, collectionsApi } from '../../api.js';
import { useLayoutActions } from '../../layout/LayoutActions.js';
import { collectionEditorStore, collectionsStore, useEditorCommands } from '../../stores/index.js';
import { startFileLiveSync } from '../fileLiveSync.js';
import { deleteCollection, saveCollection } from './collectionActions.js';
import {
  classifyCollectionChange,
  draftChanged,
  draftToBody,
  moveEntry,
  newEntry,
  toDraft,
  type CollectionDraft,
  type EntryDraft,
} from './collectionDraft.js';

const COLLECTIONS = {
  event: 'collections.changed',
  noun: 'collection',
  removedHint: 'Saving will fail; create a new collection and copy your changes into it.',
} as const;

/** The whole collection: the list only has summaries, and hand edits keep `updatedAt`, so it is always re-read. */
async function readOpen(id: string): Promise<Collection[]> {
  try {
    return [await collectionsApi.get(id, { silent: true })];
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return [];
    throw error;
  }
}

/**
 * The open collection, its draft and the expanded entry. The editor stays mounted while hidden, so the draft
 * survives the back arrow. The list opens collections through `collectionEditorStore`; edits made on disk reload
 * a clean draft (keeping the expanded entry by position) and never replace a dirty one.
 */
export function useCollectionEditor() {
  const { closeEditor } = useLayoutActions();
  const [collection, setCollection] = useState<Collection>();
  const [draft, setDraft] = useState<CollectionDraft>();
  const [selected, setSelected] = useState<number>();
  const [errors, setErrors] = useState<string[]>([]);
  const dirty = !!collection && !!draft && draftChanged(draft, collection);

  const load = (item: Collection, keepSelection = false) => {
    setCollection(item);
    setDraft(toDraft(item));
    setErrors([]);
    setSelected((current) =>
      keepSelection && current !== undefined && item.entries.length
        ? Math.min(current, item.entries.length - 1)
        : undefined,
    );
  };
  const clear = () => {
    setCollection(undefined);
    setDraft(undefined);
    setSelected(undefined);
    setErrors([]);
  };
  // Only the latest open request applies, so a slow response never replaces a later choice.
  const request = useRef(0);
  const open = (item: CollectionSummary | Collection) => {
    const current = ++request.current;
    if ('entries' in item) return load(item);
    void collectionsApi
      .get(item.id)
      .then((full) => current === request.current && load(full))
      .catch(() => {}); // toasted
  };

  const openId = collection?.id;
  useEffect(() => collectionEditorStore.report(openId, dirty), [openId, dirty]);
  useEditorCommands(collectionEditorStore, {
    open,
    close: (id) => {
      if (collection?.id === id) clear();
    },
  });

  const latest = useRef({ collection, draft });
  latest.current = { collection, draft };
  // Collection writes are announced before their response arrives, so the sync must not report this editor's
  // own delete as "removed from disk". Ids are never reused, so it is not reset after a successful delete.
  const deleting = useRef<string>(undefined);
  useEffect(
    () =>
      startFileLiveSync<Collection>(COLLECTIONS, () => {
        const editor = latest.current;
        const baseline = editor.collection ? JSON.stringify(toDraft(editor.collection)) : '';
        const id = editor.collection?.id;
        return {
          signature: () => [id ?? '', deleting.current ?? '', baseline].join('\n'),
          refresh: async () => {
            await collectionsStore.refresh().catch(() => {});
            return id ? readOpen(id) : [];
          },
          classify: (fresh) =>
            classifyCollectionChange({ ...editor, deleting: !!id && deleting.current === id }, fresh),
          openName: () => editor.collection?.name ?? '',
          onReload: (item) => load(item, true),
          onClose: () => {
            clear();
            closeEditor('collections');
          },
        };
      }),
    [],
  );

  const change = (next: CollectionDraft) => {
    setDraft(next);
    setErrors([]);
  };
  const setEntries = (update: (entries: EntryDraft[]) => EntryDraft[]) => {
    setDraft((current) => current && { ...current, entries: update(current.entries) });
    setErrors([]);
  };
  const updateEntry = (index: number, patch: Partial<EntryDraft>) =>
    setEntries((entries) => entries.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)));
  const addEntry = () => {
    if (!draft) return;
    setEntries((entries) => [...entries, newEntry()]);
    setSelected(draft.entries.length);
  };
  const removeEntry = (index: number) => {
    setEntries((entries) => entries.filter((_, at) => at !== index));
    setSelected((current) =>
      current === undefined || current === index ? undefined : current > index ? current - 1 : current,
    );
  };
  const moveEntryBy = (index: number, offset: number) => {
    if (!draft) return;
    const to = index + offset;
    if (to < 0 || to >= draft.entries.length) return;
    setEntries((entries) => moveEntry(entries, index, to));
    setSelected((current) => (current === index ? to : current === to ? index : current));
  };

  const save = async () => {
    if (!collection || !draft) return;
    const result = draftToBody(draft);
    if (!result.ok) return setErrors(result.errors);
    const saved = await saveCollection(collection.id, result.body);
    if (saved) load(saved, true);
  };
  const discard = () => collection && load(collection, true);
  const remove = async () => {
    if (!collection || !window.confirm(`Delete collection "${collection.name}"?`)) return;
    deleting.current = collection.id;
    if (!(await deleteCollection(collection))) {
      deleting.current = undefined;
      return;
    }
    clear();
    closeEditor('collections');
  };
  return {
    draft,
    dirty,
    errors,
    selected,
    select: (index: number | undefined) => setSelected(index),
    change,
    updateEntry,
    addEntry,
    removeEntry,
    moveEntry: moveEntryBy,
    save,
    discard,
    remove,
    back: () => closeEditor('collections'),
  };
}
