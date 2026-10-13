import { expect, it, vi } from 'vitest';
import type { ChangeEvent, ProviderView } from '@st/shared';

let emit: (event: ChangeEvent) => void = () => {};
vi.mock('../api/events.js', () => ({
  subscribeToChanges: (listener: (event: ChangeEvent) => void) => {
    emit = listener;
    return () => {};
  },
}));
const view = (id: string, name: string, builtIn = false) => ({ id, name, builtIn }) as ProviderView;
let rows = [view('u2', 'Zed'), view('u1', 'Alpha'), view('openrouter', 'OpenRouter', true)];
const list = vi.fn(async () => structuredClone(rows));
vi.mock('../api.js', async (original) => ({ ...(await original<object>()), providersApi: { list } }));

const { providersStore } = await import('./index.js');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

it('lists built-in providers first and re-fetches on providers.changed', async () => {
  providersStore.subscribe(() => {});
  await settle();
  expect(providersStore.getSnapshot().map((provider) => provider.name)).toEqual(['OpenRouter', 'Alpha', 'Zed']);

  rows = [...rows, view('u3', 'Local')];
  emit({ type: 'presets.changed', invalidFiles: [] });
  await settle();
  expect(list).toHaveBeenCalledTimes(1);

  emit({ type: 'providers.changed', invalidFiles: [] });
  await vi.waitFor(() => expect(providersStore.getSnapshot()).toHaveLength(4));
  expect(list).toHaveBeenCalledTimes(2);
  // The background fetch never toasts.
  expect(list).toHaveBeenCalledWith({ silent: true });
});
