import { describe, expect, it } from 'vitest';
import { classifyDraftChange, type DraftOps } from './draftChange.js';

interface Item {
  id: string;
  name: string;
  updatedAt: string;
}
interface Draft {
  name: string;
  /** Local bookkeeping that a custom key ignores. */
  uid?: number;
}

const item = (name: string, updatedAt = 't0'): Item => ({ id: 'a', name, updatedAt });
const ops: DraftOps<Item, Draft> = {
  toDraft: (value) => ({ name: value.name }),
  // The server trims names.
  stored: (draft) => (draft.name.trim() ? { name: draft.name.trim() } : undefined),
};
const saved = item('One');

describe('classifyDraftChange', () => {
  it('ignores echoes, unknown fields and timestamps', () => {
    const clean = { item: saved, draft: ops.toDraft(saved) };
    expect(classifyDraftChange(clean, [item('One', 't1')], ops)).toEqual({ kind: 'unchanged' });
  });

  it('reloads a clean editor when the file changed, and closes it when the file is gone', () => {
    const clean = { item: saved, draft: ops.toDraft(saved) };
    const edited = item('Two');
    expect(classifyDraftChange(clean, [edited], ops)).toEqual({ kind: 'reload', item: edited });
    expect(classifyDraftChange(clean, [], ops)).toEqual({ kind: 'removed' });
    expect(classifyDraftChange(clean, [{ ...edited, id: 'other' }], ops)).toEqual({ kind: 'removed' });
  });

  it('does not report the editor’s own delete, nor an editor with nothing open', () => {
    const clean = { item: saved, draft: ops.toDraft(saved) };
    expect(classifyDraftChange({ ...clean, deleting: true }, [], ops)).toEqual({ kind: 'unchanged' });
    expect(classifyDraftChange({}, [saved], ops)).toEqual({ kind: 'unchanged' });
    expect(classifyDraftChange({ item: saved }, [saved], ops)).toEqual({ kind: 'unchanged' });
  });

  it('lets an editor say what counts as an edit (what saving would change)', () => {
    // A trailing space is saved as nothing new: not an edit, so a changed file reloads instead of conflicting.
    const lenient: DraftOps<Item, Draft> = { ...ops, dirty: (draft, current) => draft.name.trim() !== current.name };
    const padded = { item: saved, draft: { name: 'One ' } };
    const edited = item('Two');
    expect(classifyDraftChange(padded, [edited], lenient)).toEqual({ kind: 'reload', item: edited });
    expect(classifyDraftChange(padded, [edited], ops)).toMatchObject({ kind: 'conflict' });
    const mine = { item: saved, draft: { name: 'Mine' } };
    expect(classifyDraftChange(mine, [edited], lenient)).toMatchObject({ kind: 'conflict' });
  });

  it('keeps a dirty draft and reports a conflict when the disk moved on', () => {
    const dirty = { item: saved, draft: { name: 'Mine' } };
    expect(classifyDraftChange(dirty, [item('Two')], ops)).toEqual({
      kind: 'conflict',
      removed: false,
      version: JSON.stringify({ name: 'Two' }),
    });
    expect(classifyDraftChange(dirty, [], ops)).toEqual({ kind: 'conflict', removed: true, version: 'removed' });
    // The disk did not move: nothing to say.
    expect(classifyDraftChange(dirty, [item('One', 't2')], ops)).toEqual({ kind: 'unchanged' });
  });

  it('treats a dirty draft the disk already holds as its own save, not as a conflict', () => {
    const mine = item('Mine', 't9');
    const unsaved = { item: saved, draft: { name: '  Mine ' } };
    expect(classifyDraftChange(unsaved, [mine], ops)).toEqual({ kind: 'reload', item: mine });
    // A draft that cannot be saved never matches the disk.
    expect(classifyDraftChange({ item: saved, draft: { name: ' ' } }, [mine], ops)).toMatchObject({
      kind: 'conflict',
    });
  });

  it('compares drafts by a custom key that leaves out local bookkeeping', () => {
    const withKey: DraftOps<Item, Draft> = { ...ops, key: (draft) => JSON.stringify({ name: draft.name }) };
    // The draft carries a uid the incoming draft does not have: not a change.
    const clean = { item: saved, draft: { name: 'One', uid: 7 } };
    expect(classifyDraftChange(clean, [item('One', 't1')], withKey)).toEqual({ kind: 'unchanged' });
    expect(
      classifyDraftChange({ item: saved, draft: { name: 'Mine', uid: 7 } }, [item('Mine', 't2')], withKey),
    ).toEqual({
      kind: 'reload',
      item: item('Mine', 't2'),
    });
    // The uid does not make the draft dirty: a disk edit still reloads it. By its JSON it would be a conflict.
    expect(classifyDraftChange(clean, [item('Two')], withKey)).toEqual({ kind: 'reload', item: item('Two') });
    expect(classifyDraftChange(clean, [item('Two')], ops)).toMatchObject({ kind: 'conflict' });
  });
});
