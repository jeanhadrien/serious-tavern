import type { Snippet, SnippetFields } from '@st/shared';
import { snippetsApi } from '../../api.js';
import { alerts } from '../../alerts/index.js';
import { snippetsStore } from '../../stores/index.js';
import { newSnippetName } from './snippetDraft.js';

// Snippet writes shared by the list and the editor. Each refreshes the shared list, so every view (the list, the
// preset editor's hints) reads its own write. They resolve with undefined when the request failed (already toasted).

async function write<T>(request: () => Promise<T>, done?: string): Promise<T | undefined> {
  try {
    const result = await request();
    await snippetsStore.refresh().catch(() => {});
    if (done) alerts.success(done);
    return result;
  } catch {
    return undefined;
  }
}

export const createSnippet = () =>
  write(() =>
    snippetsApi.create({ name: newSnippetName(snippetsStore.getSnapshot().map((item) => item.name)), text: '' }),
  );

export const saveSnippet = (id: string, body: SnippetFields) =>
  write(() => snippetsApi.update(id, body), 'Snippet saved');

/** Resolves with success. Templates that use the snippet render it empty afterwards; the server never refuses. */
export async function deleteSnippet(snippet: Snippet): Promise<boolean> {
  const done = await write(() => snippetsApi.delete(snippet.id).then(() => true));
  if (done) alerts.info(`Snippet "${snippet.name}" deleted`);
  return !!done;
}
