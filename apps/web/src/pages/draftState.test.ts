import { describe, expect, it } from 'vitest';
import { draftReducer, isDirty, jsonKey, type DraftState } from './draftState.js';

interface Item {
  id: string;
  name: string;
  tags: string[];
}
const item: Item = { id: 'a', name: 'Ann', tags: ['x'] };

describe('draftReducer', () => {
  it('load makes draft and saved the item, with the draft a separate copy', () => {
    const state = draftReducer<Item>({}, { type: 'load', item });
    expect(state.saved).toBe(item);
    expect(state.draft).toEqual(item);
    expect(state.draft).not.toBe(item);
    state.draft!.tags.push('y');
    expect(item.tags).toEqual(['x']);
  });

  it('set edits the draft only, and does nothing while nothing is open', () => {
    expect(draftReducer<Item>({}, { type: 'set', draft: item })).toEqual({});
    const loaded = draftReducer<Item>({}, { type: 'load', item });
    const edited = draftReducer(loaded, { type: 'set', draft: { ...item, name: 'Bo' } });
    expect(edited.draft?.name).toBe('Bo');
    expect(edited.saved).toBe(item);
  });

  it('revert puts a copy of the saved item back, and does nothing while nothing is open', () => {
    expect(draftReducer<Item>({}, { type: 'revert' })).toEqual({});
    const edited: DraftState<Item> = { saved: item, draft: { ...item, name: 'Bo' } };
    const reverted = draftReducer(edited, { type: 'revert' });
    expect(reverted.draft).toEqual(item);
    expect(reverted.draft).not.toBe(item);
    expect(reverted.saved).toBe(item);
  });

  it('clear closes the item', () => {
    const loaded = draftReducer<Item>({}, { type: 'load', item });
    expect(draftReducer(loaded, { type: 'clear' })).toEqual({});
  });
});

describe('isDirty', () => {
  const savedKey = jsonKey(item);
  it.each([
    ['nothing open', undefined, undefined, false],
    ['an unchanged draft', { ...item }, savedKey, false],
    ['an edited draft', { ...item, name: 'Bo' }, savedKey, true],
    ['a draft without a saved key', item, undefined, false],
  ])('%s', (_name, draft, key, expected) => {
    expect(isDirty(draft, key, jsonKey)).toBe(expected);
  });

  it('compares through a custom key', () => {
    const byName = (value: Item) => value.name;
    expect(isDirty({ ...item, tags: ['z'] }, 'Ann', byName)).toBe(false);
    expect(isDirty({ ...item, name: 'Bo' }, 'Ann', byName)).toBe(true);
  });
});
