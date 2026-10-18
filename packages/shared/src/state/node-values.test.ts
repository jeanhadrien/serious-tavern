import { describe, expect, it } from 'vitest';
import type { CollectionKeyDef } from './definition.js';
import { collectionItem, itemFieldNeeds, parseDecimal, stateReads, stateReadsFor } from './node-values.js';

describe('parseDecimal', () => {
  it.each<[string, number]>([
    ['3', 3],
    [' -2.5 ', -2.5],
    ['+4', 4],
    ['.5', 0.5],
    ['5.', 5],
    ['1e3', 1000],
    ['2E-2', 0.02],
    ['0', 0],
  ])('reads %j as %d', (text, value) => {
    expect(parseDecimal(text)).toBe(value);
  });

  it.each(['', '  ', 'abc', '0x10', 'Infinity', 'NaN', '1,5', '1 2', '--1', '1e999', '3x'])('rejects %j', (text) => {
    expect(parseDecimal(text)).toBeUndefined();
  });
});

describe('collectionItem', () => {
  const def: CollectionKeyDef = { type: 'collection', fields: { level: 'number', loud: 'boolean', tag: 'text' } };

  it('takes text as it is', () => {
    expect(collectionItem(def, 'a bell')).toEqual({ item: { text: 'a bell' }, ignored: [] });
    expect(collectionItem({ type: 'collection' }, '')).toEqual({ item: { text: '' }, ignored: [] });
  });

  it('keeps the declared fields of the right type and names the others as ignored', () => {
    expect(collectionItem(def, { text: 'a bell', level: 2, loud: true, extra: 1, id: 'x' })).toEqual({
      item: { text: 'a bell', level: 2, loud: true },
      ignored: ['extra', 'id'],
    });
  });

  it('leaves out a declared field that is absent or undefined', () => {
    expect(collectionItem(def, { text: 't', level: undefined })).toEqual({ item: { text: 't' }, ignored: [] });
  });

  it.each<[string, unknown]>([
    ['a number', 5],
    ['null', null],
    ['a list', ['a']],
    ['an object without text', { level: 1 }],
    ['an object whose text is not text', { text: 4 }],
  ])('refuses %s as the wrong shape', (_, value) => {
    expect(collectionItem(def, value).problem).toEqual({ kind: 'shape' });
  });

  it.each<[unknown, 'text' | 'number' | 'boolean', string]>([
    [{ text: 't', level: '2' }, 'number', 'level'],
    [{ text: 't', level: Number.NaN }, 'number', 'level'],
    [{ text: 't', loud: 'yes' }, 'boolean', 'loud'],
    [{ text: 't', tag: 3 }, 'text', 'tag'],
  ])('refuses %j: the field has to be of its declared type', (value, type, name) => {
    const { problem } = collectionItem(def, value);
    expect(problem).toMatchObject({ kind: 'field', name, type });
  });

  it('never stores a messages property of the value, nor an undeclared link, even for a field called messages', () => {
    const value = { text: 't', level: 1, messages: { ids: ['m1'], fingerprint: 'f' }, link: { status: 'intact' } };
    expect(collectionItem(def, value)).toEqual({ item: { text: 't', level: 1 }, ignored: ['messages', 'link'] });
    const odd: CollectionKeyDef = { type: 'collection', fields: { messages: 'text' } };
    expect(collectionItem(odd, { text: 't', messages: 'x' })).toEqual({ item: { text: 't' }, ignored: ['messages'] });
  });

  it('keeps the value of a field called link that an existing definition declares', () => {
    const old: CollectionKeyDef = { type: 'collection', fields: { link: 'text' } };
    expect(collectionItem(old, { text: 't', link: 'https://example.test' })).toEqual({
      item: { text: 't', link: 'https://example.test' },
      ignored: [],
    });
    expect(collectionItem(old, { text: 't', link: 2 }).problem).toMatchObject({ kind: 'field', name: 'link' });
  });

  it('says what each field type needs', () => {
    expect(itemFieldNeeds).toEqual({ text: 'text', number: 'a number', boolean: 'true or false' });
  });
});

it('lists the read modes of State Read, and `linked` only for collections', () => {
  expect([...stateReads]).toEqual(['value', 'meta', 'linked']);
  expect(stateReadsFor('collection')).toEqual(['value', 'meta', 'linked']);
  for (const type of ['number', 'boolean', 'enum', 'text', 'object'] as const)
    expect(stateReadsFor(type)).toEqual(['value', 'meta']);
});
