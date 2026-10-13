import { beforeEach, expect, it, vi } from 'vitest';
import type { ChangeEvent } from '@st/shared';

let emit: (event: ChangeEvent) => void = () => {};
const stopListening = vi.fn();
vi.mock('../api/events.js', () => ({
  subscribeToChanges: (listener: (event: ChangeEvent) => void) => {
    emit = listener;
    return stopListening;
  },
}));

const { createListStore } = await import('./listStore.js');

type Row = { id: number; name: string };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  let rows: Row[] = [
    { id: 2, name: 'b' },
    { id: 1, name: 'a' },
  ];
  const load = vi.fn(async () => structuredClone(rows));
  const store = createListStore<Row>({ event: 'workflows.changed', load, compare: (a, b) => a.id - b.id });
  return { store, load, listener: vi.fn(), setRows: (next: Row[]) => (rows = next) };
}

beforeEach(() => stopListening.mockClear());

it('loads once on the first subscriber and keeps the list sorted', async () => {
  const { store, load, listener } = setup();
  store.subscribe(listener);
  store.subscribe(vi.fn());
  await settle();
  expect(load).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot().map((row) => row.id)).toEqual([1, 2]);
  expect(listener).toHaveBeenCalledTimes(1);
});

it('refetches on its own event and ignores the others', async () => {
  const { store, load, listener, setRows } = setup();
  store.subscribe(listener);
  await settle();
  emit({ type: 'presets.changed', invalidFiles: [] });
  emit({ type: 'sessions.changed' });
  await settle();
  expect(load).toHaveBeenCalledTimes(1);
  setRows([{ id: 3, name: 'c' }]);
  emit({ type: 'workflows.changed', id: '3' });
  await settle();
  expect(load).toHaveBeenCalledTimes(2);
  expect(store.getSnapshot()).toEqual([{ id: 3, name: 'c' }]);
});

it('keeps the list identity and stays quiet when nothing changed', async () => {
  const { store, listener } = setup();
  store.subscribe(listener);
  await settle();
  const before = store.getSnapshot();
  listener.mockClear();
  await store.refresh();
  expect(store.getSnapshot()).toBe(before);
  expect(listener).not.toHaveBeenCalled();
});

it('coalesces bursts into one fetch, plus one follow-up for events during a fetch', async () => {
  const { store, load } = setup();
  store.subscribe(vi.fn());
  await settle();
  load.mockClear();
  await Promise.all([store.refresh(), store.refresh(), store.refresh()]);
  expect(load).toHaveBeenCalledTimes(1);

  load.mockClear();
  const first = store.refresh();
  await Promise.resolve();
  await Promise.resolve();
  expect(load).toHaveBeenCalledTimes(1);
  await Promise.all([first, store.refresh(), store.refresh()]);
  expect(load).toHaveBeenCalledTimes(2);
});

it('stops following events with the last subscriber and reloads on the next', async () => {
  const { store, load } = setup();
  const stop = store.subscribe(vi.fn());
  await settle();
  stop();
  expect(stopListening).toHaveBeenCalledTimes(1);
  store.subscribe(vi.fn());
  await settle();
  expect(load).toHaveBeenCalledTimes(2);
});

it('reports a failed refresh to its caller and recovers', async () => {
  const { store, load } = setup();
  load.mockRejectedValueOnce(new Error('down'));
  await expect(store.refresh()).rejects.toThrow('down');
  await expect(store.refresh()).resolves.toHaveLength(2);
});
