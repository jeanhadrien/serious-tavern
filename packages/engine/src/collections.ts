import { collectionEntryId, type Collection, type CollectionEntry } from '@st/shared';
import type { ExecutionContext } from './types.js';

/** How Recall and Draw output an entry. `title` and `level` are left out when the entry has none. */
export type CollectionEntryOutput = {
  collectionId: string;
  entryId: string;
  text: string;
  keywords: string[];
  tags: string[];
  title?: string;
  level?: number;
};

/** An entry a node may use, with where it comes from. */
export type Candidate = { collectionId: string; index: number; entry: CollectionEntry };

/** Loads the configured collections in order, each id once. Throws a plain error naming an unknown id. */
export async function loadCollections(ctx: ExecutionContext, ids: readonly string[]): Promise<Collection[]> {
  const collections: Collection[] = [];
  for (const id of new Set(ids)) {
    const collection = await ctx.resources.collections?.get(id);
    if (!collection) throw new Error(`Collection ${id} not found. Pick another collection in the node's settings.`);
    collections.push(collection);
  }
  return collections;
}

/** Enabled entries with non-blank text, in collection order, then file order. */
export function candidates(collections: readonly Collection[]): Candidate[] {
  return collections.flatMap((collection) =>
    collection.entries.flatMap((entry, index) =>
      entry.enabled !== false && entry.text.trim() ? [{ collectionId: collection.id, index, entry }] : [],
    ),
  );
}

export function entryOutput({ collectionId, index, entry }: Candidate): CollectionEntryOutput {
  return {
    collectionId,
    entryId: collectionEntryId(index),
    text: entry.text,
    keywords: [...(entry.keywords ?? [])],
    tags: [...(entry.tags ?? [])],
    ...(entry.title !== undefined && { title: entry.title }),
    ...(entry.level !== undefined && { level: entry.level }),
  };
}

/** The tags of a list as compared by filters: trimmed, lower case, blanks dropped. */
export const tagSet = (tags: readonly string[] | undefined) =>
  new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean));
