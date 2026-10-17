import { useEffect, useRef, type RefObject } from 'react';
import { startFileLiveSync, type DiskChange, type FileLiveSyncEditor, type FileResource } from './fileLiveSync.js';

/** What an editor of a file-backed resource (providers, collections, state definitions) tells the live sync. */
export interface FileSyncEditor<Item extends { id: string; name: string }, Draft> {
  resource: FileResource;
  /** The open item and its draft. */
  item?: Item;
  draft?: Draft;
  /** The saved item as the editor compares it; changes when the item or its saved form does. */
  baseline(item: Item): string;
  /** Fetches the list (updating the shared store) and returns what to match the open item against. */
  refresh(openId: string | undefined): Promise<Item[]>;
  /** What the fresh list means for the open item; `deleting` is true while the editor deletes it itself. */
  classify(editor: { item?: Item; draft?: Draft; deleting: boolean }, fresh: Item[]): DiskChange<Item>;
  onReload(item: Item): void;
  onClose(): void;
}

/**
 * The live sync's view of the editor's state right now. `deleting` is read at each decision, because a delete can
 * start while the list is being fetched.
 */
export function liveSyncEditor<Item extends { id: string; name: string }, Draft>(
  { item, draft, baseline, refresh, classify, onReload, onClose }: FileSyncEditor<Item, Draft>,
  deleting: () => string | undefined,
): FileLiveSyncEditor<Item> {
  return {
    signature: () => [item?.id ?? '', deleting() ?? '', item ? baseline(item) : ''].join('\n'),
    refresh: () => refresh(item?.id),
    classify: (fresh) => classify({ item, draft, deleting: !!item && deleting() === item.id }, fresh),
    openName: () => item?.name ?? '',
    onReload,
    onClose,
  };
}

/**
 * Keeps the editor in step with edits made to its resource's files on disk (see `startFileLiveSync`). It reads the
 * editor's latest state at each decision, so the options may change on every render.
 *
 * Returns the id the editor is deleting: set it before the request and clear it when the delete fails. Writes are
 * announced before their response arrives, so the sync must not report the editor's own delete as "removed from
 * disk". Ids are never reused, so it is not reset after a successful delete.
 */
export function useFileSync<Item extends { id: string; name: string }, Draft>(
  editor: FileSyncEditor<Item, Draft>,
): RefObject<string | undefined> {
  const latest = useRef(editor);
  latest.current = editor;
  const deleting = useRef<string>(undefined);
  useEffect(
    () =>
      startFileLiveSync<Item>(latest.current.resource, () => liveSyncEditor(latest.current, () => deleting.current)),
    [],
  );
  return deleting;
}
