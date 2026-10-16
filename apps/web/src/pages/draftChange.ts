import type { DiskChange } from './fileLiveSync.js';

/** How an editor turns a record into its draft, and how it compares drafts. */
export interface DraftOps<Item, Draft> {
  toDraft(item: Item): Draft;
  /** The draft as the server would store it (trimmed, defaults filled); undefined when it cannot be saved. */
  stored(draft: Draft, item: Item): Draft | undefined;
  /** Equality key of a draft; drafts with the same key are the same. Defaults to their JSON. */
  key?(draft: Draft): string;
}

/**
 * What a fresh list from disk means for the item open in an editor, shared by the editors of file-backed
 * resources. Records are compared through their drafts, so key order and timestamps never count as a change (a
 * UI save followed by its own change event is `unchanged`). A dirty draft that the disk already holds (its own
 * save, seen before the save's response) is a reload, not a conflict.
 */
export function classifyDraftChange<Item extends { id: string }, Draft>(
  editor: { item?: Item; draft?: Draft; deleting?: boolean },
  fresh: readonly Item[],
  ops: DraftOps<Item, Draft>,
): DiskChange<Item> {
  const { item, draft } = editor;
  // The editor's own delete is announced before its response: the item vanishing is expected, not news.
  if (!draft || !item || editor.deleting) return { kind: 'unchanged' };
  const key = ops.key ?? ((value: Draft) => JSON.stringify(value));
  const baseline = key(ops.toDraft(item));
  const dirty = key(draft) !== baseline;
  const onDisk = fresh.find((candidate) => candidate.id === item.id);
  if (!onDisk) return dirty ? { kind: 'conflict', removed: true, version: 'removed' } : { kind: 'removed' };
  const incoming = key(ops.toDraft(onDisk));
  if (incoming === baseline) return { kind: 'unchanged' };
  const saved = dirty ? ops.stored(draft, item) : undefined;
  if (saved && key(saved) === incoming) return { kind: 'reload', item: onDisk };
  return dirty ? { kind: 'conflict', removed: false, version: incoming } : { kind: 'reload', item: onDisk };
}
