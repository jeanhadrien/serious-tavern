import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { deleteClick, UndoneByDelete } from './deleteConfirm.js';

it('lists what the delete undoes', () => {
  const html = renderToStaticMarkup(
    <UndoneByDelete lines={['scene.tension (back to 4)', "scene.injected (forgets 'a bell')"]} />,
  );
  expect(html).toBe(
    '<p>Deleting this reply also undoes what its turn stored:</p>' +
      '<ul><li>scene.tension (back to 4)</li><li>scene.injected (forgets &#x27;a bell&#x27;)</li></ul>',
  );
});

it('puts the note about linked state after the list', () => {
  const html = renderToStaticMarkup(
    <UndoneByDelete lines={['scene.tension (back to 4)']} note="Deleting this message stops 1 item being used." />,
  );
  expect(html.endsWith('</ul><p>Deleting this message stops 1 item being used.</p>')).toBe(true);
});

describe('what the trash button does', () => {
  const lines = ['scene.tension (back to 4)'];

  it.each<[string, readonly string[] | undefined]>([
    ['nothing is undone', undefined],
    ['an empty list is given', []],
  ])('takes the inline step, without any dialog, when %s', async (_, undone) => {
    const confirm = vi.fn(async () => true);
    expect(await deleteClick(undone, undefined, confirm)).toBe('inline');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('deletes when the dialog that lists what is undone is accepted', async () => {
    const confirm = vi.fn(async () => true);
    expect(await deleteClick(lines, undefined, confirm)).toBe('delete');
    expect(confirm).toHaveBeenCalledExactlyOnceWith(lines, undefined);
  });

  it('hands the note to the dialog, and takes the inline step (which shows it itself) without a dialog', async () => {
    const confirm = vi.fn(async () => true);
    expect(await deleteClick(lines, 'note', confirm)).toBe('delete');
    expect(confirm).toHaveBeenCalledExactlyOnceWith(lines, 'note');
    confirm.mockClear();
    expect(await deleteClick(undefined, 'note', confirm)).toBe('inline');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('keeps the reply when the dialog is cancelled', async () => {
    const confirm = vi.fn(async () => false);
    expect(await deleteClick(lines, undefined, confirm)).toBe('cancel');
    expect(confirm).toHaveBeenCalledOnce();
  });
});
