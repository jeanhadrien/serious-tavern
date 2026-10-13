import { beforeEach, expect, it, vi } from 'vitest';
import type { ProviderView } from '@st/shared';

const providersApi = { create: vi.fn(), update: vi.fn(), delete: vi.fn(), duplicate: vi.fn() };
const refresh = vi.fn(async () => []);
const alerts = { success: vi.fn(), info: vi.fn(), error: vi.fn() };
const notifyError = vi.fn();
vi.mock('../../api.js', async (original) => ({ ...(await original<object>()), providersApi }));
vi.mock('../../api/transport.js', async (original) => ({ ...(await original<object>()), notifyError }));
vi.mock('../../stores/index.js', () => ({ providersStore: { refresh } }));
vi.mock('../../alerts/index.js', () => ({ alerts }));

const { ApiError } = await import('../../api.js');
const { createProvider, deleteProvider, duplicateProvider, saveProvider } = await import('./providerActions.js');

const provider = { id: 'p1', name: 'Local', builtIn: false } as ProviderView;
beforeEach(() => vi.clearAllMocks());

it('saves and duplicates through the API, then refreshes the shared list', async () => {
  providersApi.update.mockResolvedValue({ ...provider, name: 'Saved' });
  const body = { name: 'Saved', baseUrl: 'http://localhost:8080/v1' };
  expect(await saveProvider('p1', body)).toMatchObject({ name: 'Saved' });
  expect(providersApi.update).toHaveBeenCalledWith('p1', body);

  providersApi.duplicate.mockResolvedValue({ ...provider, id: 'p2', name: 'Local (copy)' });
  expect(await duplicateProvider(provider)).toMatchObject({ id: 'p2' });
  expect(providersApi.duplicate).toHaveBeenCalledWith('p1');
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('creates a provider that passes validation, and reports nothing more when a request fails', async () => {
  providersApi.create.mockResolvedValue(provider);
  await createProvider();
  expect(providersApi.create.mock.calls[0]![0]).toMatchObject({ baseUrl: expect.stringMatching(/^http/) });
  providersApi.update.mockRejectedValue(new ApiError(400, 'VALIDATION_ERROR', 'bad'));
  expect(await saveProvider('p1', { name: 'x', baseUrl: 'http://x' })).toBeUndefined();
  expect(alerts.success).toHaveBeenCalledTimes(0);
});

it('explains a provider still used by workflows instead of deleting it', async () => {
  providersApi.delete.mockRejectedValue(
    new ApiError(409, 'PROVIDER_IN_USE', 'Provider is used by workflows', ['Story', 'Chat']),
  );
  expect(await deleteProvider(provider)).toBe(false);
  expect(providersApi.delete).toHaveBeenCalledWith('p1', { silent: true });
  expect(alerts.error).toHaveBeenCalledWith(
    expect.stringContaining('"Local" is still used'),
    expect.objectContaining({ title: 'Provider in use', details: expect.stringContaining('Story\nChat') }),
  );
  expect(notifyError).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});

it('reports other delete failures the usual way, and refreshes after a delete', async () => {
  const failure = new ApiError(404, 'NOT_FOUND', 'Provider not found');
  providersApi.delete.mockRejectedValueOnce(failure);
  expect(await deleteProvider(provider)).toBe(false);
  expect(notifyError).toHaveBeenCalledWith(failure);

  providersApi.delete.mockResolvedValueOnce(undefined);
  expect(await deleteProvider(provider)).toBe(true);
  expect(refresh).toHaveBeenCalledOnce();
});
