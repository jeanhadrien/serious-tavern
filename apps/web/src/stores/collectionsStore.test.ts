import { expect, it, vi } from 'vitest';
import type { ChangeEvent, CollectionSummary } from '@st/shared';

let emit: (event: ChangeEvent) => void = () => {};
vi.mock('../api/events.js', () => ({
  subscribeToChanges: (listener: (event: ChangeEvent) => void) => {
    emit = listener;
    return () => {};
  },
}));
const summary = (id: string, name: string) =>
  ({ id, name, entryCount: 0, createdAt: '', updatedAt: '' }) as CollectionSummary;
let rows = [summary('k2', 'Wastes'), summary('k1', 'Abyss')];
const list = vi.fn(async () => structuredClone(rows));
vi.mock('../api.js', async (original) => ({ ...(await original<object>()), collectionsApi: { list } }));

const { collectionsStore } = await import('./index.js');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

it('lists collections by name and re-fetches on collections.changed only', async () => {
  collectionsStore.subscribe(() => {});
  await settle();
  expect(collectionsStore.getSnapshot().map((item) => item.name)).toEqual(['Abyss', 'Wastes']);

  rows = [...rows, summary('k3', 'Moors')];
  emit({ type: 'providers.changed', invalidFiles: [] });
  await settle();
  expect(list).toHaveBeenCalledTimes(1);

  emit({ type: 'collections.changed', invalidFiles: [] });
  await vi.waitFor(() => expect(collectionsStore.getSnapshot()).toHaveLength(3));
  expect(list).toHaveBeenCalledTimes(2);
  // The background fetch never toasts.
  expect(list).toHaveBeenCalledWith({ silent: true });
});
