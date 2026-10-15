import type { Collection, CollectionFields } from '@st/shared';
import { ApiError, collectionsApi } from '../../api.js';
import { notifyError } from '../../api/transport.js';
import { alerts } from '../../alerts/index.js';
import { collectionEditorStore, collectionsStore } from '../../stores/index.js';

// Collection writes shared by the list and the editor. Each refreshes the shared list, so every view (the list,
// the Recall and Draw node panels) reads its own write. They resolve with undefined when the request failed
// (already reported to the user).

async function write<T>(request: () => Promise<T>, done?: string): Promise<T | undefined> {
  try {
    const result = await request();
    await collectionsStore.refresh().catch(() => {});
    if (done) alerts.success(done);
    return result;
  } catch {
    return undefined; // API errors are toasted.
  }
}

export const createCollection = () => write(() => collectionsApi.create({ name: 'New collection', entries: [] }));

/**
 * Saves the editor's draft. When the collection was deleted (on disk) while the draft was open, the save
 * recreates it as a new collection instead of losing the edits; the result then has a new id.
 */
export const saveCollection = (id: string, body: CollectionFields) =>
  write(async () => {
    try {
      return await collectionsApi.update(id, body, { silent: true });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.status === 404) return collectionsApi.create(body);
      notifyError(error);
      throw error;
    }
  }, 'Collection saved');

// Only the latest open request applies, so a slow response never replaces a later choice.
let openRequest = 0;

/**
 * Opens a collection in its editor (`show` makes the editor visible). The list and the node panel links only
 * know summaries, so the whole collection is fetched first and the editor switches once, with the full record:
 * it never shows the previous collection while loading, and the URL changes once. The open one keeps its draft.
 */
export async function openCollection(id: string, show: () => void): Promise<void> {
  const request = ++openRequest;
  if (collectionEditorStore.getSnapshot().currentId === id) return show();
  const collection = await collectionsApi.get(id).catch(() => undefined); // toasted
  if (collection && request === openRequest) showCollection(collection, show);
}

/** Opens a whole collection already at hand (e.g. just created); a pending `openCollection` is dropped. */
export function showCollection(collection: Collection, show: () => void) {
  ++openRequest;
  collectionEditorStore.open(collection);
  show();
}

/**
 * Deletes a collection. One that Recall or Draw nodes still read cannot be deleted: the server answers
 * `COLLECTION_IN_USE` with the workflow names, which are shown with what to do about it. Resolves with success.
 */
export async function deleteCollection(collection: Pick<Collection, 'id' | 'name'>): Promise<boolean> {
  try {
    await collectionsApi.delete(collection.id, { silent: true });
  } catch (error) {
    if (!(error instanceof ApiError)) return false;
    if (error.code === 'COLLECTION_IN_USE') {
      const workflows = Array.isArray(error.details) ? error.details.map(String) : [];
      alerts.error(`"${collection.name}" is still used by Recall or Draw nodes, so it was not deleted.`, {
        title: 'Collection in use',
        details: `Remove it from the nodes of these workflows first:\n${workflows.join('\n')}`,
      });
    } else notifyError(error);
    return false;
  }
  await collectionsStore.refresh().catch(() => {});
  alerts.info(`Collection "${collection.name}" deleted`);
  return true;
}
