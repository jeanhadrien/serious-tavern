import { describe, expect, it } from 'vitest';
import { collectionEntryId, collectionEntrySchema, collectionFieldsSchema, collectionSchema } from './collection.js';

const stored = {
  id: '11111111-1111-4111-8111-111111111111',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('collection schema', () => {
  it('fills entry defaults and leaves optional fields absent', () => {
    const parsed = collectionSchema.parse({ ...stored, name: 'Lore', entries: [{ text: 'a' }] });
    expect(parsed.entries).toEqual([{ text: 'a', weight: 1, enabled: true }]);
    expect(parsed).not.toHaveProperty('description');
  });

  it('defaults entries to an empty list', () => {
    expect(collectionFieldsSchema.parse({ name: 'Lore' }).entries).toEqual([]);
  });

  it('keeps unknown fields on the record and on entries', () => {
    const parsed = collectionSchema.parse({
      ...stored,
      name: 'Lore',
      source: { kind: 'st' },
      entries: [{ text: 'a', id: 'foo', extensions: { depth: 4 } }],
    });
    expect(parsed.source).toEqual({ kind: 'st' });
    expect(parsed.entries[0]).toMatchObject({ id: 'foo', extensions: { depth: 4 } });
  });

  it('keeps every optional entry field', () => {
    const entry = { text: 't', title: 'T', keywords: ['k'], tags: ['x'], level: 3, weight: 2.5, enabled: false };
    expect(collectionEntrySchema.parse(entry)).toEqual(entry);
  });

  it.each([
    ['level 0', { text: 'a', level: 0 }],
    ['level 6', { text: 'a', level: 6 }],
    ['a fractional level', { text: 'a', level: 2.5 }],
    ['a negative weight', { text: 'a', weight: -1 }],
    ['no text', { title: 'x' }],
    ['keywords as text', { text: 'a', keywords: 'x' }],
    ['a null title', { text: 'a', title: null }],
  ])('rejects an entry with %s', (_, entry) => {
    expect(collectionEntrySchema.safeParse(entry).success).toBe(false);
  });

  it('rejects a blank name and a non-UUID id', () => {
    expect(collectionFieldsSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(collectionSchema.safeParse({ ...stored, id: 'lore', name: 'Lore' }).success).toBe(false);
  });

  it('derives entry ids from positions', () => {
    expect(collectionEntryId(0)).toBe('entry-1');
    expect(collectionEntryId(9)).toBe('entry-10');
  });
});
