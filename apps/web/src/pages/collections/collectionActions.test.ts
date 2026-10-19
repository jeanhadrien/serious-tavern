import { beforeEach, expect, it, vi } from 'vitest';
import type { Collection } from '@st/shared';

const collectionsApi = { get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() };
const refresh = vi.fn(async () => []);
const editor = { currentId: undefined as string | undefined, open: vi.fn() };
const alerts = { success: vi.fn(), info: vi.fn(), error: vi.fn() };
const notifyError = vi.fn();
vi.mock('../../api.js', async (original) => ({ ...(await original<object>()), collectionsApi }));
vi.mock('../../api/transport.js', async (original) => ({ ...(await original<object>()), notifyError }));
vi.mock('../../stores/index.js', () => ({
  collectionsStore: { refresh },
  collectionEditorStore: { getSnapshot: () => ({ currentId: editor.currentId }), open: editor.open },
}));
vi.mock('../../alerts/index.js', () => ({ alerts }));

const { ApiError } = await import('../../api.js');
const { deleteCollection, openCollection, saveCollection } = await import('./collectionActions.js');

const lore = { id: 'c1', name: 'Lore', entries: [] } as unknown as Collection;
const body = { name: 'Lore', entries: [] };
beforeEach(() => {
  vi.clearAllMocks();
  editor.currentId = undefined;
});

it('saves through the API, then refreshes the shared list', async () => {
  collectionsApi.update.mockResolvedValue(lore);
  expect(await saveCollection('c1', body)).toBe(lore);
  expect(collectionsApi.update).toHaveBeenCalledWith('c1', body, { silent: true });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(alerts.success).toHaveBeenCalledWith('Collection saved');
});

it('recreates a collection the server no longer finds only when the user agrees', async () => {
  const missing = new ApiError(404, 'NOT_FOUND', 'Collection not found');
  collectionsApi.update.mockRejectedValue(missing);
  collectionsApi.create.mockResolvedValue({ ...lore, id: 'c2' });
  const confirm = vi.fn(async () => true);
  expect(await saveCollection('c1', body, confirm)).toMatchObject({ id: 'c2' });
  expect(confirm).toHaveBeenCalledWith('Lore');
  expect(collectionsApi.create).toHaveBeenCalledWith(body);
  expect(notifyError).not.toHaveBeenCalled();
  expect(alerts.success).toHaveBeenCalledWith('Collection saved');
});

it('keeps the draft unsaved when the user declines the recreate (the file may only be unreadable)', async () => {
  // The server answers 404 for a file that no longer parses as well as for a deleted one.
  collectionsApi.update.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Collection not found'));
  expect(await saveCollection('c1', body, async () => false)).toBeUndefined();
  expect(collectionsApi.create).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  expect(alerts.success).not.toHaveBeenCalled();
  expect(notifyError).not.toHaveBeenCalled();
});

it('reports other save failures the usual way', async () => {
  const failure = new ApiError(400, 'VALIDATION_ERROR', 'bad');
  collectionsApi.update.mockRejectedValue(failure);
  expect(await saveCollection('c1', body)).toBeUndefined();
  expect(notifyError).toHaveBeenCalledWith(failure);
  expect(collectionsApi.create).not.toHaveBeenCalled();
  expect(alerts.success).not.toHaveBeenCalled();
});

it('explains a collection still used by workflows instead of deleting it', async () => {
  collectionsApi.delete.mockRejectedValue(
    new ApiError(409, 'COLLECTION_IN_USE', 'Collection is used by workflows', ['Story', 'Chat']),
  );
  expect(await deleteCollection(lore)).toBe(false);
  expect(collectionsApi.delete).toHaveBeenCalledWith('c1', { silent: true });
  expect(alerts.error).toHaveBeenCalledWith(
    expect.stringContaining('"Lore" is still used'),
    expect.objectContaining({ title: 'Collection in use', details: expect.stringContaining('Story\nChat') }),
  );
  expect(notifyError).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});

it('reports other delete failures the usual way, and refreshes after a delete', async () => {
  const failure = new ApiError(404, 'NOT_FOUND', 'Collection not found');
  collectionsApi.delete.mockRejectedValueOnce(failure);
  expect(await deleteCollection(lore)).toBe(false);
  expect(notifyError).toHaveBeenCalledWith(failure);
  expect(refresh).not.toHaveBeenCalled();

  collectionsApi.delete.mockResolvedValueOnce(undefined);
  expect(await deleteCollection(lore)).toBe(true);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('opens a collection only once its whole record has arrived, and only the latest request', async () => {
  const show = vi.fn();
  let answer: (value: Collection) => void = () => {};
  collectionsApi.get.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
  const first = openCollection('c1', show);
  expect(editor.open).not.toHaveBeenCalled();
  collectionsApi.get.mockResolvedValueOnce({ ...lore, id: 'c2' });
  await openCollection('c2', show);
  answer(lore);
  await first;
  expect(editor.open.mock.calls).toEqual([[{ ...lore, id: 'c2' }]]);
  expect(show).toHaveBeenCalledTimes(1);
});

it('shows the open collection without fetching it again (its draft stays), and opens nothing on failure', async () => {
  const show = vi.fn();
  editor.currentId = 'c1';
  await openCollection('c1', show);
  expect(collectionsApi.get).not.toHaveBeenCalled();
  expect(show).toHaveBeenCalledTimes(1);

  editor.currentId = undefined;
  collectionsApi.get.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Collection not found'));
  await openCollection('c3', show);
  expect(editor.open).not.toHaveBeenCalled();
  expect(show).toHaveBeenCalledTimes(1);
});
