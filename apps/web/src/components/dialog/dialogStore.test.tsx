import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { DialogHost } from './DialogHost.js';
import { CANCEL, DialogStore } from './dialogStore.js';

const remove = { title: 'Delete "Lore"?', actions: [{ id: 'delete', label: 'Delete', kind: 'danger' as const }] };

it('resolves with the chosen action and shows nothing afterwards', async () => {
  const store = new DialogStore();
  const answer = store.ask(remove);
  const shown = store.getSnapshot();
  expect(shown).toMatchObject({ title: 'Delete "Lore"?' });
  store.answer(shown!.id, 'delete');
  expect(await answer).toBe('delete');
  expect(store.getSnapshot()).toBeUndefined();
});

it('resolves with cancel when dismissed', async () => {
  const store = new DialogStore();
  const answer = store.ask(remove);
  store.answer(store.getSnapshot()!.id, CANCEL);
  expect(await answer).toBe(CANCEL);
});

it('shows questions asked together one at a time, oldest first', async () => {
  const store = new DialogStore();
  let notified = 0;
  store.subscribe(() => notified++);
  const first = store.ask({ ...remove, title: 'first' });
  const second = store.ask({ ...remove, title: 'second' });
  expect(notified).toBe(1);
  expect(store.getSnapshot()?.title).toBe('first');
  store.answer(store.getSnapshot()!.id, CANCEL);
  expect(store.getSnapshot()?.title).toBe('second');
  store.answer(store.getSnapshot()!.id, 'delete');
  expect([await first, await second]).toEqual([CANCEL, 'delete']);
});

it('ignores answers to another request or naming an action it does not offer', () => {
  const store = new DialogStore();
  void store.ask(remove);
  const { id } = store.getSnapshot()!;
  store.answer(id + 1, 'delete');
  store.answer(id, 'archive');
  expect(store.getSnapshot()?.id).toBe(id);
});

it('renders Cancel first, then the actions, with the body as a paragraph when it is text', () => {
  const store = new DialogStore();
  void store.ask({ ...remove, body: "This can't be undone.", cancelLabel: 'Keep' });
  const html = renderToStaticMarkup(<DialogHost store={store} />);
  expect(html).toContain('<h2 id="confirm-dialog-title">Delete &quot;Lore&quot;?</h2>');
  expect(html).toContain('<p>This can&#x27;t be undone.</p>');
  expect(html).toMatch(/<button type="button">Keep<\/button><button type="button" class="danger">Delete<\/button>/);
});

it('renders an empty dialog when nothing is asked', () => {
  const html = renderToStaticMarkup(<DialogHost store={new DialogStore()} />);
  expect(html).toBe('<dialog class="confirm-dialog" aria-labelledby="confirm-dialog-title"></dialog>');
});
