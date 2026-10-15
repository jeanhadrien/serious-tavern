import { expect, it, vi } from 'vitest';
import { createEditorStore } from './editorStore.js';

const item = (id: string) => ({ id });

it('sends an open request, numbered so each is handled once', () => {
  const store = createEditorStore<{ id: string }>();
  const listener = vi.fn();
  store.subscribe(listener);
  store.open(item('a'));
  expect(store.getSnapshot().command).toEqual({ seq: 1, open: { id: 'a' } });
  store.open(item('b'));
  expect(store.getSnapshot().command?.seq).toBe(2);
  expect(listener).toHaveBeenCalledTimes(2);
});

it('does not reopen the item the editor already shows, so its draft survives', () => {
  const store = createEditorStore<{ id: string }>();
  store.report('a', true);
  store.open(item('a'));
  expect(store.getSnapshot().command).toBeUndefined();
  // A focus on the open item is sent, and keeps its dirty flag.
  store.open(item('a'), 'edge-1');
  expect(store.getSnapshot()).toMatchObject({ currentId: 'a', dirty: true, command: { open: { id: 'a' } } });
});

it('names the requested item at once, so the layout never records the previous one meanwhile', () => {
  const store = createEditorStore<{ id: string }>();
  const listener = vi.fn();
  store.report('a', true);
  store.subscribe(listener);
  store.open(item('b'));
  expect(store.getSnapshot()).toMatchObject({ currentId: 'b', dirty: false });
  expect(listener).toHaveBeenCalledTimes(1);
  // The editor's report after applying it changes nothing.
  store.report('b', false);
  expect(listener).toHaveBeenCalledTimes(1);
});

it('reports selection and dirtiness, staying quiet when nothing changed', () => {
  const store = createEditorStore<{ id: string }>();
  const listener = vi.fn();
  store.subscribe(listener);
  store.report('a', false);
  store.report('a', false);
  store.report('a', true);
  expect(store.getSnapshot()).toMatchObject({ currentId: 'a', dirty: true });
  expect(listener).toHaveBeenCalledTimes(2);
});

it('asks the editor to drop a deleted item', () => {
  const store = createEditorStore<{ id: string }>();
  store.discard('a');
  expect(store.getSnapshot().command).toEqual({ seq: 1, close: 'a' });
});
