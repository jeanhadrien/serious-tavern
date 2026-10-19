import { useEffect, useMemo, useRef, useState } from 'react';
import type { Collection, CollectionSummary } from '@st/shared';
import { ApiError, collectionsApi } from '../../api.js';
import { useLayoutActions } from '../../layout/LayoutActions.js';
import { collectionEditorStore, collectionsStore, useEditorCommands, useEditorSaver } from '../../stores/index.js';
import { useFileSync } from '../useFileSync.js';
import { deleteCollection, saveCollection } from './collectionActions.js';
import {
  classifyCollectionChange,
  draftChanged,
  draftToBody,
  moveEntry,
  newEntry,
  storedForm,
  toDraft,
  type CollectionDraft,
  type EntryDraft,
} from './collectionDraft.js';
import { selectionAfterLoad, selectionAfterMove, selectionAfterRemove } from './entrySelection.js';
import { confirmDelete } from '../../components/dialog/dialogStore.js';

const COLLECTIONS = {
  event: 'collections.changed',
  noun: 'collection',
  removedHint: 'Saving will ask whether to create it as a new collection.',
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
  // True while a collection named by a summary (a URL) is being fetched: the previous one is not shown meanwhile.
  const [loading, setLoading] = useState(false);
  // True while a save is in flight: a second click must not send another (after a 404, it would create twice).
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // Per load, not per keystroke: normalizing a large lorebook is not free.
  const stored = useMemo(() => collection && storedForm(collection), [collection]);
  const dirty = useMemo(
    () => !!collection && !!draft && draftChanged(draft, collection, stored),
    [draft, collection, stored],
  );

  const load = (item: Collection, keepSelection = false) => {
    setLoading(false);
    setCollection(item);
    setDraft(toDraft(item));
    setErrors([]);
    setSelected((current) => selectionAfterLoad(current, item.entries.length, keepSelection));
  };
  const clear = () => {
    setLoading(false);
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
    // A summary (a URL naming a collection): never show the previous collection while this one loads. The list
    // and the node panels fetch first (`openCollection`), so only URL navigation takes this path.
    setLoading(true);
    void collectionsApi
      .get(item.id)
      .then((full) => current === request.current && load(full))
      .catch(() => current === request.current && clear()); // toasted
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
  const deleting = useFileSync<Collection, CollectionDraft>({
    resource: COLLECTIONS,
    item: collection,
    draft,
    baseline: (item) => JSON.stringify(toDraft(item)),
    refresh: async (id) => {
      await collectionsStore.refresh().catch(() => {});
      return id ? readOpen(id) : [];
    },
    classify: ({ item, draft: current, deleting: own }, fresh) =>
      classifyCollectionChange({ collection: item, draft: current, deleting: own }, fresh),
    onReload: (item) => load(item, true),
    onClose: () => {
      clear();
      closeEditor('collections');
    },
  });

  const change = (next: CollectionDraft) => {
    setDraft(next);
    setErrors([]);
  };
  // Stable across renders (state setters and the `latest` ref only), so unchanged entry rows skip rendering.
  const entryActions = useMemo(() => {
    const setEntries = (update: (entries: EntryDraft[]) => EntryDraft[]) => {
      setDraft((current) => current && { ...current, entries: update(current.entries) });
      setErrors([]);
    };
    return {
      select: (index: number | undefined) => setSelected(index),
      updateEntry: (index: number, patch: Partial<EntryDraft>) =>
        setEntries((entries) => entries.map((entry, at) => (at === index ? { ...entry, ...patch } : entry))),
      removeEntry: (index: number) => {
        setEntries((entries) => entries.filter((_, at) => at !== index));
        setSelected((current) => selectionAfterRemove(current, index));
      },
      moveEntry: (index: number, offset: number) => {
        const to = index + offset;
        const length = latest.current.draft?.entries.length ?? 0;
        if (to < 0 || to >= length) return;
        setEntries((entries) => moveEntry(entries, index, to));
        setSelected((current) => selectionAfterMove(current, index, to));
      },
      addEntry: () => {
        const length = latest.current.draft?.entries.length;
        if (length === undefined) return;
        setEntries((entries) => [...entries, newEntry()]);
        setSelected(length);
      },
    };
  }, []);

  /** Resolves true when saved; false on validation errors, an API error, a declined recreate or a save in flight. */
  const save = async (): Promise<boolean> => {
    if (!collection || !draft || savingRef.current) return false;
    const result = draftToBody(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return false;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await saveCollection(collection.id, result.body);
      if (saved) load(saved, true);
      return !!saved;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  useEditorSaver(collectionEditorStore, { label: () => draft?.name ?? collection?.name ?? '', save });
  // Re-read first: the disk may have moved on while the draft was dirty (the live sync only warned), and
  // restoring the older baseline would let a later save overwrite that edit.
  const revert = async () => {
    if (!collection) return;
    const id = collection.id;
    const [fresh] = await readOpen(id).catch(() => [collection]);
    if (latest.current.collection?.id !== id) return;
    if (fresh) return load(fresh, true);
    clear();
    closeEditor('collections');
  };
  const remove = async () => {
    if (!collection || !(await confirmDelete(`Delete collection "${collection.name}"?`))) return;
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
    loading,
    saving,
    dirty,
    errors,
    selected,
    change,
    ...entryActions,
    save,
    revert,
    remove,
    back: () => closeEditor('collections'),
  };
}
