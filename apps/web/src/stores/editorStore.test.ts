import { expect, it, vi } from 'vitest';
import { CANCEL, type DialogOptions } from '../components/dialog/dialogStore.js';
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

type Item = { id: string };
type Answer = 'save' | 'discard' | typeof CANCEL;

/** A store holding a dirty draft of `a`, with a fake dialog that answers `answer` and records what it was asked. */
function dirtyStore(answer: Answer, saverResult?: boolean) {
  const asked: DialogOptions<string>[] = [];
  const ask = vi.fn(async (options: DialogOptions<string>) => {
    asked.push(options);
    return answer;
  });
  const store = createEditorStore<Item>(ask as never);
  const save = vi.fn(async () => saverResult === true);
  if (saverResult !== undefined) store.setSaver({ label: () => 'Alice', save });
  store.report('a', true);
  return { store, asked, ask, save };
}

it('opens at once, without a dialog, for the open item or a clean draft', async () => {
  for (const dirty of [true, false]) {
    const { store, ask } = dirtyStore('cancel', true);
    store.report('a', dirty);
    expect(await store.confirmSwitch(dirty ? 'a' : 'b')).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  }
});

it.each([
  ['save', true, true, 1],
  ['save', false, false, 1],
  ['discard', true, true, 0],
  [CANCEL, true, false, 0],
] as const)(
  'a dirty draft, answer %s (saver %s): resolves %s, saver called %s times',
  async (answer, saved, expected, saves) => {
    const { store, ask, save } = dirtyStore(answer, saved);
    expect(await store.confirmSwitch('b')).toBe(expected);
    expect(ask).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledTimes(saves);
  },
);

it('names the open item and offers Save, Discard and Cancel', async () => {
  const { store, asked } = dirtyStore('discard', true);
  await store.confirmSwitch('b');
  expect(asked[0]).toMatchObject({
    title: 'Save changes to "Alice"?',
    cancelLabel: 'Cancel',
    actions: [
      { id: 'save', label: 'Save', kind: 'primary' },
      { id: 'discard', label: 'Discard changes', kind: 'danger' },
    ],
  });
});

it('offers only Discard when no saver is registered', async () => {
  const { store, asked } = dirtyStore('discard');
  await store.confirmSwitch('b');
  expect(asked[0]?.title).toBe('Save changes to "the open item"?');
  expect(asked[0]?.actions.map((action) => action.id)).toEqual(['discard']);
});

it('forgets an unregistered saver', async () => {
  const { store, asked } = dirtyStore('discard', true);
  store.setSaver(undefined);
  await store.confirmSwitch('b');
  expect(asked[0]?.actions.map((action) => action.id)).toEqual(['discard']);
});

it('asks for a switch with no target (create, import) while dirty', async () => {
  const { store, ask } = dirtyStore('cancel', true);
  expect(await store.confirmSwitch()).toBe(false);
  expect(ask).toHaveBeenCalledOnce();
});

it('saves the open dirty item through its saver, for the Ctrl/Cmd+S shortcut', async () => {
  const store = createEditorStore<{ id: string }>();
  const save = vi.fn(async () => true);
  expect(await store.save()).toBe(false); // no saver
  store.setSaver({ label: () => 'Alice', save });
  expect(await store.save()).toBe(false); // nothing open
  store.report('a', false);
  expect(await store.save()).toBe(false); // clean
  expect(save).not.toHaveBeenCalled();
  store.report('a', true);
  expect(await store.save()).toBe(true);
  expect(save).toHaveBeenCalledOnce();
});
