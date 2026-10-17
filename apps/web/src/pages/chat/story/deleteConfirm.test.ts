import { describe, expect, it, vi } from 'vitest';
import { deleteClick, deleteConfirmText } from './deleteConfirm.js';

it('words the confirmation', () => {
  expect(deleteConfirmText(['scene.tension (back to 4)', "scene.injected (forgets 'a bell')"])).toBe(
    "Deleting this reply also undoes what its turn stored:\n\n- scene.tension (back to 4)\n- scene.injected (forgets 'a bell')\n\nDelete the reply?",
  );
});

describe('what the trash button does', () => {
  const lines = ['scene.tension (back to 4)'];

  it.each<[string, readonly string[] | undefined]>([
    ['nothing is undone', undefined],
    ['an empty list is given', []],
  ])('takes the inline step, without any dialog, when %s', (_, undone) => {
    const confirm = vi.fn(() => true);
    expect(deleteClick(undone, confirm)).toBe('inline');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('deletes when the dialog that lists what is undone is accepted', () => {
    const confirm = vi.fn(() => true);
    expect(deleteClick(lines, confirm)).toBe('delete');
    expect(confirm).toHaveBeenCalledExactlyOnceWith(deleteConfirmText(lines));
  });

  it('keeps the reply when the dialog is cancelled', () => {
    const confirm = vi.fn(() => false);
    expect(deleteClick(lines, confirm)).toBe('cancel');
    expect(confirm).toHaveBeenCalledOnce();
  });
});
