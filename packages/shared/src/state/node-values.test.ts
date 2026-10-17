import { describe, expect, it } from 'vitest';
import type { CollectionKeyDef } from './definition.js';
import { collectionItem, itemFieldNeeds, parseDecimal, stateReads } from './node-values.js';

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

  it('says what each field type needs', () => {
    expect(itemFieldNeeds).toEqual({ text: 'text', number: 'a number', boolean: 'true or false' });
  });
});

it('lists the read modes of State Read', () => {
  expect([...stateReads]).toEqual(['value', 'meta']);
});
