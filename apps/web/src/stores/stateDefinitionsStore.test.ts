import { expect, it, vi } from 'vitest';
import type { ChangeEvent, StateDefinition } from '@st/shared';

let emit: (event: ChangeEvent) => void = () => {};
vi.mock('../api/events.js', () => ({
  subscribeToChanges: (listener: (event: ChangeEvent) => void) => {
    emit = listener;
    return () => {};
  },
}));
const record = (id: string, name: string) => ({ id, name, keys: {} }) as unknown as StateDefinition;
let rows = [record('u2', 'zed'), record('u1', 'alpha')];
const list = vi.fn(async () => structuredClone(rows));
vi.mock('../api.js', async (original) => ({ ...(await original<object>()), stateDefinitionsApi: { list } }));

const { stateDefinitionsStore } = await import('./index.js');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

it('lists definitions by name and re-fetches on stateDefinitions.changed only', async () => {
  stateDefinitionsStore.subscribe(() => {});
  await settle();
  expect(stateDefinitionsStore.getSnapshot().map((definition) => definition.name)).toEqual(['alpha', 'zed']);

  rows = [...rows, record('u3', 'mid')];
  emit({ type: 'providers.changed', invalidFiles: [] });
  await settle();
  expect(list).toHaveBeenCalledTimes(1);

  emit({ type: 'stateDefinitions.changed', invalidFiles: [] });
  await vi.waitFor(() => expect(stateDefinitionsStore.getSnapshot()).toHaveLength(3));
  expect(stateDefinitionsStore.getSnapshot().map((definition) => definition.name)).toEqual(['alpha', 'mid', 'zed']);
  expect(list).toHaveBeenCalledTimes(2);
  // The background fetch never toasts.
  expect(list).toHaveBeenCalledWith({ silent: true });
});
