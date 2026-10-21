import { describe, expect, it } from 'vitest';
import { stateNodeOps, stateOpsFor, type CollectionKeyDef, type StateKeyDef, type StateKeyType } from '@st/shared';
import {
  boundsHint,
  fixedValueProblem,
  itemParts,
  itemValue,
  parseNumber,
  parseObject,
  valueKind,
  pickOp,
  withFixedValue,
  type ValueKind,
} from './stateValue.js';

const defs: Record<StateKeyType, StateKeyDef> = {
  number: { type: 'number', min: 0, max: 10 },
  boolean: { type: 'boolean' },
  enum: { type: 'enum', options: ['calm', 'tense'] },
  text: { type: 'text' },
  object: { type: 'object' },
  collection: { type: 'collection', fields: { level: 'number', note: 'text', hot: 'boolean' } },
  thread: { type: 'thread' },
};
const injected = defs.collection as CollectionKeyDef;

describe('valueKind', () => {
  // Every allowed operation of every type, written out: a new operation or type fails here until it is handled.
  const expected: Record<string, ValueKind> = {
    'number:set': 'number',
    'number:increment': 'amount',
    'number:delete': 'none',
    'boolean:set': 'boolean',
    'boolean:delete': 'none',
    'enum:set': 'enum',
    'enum:delete': 'none',
    'text:set': 'text',
    'text:delete': 'none',
    'object:set': 'object',
    'object:delete': 'none',
    'collection:add': 'item',
    'collection:remove': 'itemId',
    'collection:delete': 'none',
    // A thread has no fixed value: the engine ignores one (an exchange comes from an LLM node's output).
    'thread:add': 'none',
    'thread:remove': 'none',
    'thread:delete': 'none',
  };

  it.each(Object.keys(defs) as StateKeyType[])('has a kind for each operation a %s key allows', (type) => {
    for (const op of stateOpsFor(type)) {
      expect(expected, `${type}:${op}`).toHaveProperty(`${type}:${op}`);
      expect(valueKind(defs[type], op)).toBe(expected[`${type}:${op}`]);
    }
  });

  it('covers every entry of the table through some allowed operation', () => {
    const reachable = Object.keys(defs).flatMap((type) =>
      stateOpsFor(type as StateKeyType).map((op) => `${type}:${op}`),
    );
    expect(reachable.sort()).toEqual(Object.keys(expected).sort());
  });

  it('is none for an operation the key does not allow', () => {
    for (const type of Object.keys(defs) as StateKeyType[])
      for (const op of stateNodeOps.filter((candidate) => !stateOpsFor(type).includes(candidate)))
        expect(valueKind(defs[type], op), `${type}:${op}`).toBe('none');
  });
});

describe('parseNumber', () => {
  it.each([
    ['', null],
    ['  ', null],
    ['0', 0],
    ['-2.5', -2.5],
    [' 7 ', 7],
    ['1e3', 1000],
    ['.5', 0.5],
    ['2.', 2],
  ])('reads %j as %j', (text, value) => expect(parseNumber(text)).toBe(value));

  it.each(['x', '1,5', '1 2', '-', '--1', '0x10', 'Infinity', 'NaN', '1e999'])('rejects %j', (text) =>
    expect(parseNumber(text)).toBeUndefined(),
  );
});

describe('parseObject', () => {
  it('reads a JSON object, and blank as none', () => {
    expect(parseObject('{"a":1}')).toEqual({ a: 1 });
    expect(parseObject(' {} ')).toEqual({});
    expect(parseObject('')).toBeNull();
    expect(parseObject('\n')).toBeNull();
  });

  it.each(['[1]', '3', '"x"', 'null', 'true', '{"a":', '{a:1}'])('rejects %s', (text) =>
    expect(parseObject(text)).toBeUndefined(),
  );
});

describe('items', () => {
  it('splits a stored item into its text and declared fields', () => {
    expect(itemParts('a bell', injected)).toEqual({ text: 'a bell', fields: {} });
    expect(itemParts({ text: 'a bell', level: 2, extra: 1 }, injected)).toEqual({
      text: 'a bell',
      fields: { level: 2 },
    });
    expect(itemParts({ level: 2 }, injected)).toEqual({ text: '', fields: { level: 2 } });
    expect(itemParts(undefined, injected)).toEqual({ text: '', fields: {} });
    expect(itemParts(5, injected)).toEqual({ text: '', fields: {} });
    expect(itemParts({ text: 'x' }, { type: 'collection' })).toEqual({ text: 'x', fields: {} });
  });

  it('builds the value from the pieces: nothing, just the text, or an object', () => {
    expect(itemValue({ text: '', fields: {} }, injected)).toBeUndefined();
    expect(itemValue({ text: '', fields: { level: '', note: undefined } }, injected)).toBeUndefined();
    expect(itemValue({ text: 'a bell', fields: {} }, injected)).toBe('a bell');
    expect(itemValue({ text: 'a bell', fields: { level: 2 } }, injected)).toEqual({ text: 'a bell', level: 2 });
    expect(itemValue({ text: 'a bell', fields: { hot: false, level: 0 } }, injected)).toEqual({
      text: 'a bell',
      hot: false,
      level: 0,
    });
    // Only declared fields count.
    expect(itemValue({ text: 'a bell', fields: { other: 1 } }, injected)).toBe('a bell');
    // A field without text is still a value (the node will say the text is missing).
    expect(itemValue({ text: '', fields: { level: 2 } }, injected)).toEqual({ text: '', level: 2 });
  });

  it('keeps fields of the previous value the key does not declare', () => {
    const previous = { text: 'old', level: 1, entryId: 'e1' };
    expect(itemValue({ text: 'new', fields: { level: 1 } }, injected, previous)).toEqual({
      text: 'new',
      level: 1,
      entryId: 'e1',
    });
    expect(itemValue({ text: 'new', fields: {} }, injected, previous)).toEqual({ text: 'new', entryId: 'e1' });
    // Clearing everything removes the value, whatever it kept.
    expect(itemValue({ text: '', fields: {} }, injected, previous)).toBeUndefined();
    expect(itemValue({ text: 'new', fields: {} }, injected, 'plain text')).toBe('new');
  });

  it('round-trips', () => {
    for (const value of ['a bell', { text: 'a bell', level: 2, note: 'x', hot: true }])
      expect(itemValue(itemParts(value, injected), injected, value)).toEqual(value);
  });
});

describe('pickOp', () => {
  it('sets the operation and drops the fixed value, which was typed for the old one', () => {
    const config = { definitionId: 'd', key: 'k', op: 'set', value: 5 };
    expect(pickOp(config, 'increment')).toEqual({ definitionId: 'd', key: 'k', op: 'increment' });
    expect(pickOp(config, 'delete')).not.toHaveProperty('value');
  });

  it('keeps the other settings and does not change its input', () => {
    const config = { definitionId: 'd', key: 'k', op: 'set', value: 'x' };
    pickOp(config, 'delete');
    expect(config).toEqual({ definitionId: 'd', key: 'k', op: 'set', value: 'x' });
    expect(pickOp({ definitionId: 'd', key: 'k', op: 'set' }, 'delete')).toEqual({
      definitionId: 'd',
      key: 'k',
      op: 'delete',
    });
  });
});

describe('withFixedValue', () => {
  const config = { definitionId: 'd', key: 'k', op: 'set', value: 3 };

  it('removes the setting for no value, never storing an empty one', () => {
    expect(withFixedValue(config, undefined)).toEqual({ definitionId: 'd', key: 'k', op: 'set' });
    expect(withFixedValue(config, null)).not.toHaveProperty('value');
    expect(Object.keys(withFixedValue(config, undefined))).not.toContain('value');
    expect(withFixedValue({ ...config, value: undefined }, undefined)).not.toHaveProperty('value');
  });

  it.each([[0], [false], [''], ['tense'], [{ a: 1 }], [[]]])('keeps %j as a value', (value) => {
    expect(withFixedValue(config, value)).toEqual({ ...config, value });
  });

  it('does not touch the config it was given', () => {
    withFixedValue(config, undefined);
    expect(config.value).toBe(3);
  });
});

describe('fixedValueProblem', () => {
  const problem = (type: StateKeyType, op: (typeof stateNodeOps)[number], value: unknown) =>
    fixedValueProblem(defs[type], op, value);

  it('has no problem without a value, for a reset, or for an operation the key does not allow', () => {
    expect(problem('number', 'set', undefined)).toBeUndefined();
    expect(problem('number', 'set', null)).toBeUndefined();
    expect(problem('number', 'delete', 'anything')).toBeUndefined();
    expect(problem('text', 'increment', 'anything')).toBeUndefined();
  });

  it('accepts numbers, clamping later: a value outside the bounds is not a problem', () => {
    expect(problem('number', 'set', 5)).toBeUndefined();
    expect(problem('number', 'set', 99)).toBeUndefined();
    expect(problem('number', 'increment', -3)).toBeUndefined();
    expect(problem('number', 'set', '5')).toBe('The fixed value is not a number');
    expect(problem('number', 'increment', Number.NaN)).toBe('The fixed value is not a number');
    expect(problem('number', 'set', true)).toBe('The fixed value is not a number');
  });

  it('checks scalars like the node does', () => {
    expect(problem('boolean', 'set', false)).toBeUndefined();
    expect(problem('boolean', 'set', 'true')).toBe('The fixed value is not true or false');
    expect(problem('enum', 'set', 'calm')).toBeUndefined();
    expect(problem('enum', 'set', 'sad')).toBe('The fixed value is not one of: calm, tense');
    expect(problem('text', 'set', 'hi')).toBeUndefined();
    expect(problem('text', 'set', '')).toBeUndefined();
    expect(problem('text', 'set', 5)).toBe('The fixed value is not text');
    expect(problem('object', 'set', { a: 1 })).toBeUndefined();
    expect(problem('object', 'set', [1])).toBe('The fixed value is not an object');
    expect(problem('object', 'set', '{"a":1}')).toBe('The fixed value is not an object');
  });

  it('checks an item to add: text, or an object with text and fitting declared fields', () => {
    expect(problem('collection', 'add', 'a bell')).toBeUndefined();
    expect(problem('collection', 'add', { text: 'a bell', level: 2, note: 'x', hot: true })).toBeUndefined();
    // Undeclared fields are dropped by the node, not refused.
    expect(problem('collection', 'add', { text: 'a bell', other: 1 })).toBeUndefined();
    expect(problem('collection', 'add', { level: 2 })).toBe(
      'The fixed item must be text, or an object with a text field',
    );
    expect(problem('collection', 'add', 5)).toBe('The fixed item must be text, or an object with a text field');
    expect(problem('collection', 'add', { text: 'a', level: 'two' })).toBe(
      'The fixed item\'s field "level" must be a number',
    );
    expect(problem('collection', 'add', { text: 'a', hot: 'yes' })).toBe(
      'The fixed item\'s field "hot" must be true or false',
    );
    expect(problem('collection', 'add', { text: 'a', note: 3 })).toBe('The fixed item\'s field "note" must be text');
  });

  it('checks an item id to remove', () => {
    expect(problem('collection', 'remove', 'e1')).toBeUndefined();
    expect(problem('collection', 'remove', ' ')).toBe('The fixed item id must be text');
    expect(problem('collection', 'remove', 3)).toBe('The fixed item id must be text');
  });
});

describe('boundsHint', () => {
  it('says where a number key stays', () => {
    expect(boundsHint({ type: 'number', min: 0, max: 10 })).toBe(
      'The key stays between 0 and 10: a value outside is clamped.',
    );
    expect(boundsHint({ type: 'number', min: 1 })).toBe('The key stays at least 1: a value outside is clamped.');
    expect(boundsHint({ type: 'number', max: 5 })).toBe('The key stays at most 5: a value outside is clamped.');
    expect(boundsHint({ type: 'number', min: 0 })).toContain('at least 0');
  });

  it('has nothing to say without bounds or for another type', () => {
    expect(boundsHint({ type: 'number' })).toBeUndefined();
    expect(boundsHint({ type: 'text' })).toBeUndefined();
  });
});
