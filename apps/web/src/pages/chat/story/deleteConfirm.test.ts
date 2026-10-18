import { describe, expect, it, vi } from 'vitest';
import { deleteClick, deleteConfirmText } from './deleteConfirm.js';

it('words the confirmation', () => {
  expect(deleteConfirmText(['scene.tension (back to 4)', "scene.injected (forgets 'a bell')"])).toBe(
    "Deleting this reply also undoes what its turn stored:\n\n- scene.tension (back to 4)\n- scene.injected (forgets 'a bell')\n\nDelete the reply?",
  );
});

it('puts the note about linked state before the question, so the question comes last', () => {
  const text = deleteConfirmText(['scene.tension (back to 4)'], 'Deleting this message stops 1 item being used.');
  expect(text).toBe(
    'Deleting this reply also undoes what its turn stored:\n\n- scene.tension (back to 4)\n\nDeleting this message stops 1 item being used.\n\nDelete the reply?',
  );
  expect(text.endsWith('Delete the reply?')).toBe(true);
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

  it('hands the note to the dialog text, and takes the inline step (which shows it itself) without a dialog', () => {
    const confirm = vi.fn((_text: string) => true);
    expect(deleteClick(lines, confirm, 'note')).toBe('delete');
    expect(confirm).toHaveBeenCalledExactlyOnceWith(deleteConfirmText(lines, 'note'));
    expect(confirm.mock.calls[0]?.[0]).toContain('note');
    confirm.mockClear();
    expect(deleteClick(undefined, confirm, 'note')).toBe('inline');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('keeps the reply when the dialog is cancelled', () => {
    const confirm = vi.fn(() => false);
    expect(deleteClick(lines, confirm)).toBe('cancel');
    expect(confirm).toHaveBeenCalledOnce();
  });
});
