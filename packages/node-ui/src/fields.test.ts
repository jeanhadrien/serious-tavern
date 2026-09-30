import { describe, expect, it } from 'vitest';
import { supportsKeyValueArray, isKeyValueRows, type Field } from './fields.js';

const schema: Field = {
  type: 'array',
  items: {
    type: 'object',
    properties: { key: { type: 'string' }, value: { type: 'string' } },
    required: ['key', 'value'],
  },
};

describe('key/value array support', () => {
  it('accepts only arrays of objects with exactly the required key/value string fields', () => {
    expect(supportsKeyValueArray(schema)).toBe(true);
  });

  it.each([
    {},
    { type: 'array' },
    { type: 'array', items: { type: 'string' } },
    { type: 'array', items: { type: 'number' } },
    { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } },
    { ...schema, type: 'object' },
    { ...schema, items: [schema.items] },
    { ...schema, prefixItems: [] },
    { ...schema, items: { ...schema.items, required: ['key'] } },
    {
      ...schema,
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, value: { type: 'number' } },
        required: ['key', 'value'],
      },
    },
    {
      ...schema,
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, value: { type: 'string' }, extra: { type: 'string' } },
        required: ['key', 'value', 'extra'],
      },
    },
  ])('rejects unsupported schema %j', (field) => {
    expect(supportsKeyValueArray(field as Field)).toBe(false);
  });

  it('accepts empty or string key/value rows without discarding extension values', () => {
    expect(isKeyValueRows([])).toBe(true);
    expect(
      isKeyValueRows([
        { key: '', value: '' },
        { key: 'a', value: 'b', extra: 1 },
      ]),
    ).toBe(true);
  });

  it.each([null, '', {}, [null], ['string'], [[]], [{ key: 'a' }], [{ key: 'a', value: 1 }]])(
    'rejects malformed values %j',
    (value) => {
      expect(isKeyValueRows(value)).toBe(false);
    },
  );
});
