import { describe, expect, it } from 'vitest';
import type { Collection, CollectionEntry } from '@st/shared';
import {
  classifyCollectionChange,
  draftChanged,
  draftToBody,
  entryPreview,
  listFromText,
  moveEntry,
  newEntry,
  storedForm,
  toDraft,
  toEntryDraft,
} from './collectionDraft.js';

const entry = (fields: Partial<CollectionEntry> = {}): CollectionEntry => ({
  text: 'text',
  weight: 1,
  enabled: true,
  ...fields,
});
const collection = (extra: Partial<Collection> = {}): Collection => ({
  id: '4c8f7d0e-34a3-4c7b-9b1f-6a3f0f2bb0a1',
  name: 'Northern Wastes',
  description: 'Lore',
  entries: [
    entry({ title: 'The Salt Inn', text: 'The inn.\nBy the river.', keywords: ['salt inn', 'Borin'] }),
    entry({ text: 'resin', tags: ['forest'], level: 2, weight: 2.5, enabled: false, id: 'old', extra: { a: 1 } }),
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});
const bodyOf = (draft: ReturnType<typeof toDraft>) => {
  const result = draftToBody(draft);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.body;
};

describe('collection drafts', () => {
  it('round-trips a collection, keeping unknown entry fields', () => {
    const draft = toDraft(collection());
    expect(draft.entries[0]).toMatchObject({ keywords: 'salt inn, Borin', level: '', weight: '1' });
    expect(draft.entries[1]).toMatchObject({ tags: 'forest', level: '2', weight: '2.5', enabled: false });
    expect(bodyOf(draft)).toEqual({
      name: 'Northern Wastes',
      description: 'Lore',
      entries: [
        {
          title: 'The Salt Inn',
          text: 'The inn.\nBy the river.',
          keywords: ['salt inn', 'Borin'],
          weight: 1,
          enabled: true,
        },
        { id: 'old', extra: { a: 1 }, text: 'resin', tags: ['forest'], level: 2, weight: 2.5, enabled: false },
      ],
    });
    expect(draftChanged(draft, collection())).toBe(false);
  });

  it('leaves out blank title, lists, level, weight and description', () => {
    const draft = { name: 'L', description: '  ', entries: [{ ...newEntry(), text: 'x', weight: '' }] };
    expect(bodyOf(draft)).toEqual({ name: 'L', entries: [{ text: 'x', enabled: true }] });
  });

  it('reads weights and reports bad ones by entry', () => {
    const withWeight = (weight: string) => ({
      name: 'L',
      description: '',
      entries: [newEntry(), { ...newEntry(), weight }],
    });
    expect(bodyOf(withWeight('2.5')).entries?.[1]).toMatchObject({ weight: 2.5 });
    expect(bodyOf(withWeight(' 0 ')).entries?.[1]).toMatchObject({ weight: 0 });
    for (const bad of ['-1', 'x', 'Infinity'])
      expect(draftToBody(withWeight(bad))).toEqual({
        ok: false,
        errors: ['Entry 2: weight must be a number of 0 or more'],
      });
  });

  it('names the field of a schema problem', () => {
    expect(draftToBody({ name: ' ', description: '', entries: [] })).toMatchObject({
      ok: false,
      errors: ['Name is required'],
    });
  });

  it('splits comma lists, and keeps a stored list while its text is unchanged', () => {
    expect(listFromText('a, b,, ')).toEqual(['a', 'b']);
    expect(listFromText(' , ')).toBeUndefined();
    expect(listFromText('a, b', ['a, b'])).toEqual(['a, b']);
    expect(listFromText('a, b, c', ['a, b'])).toEqual(['a', 'b', 'c']);
    const stored = toEntryDraft(entry({ keywords: ['one, two'] }));
    expect(bodyOf({ name: 'L', description: '', entries: [stored] }).entries?.[0]?.keywords).toEqual(['one, two']);
  });

  it('counts edits that change what would be saved, not formatting', () => {
    const base = collection();
    const draft = toDraft(base);
    expect(
      draftChanged(
        { ...draft, entries: [{ ...draft.entries[0]!, keywords: 'salt inn,Borin' }, draft.entries[1]!] },
        base,
      ),
    ).toBe(false);
    expect(draftChanged({ ...draft, name: 'Other' }, base)).toBe(true);
    expect(draftChanged({ ...draft, entries: [draft.entries[1]!, draft.entries[0]!] }, base)).toBe(true);
    expect(draftChanged({ ...draft, entries: [{ ...draft.entries[0]!, weight: 'x' }, draft.entries[1]!] }, base)).toBe(
      true,
    );
    // A hand-written title with spaces or an empty description is not an edit.
    const hand = collection({ description: '', entries: [entry({ title: ' Inn ' })] });
    expect(draftChanged(toDraft(hand), hand)).toBe(false);
  });

  it('moves entries within bounds only', () => {
    expect(moveEntry(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveEntry(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b']);
    expect(moveEntry(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveEntry(['a', 'b'], 1, 2)).toEqual(['a', 'b']);
  });

  it.each([
    [{ title: ' The Inn ', text: 'x' }, 'The Inn'],
    [{ title: '', text: '\n  \n  First line\nSecond' }, 'First line'],
    [{ title: '', text: '   ' }, '(empty)'],
    [{ title: '', text: 'y'.repeat(100) }, `${'y'.repeat(79)}…`],
  ])('previews %j as %j', (fields, expected) => {
    expect(entryPreview(fields)).toBe(expected);
  });
});

describe('classifyCollectionChange', () => {
  const base = collection();
  const clean = { collection: base, draft: toDraft(base) };
  const edited = { collection: base, draft: { ...toDraft(base), name: 'Edited' } };

  it('ignores timestamps and key order', () => {
    const { name, ...rest } = base;
    const reordered = { ...rest, updatedAt: 'later', name, entries: base.entries.map((item) => ({ ...item })) };
    expect(classifyCollectionChange(clean, [reordered])).toEqual({ kind: 'unchanged' });
  });

  it('reloads a clean editor and warns about a dirty one, once per disk version', () => {
    const changed = collection({ name: 'Renamed on disk' });
    expect(classifyCollectionChange(clean, [changed])).toEqual({ kind: 'reload', item: changed });
    const first = classifyCollectionChange(edited, [changed]);
    expect(first).toMatchObject({ kind: 'conflict', removed: false });
    expect(classifyCollectionChange(edited, [structuredClone(changed)])).toEqual(first);
  });

  it('treats its own save, seen before the response, as a reload', () => {
    const saved = collection({ name: 'Edited' });
    expect(classifyCollectionChange(edited, [saved])).toEqual({ kind: 'reload', item: saved });
    // The server stores the name trimmed.
    const padded = { collection: base, draft: { ...toDraft(base), name: ' Edited ' } };
    expect(classifyCollectionChange(padded, [saved])).toEqual({ kind: 'reload', item: saved });
  });

  it('sends the name trimmed, so padding alone is not a change', () => {
    const padded = { ...toDraft(base), name: 'Northern Wastes ' };
    expect(bodyOf(padded).name).toBe('Northern Wastes');
    expect(draftChanged(padded, base)).toBe(false);
    expect(draftChanged(padded, base, storedForm(base))).toBe(false);
  });

  it('reports a removed collection, and ignores its own delete', () => {
    expect(classifyCollectionChange(clean, [])).toEqual({ kind: 'removed' });
    expect(classifyCollectionChange(edited, [])).toEqual({ kind: 'conflict', removed: true, version: 'removed' });
    expect(classifyCollectionChange({ ...clean, deleting: true }, [])).toEqual({ kind: 'unchanged' });
    expect(classifyCollectionChange({}, [])).toEqual({ kind: 'unchanged' });
  });
});
