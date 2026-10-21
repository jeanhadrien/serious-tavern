import { describe, expect, it } from 'vitest';
import {
  clampToKey,
  incrementedValue,
  keyDefault,
  keyValueProblem,
  stateDefinitionSchema,
  stateDefinitionWriteSchema,
  stateKeyDefSchema,
  stateKeyPortType,
  stateKeyTypes,
  stateOpsFor,
  type StateKeyDef,
} from './definition.js';

const stored = {
  id: '11111111-1111-4111-8111-111111111111',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const scene = {
  name: 'scene',
  description: 'Pacing state',
  keys: {
    tension: { type: 'number', default: 3, min: 0, max: 10 },
    mood: { type: 'enum', options: ['calm', 'tense'], default: 'calm' },
    injected: { type: 'collection', cap: 30, fields: { level: 'number', entryId: 'text' } },
  },
};

describe('stateDefinitionSchema', () => {
  it('accepts a full definition and keeps every field', () => {
    expect(stateDefinitionSchema.parse({ ...stored, ...scene })).toEqual({ ...stored, ...scene });
  });

  it('accepts one key of every type', () => {
    const keys = {
      a: { type: 'number' },
      b: { type: 'boolean', default: true },
      c: { type: 'enum', options: ['x'] },
      d: { type: 'text', default: 'hi' },
      e: { type: 'object', default: { n: 1 }, schema: { type: 'object' } },
      f: { type: 'collection' },
      g: { type: 'thread', cap: 4, description: 'What the scenarist did' },
    };
    expect(stateDefinitionSchema.safeParse({ ...stored, name: 'all', keys }).success).toBe(true);
    expect([...stateKeyTypes].sort()).toEqual(
      Object.values(keys)
        .map((key) => key.type)
        .sort(),
    );
  });

  it('keeps unknown fields on the record and on keys', () => {
    const parsed = stateDefinitionSchema.parse({
      ...stored,
      name: 'x',
      source: { kind: 'import' },
      keys: { n: { type: 'number', unit: 'points' } },
    });
    expect(parsed.source).toEqual({ kind: 'import' });
    expect(parsed.keys.n).toMatchObject({ unit: 'points' });
  });

  it('defaults keys to an empty record in a stored definition, but requires them in a write', () => {
    expect(stateDefinitionSchema.parse({ ...stored, name: 'x' }).keys).toEqual({});
    expect(stateDefinitionWriteSchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(stateDefinitionWriteSchema.parse({ name: 'x', keys: {}, extra: 1 })).toEqual({
      name: 'x',
      keys: {},
      extra: 1,
    });
  });

  it('keeps the identity fields required on a stored definition', () => {
    expect(stateDefinitionSchema.safeParse({ name: 'x', keys: {} }).success).toBe(false);
    expect(stateDefinitionSchema.safeParse({ ...stored, id: 'not-a-uuid', name: 'x' }).success).toBe(false);
  });

  it.each(['constructor', 'prototype', 'this', 'true', 'null', 'undefined', 'toString', '1x', 'a b', 'a-b', '', 'é'])(
    'rejects %j as a definition name and as a key name',
    (name) => {
      expect(stateDefinitionWriteSchema.safeParse({ name, keys: {} }).success).toBe(false);
      expect(stateDefinitionWriteSchema.safeParse({ name: 'ok', keys: { [name]: { type: 'text' } } }).success).toBe(
        false,
      );
    },
  );

  it('rejects __proto__ as a definition name, and drops it as a key (zod never builds such a record key)', () => {
    expect(stateDefinitionWriteSchema.safeParse({ name: '__proto__', keys: {} }).success).toBe(false);
    const parsed = stateDefinitionWriteSchema.parse(JSON.parse('{"name":"ok","keys":{"__proto__":{"type":"text"}}}'));
    expect(Object.keys(parsed.keys)).toEqual([]);
    expect(Object.getPrototypeOf(parsed.keys)).toBe(Object.prototype);
  });

  it.each(['scene', '_hidden', 'Scene2', 'a_b_c', 'x'])('accepts %j as a name', (name) => {
    expect(stateDefinitionWriteSchema.safeParse({ name, keys: { [name]: { type: 'text' } } }).success).toBe(true);
  });

  it.each<[string, unknown, string]>([
    ['an unknown type', { name: 'x', keys: { a: { type: 'date' } } }, 'keys.a.type'],
    ['an enum without options', { name: 'x', keys: { a: { type: 'enum', options: [] } } }, 'keys.a.options'],
    ['an enum with no options field', { name: 'x', keys: { a: { type: 'enum' } } }, 'keys.a.options'],
    ['numeric enum options', { name: 'x', keys: { a: { type: 'enum', options: [1, 2] } } }, 'keys.a.options.0'],
    [
      'duplicate enum options',
      { name: 'x', keys: { a: { type: 'enum', options: ['a', 'b', 'a'] } } },
      'keys.a.options',
    ],
    [
      'an enum default that is not an option',
      { name: 'x', keys: { a: { type: 'enum', options: ['a'], default: 'z' } } },
      'keys.a.default',
    ],
    ['min above max', { name: 'x', keys: { a: { type: 'number', min: 5, max: 1 } } }, 'keys.a.max'],
    ['a default above max', { name: 'x', keys: { a: { type: 'number', max: 5, default: 6 } } }, 'keys.a.default'],
    ['a default below min', { name: 'x', keys: { a: { type: 'number', min: 1, default: 0 } } }, 'keys.a.default'],
    ['a text number default', { name: 'x', keys: { a: { type: 'number', default: '3' } } }, 'keys.a.default'],
    [
      'a non-finite default',
      { name: 'x', keys: { a: { type: 'number', default: Number.POSITIVE_INFINITY } } },
      'keys.a.default',
    ],
    ['a text boolean default', { name: 'x', keys: { a: { type: 'boolean', default: 'yes' } } }, 'keys.a.default'],
    ['an array object default', { name: 'x', keys: { a: { type: 'object', default: [] } } }, 'keys.a.default'],
    ['a cap of 0', { name: 'x', keys: { a: { type: 'collection', cap: 0 } } }, 'keys.a.cap'],
    ['a fractional cap', { name: 'x', keys: { a: { type: 'collection', cap: 1.5 } } }, 'keys.a.cap'],
    ['a field named id', { name: 'x', keys: { a: { type: 'collection', fields: { id: 'text' } } } }, 'keys.a.fields'],
    [
      'a field named messages (the built-in link)',
      { name: 'x', keys: { a: { type: 'collection', fields: { messages: 'text' } } } },
      'keys.a.fields',
    ],
    [
      'a field named link (the computed link)',
      { name: 'x', keys: { a: { type: 'collection', fields: { link: 'text' } } } },
      'keys.a.fields',
    ],
    [
      'a field named text',
      { name: 'x', keys: { a: { type: 'collection', fields: { text: 'text' } } } },
      'keys.a.fields',
    ],
    [
      'an unknown field type',
      { name: 'x', keys: { a: { type: 'collection', fields: { w: 'date' } } } },
      'keys.a.fields.w',
    ],
    ['no name', { keys: {} }, 'name'],
    ['keys as a list', { name: 'x', keys: [] }, 'keys'],
    ['null keys', { name: 'x', keys: null }, 'keys'],
  ])('rejects %s', (_, input, path) => {
    const parsed = stateDefinitionWriteSchema.safeParse(input);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path.join('.')).toBe(path);
  });

  it('accepts a stored definition that already declares a field called messages or link (only writes refuse it)', () => {
    const keys = { a: { type: 'collection', fields: { messages: 'text', link: 'number' } } };
    expect(stateDefinitionSchema.safeParse({ ...stored, name: 'old', keys }).success).toBe(true);
  });

  it('reads like `invalid state definition: keys.tension.max: ...` for a reversed range', () => {
    const issue = stateDefinitionWriteSchema.safeParse({
      name: 'x',
      keys: { tension: { type: 'number', min: 5, max: 1 } },
    }).error?.issues[0];
    expect(issue?.message).toBe('tension: max 1 must be at least min 5');
  });

  it('accepts a number default on the bounds and a missing default', () => {
    expect(
      stateDefinitionWriteSchema.safeParse({ name: 'x', keys: { a: { type: 'number', min: 0, max: 5, default: 5 } } })
        .success,
    ).toBe(true);
    expect(stateDefinitionWriteSchema.safeParse({ name: 'x', keys: { a: { type: 'number', min: 2 } } }).success).toBe(
      true,
    );
  });
});

describe('keyDefault', () => {
  it.each<[string, StateKeyDef, unknown]>([
    ['a number without default', { type: 'number' }, 0],
    ['a number with default', { type: 'number', default: 3 }, 3],
    ['a number whose bounds exclude 0 (kept inside them)', { type: 'number', min: 2, max: 4 }, 2],
    ['a number whose upper bound is below 0', { type: 'number', max: -3 }, -3],
    ['a boolean without default', { type: 'boolean' }, false],
    ['a boolean with default', { type: 'boolean', default: true }, true],
    ['an enum without default', { type: 'enum', options: ['a', 'b'] }, 'a'],
    ['an enum with default', { type: 'enum', options: ['a', 'b'], default: 'b' }, 'b'],
    ['an enum whose default is no option (hand-built)', { type: 'enum', options: ['a', 'b'], default: 'z' }, 'a'],
    ['a text without default', { type: 'text' }, ''],
    ['a text with default', { type: 'text', default: 'hi' }, 'hi'],
    ['an object without default', { type: 'object' }, {}],
    ['an object with default', { type: 'object', default: { a: { b: 1 } } }, { a: { b: 1 } }],
    ['a collection', { type: 'collection', cap: 3 }, []],
    ['a thread', { type: 'thread', cap: 3 }, []],
  ])('gives %s', (_, def, expected) => {
    expect(keyDefault(def)).toEqual(expected);
  });

  it('returns a fresh value every time, so a caller can change it', () => {
    const object: StateKeyDef = { type: 'object', default: { a: { b: 1 } } };
    const first = keyDefault(object) as { a: { b: number } };
    first.a.b = 2;
    expect(keyDefault(object)).toEqual({ a: { b: 1 } });
    expect(object).toEqual({ type: 'object', default: { a: { b: 1 } } });
    const list = keyDefault({ type: 'collection' });
    expect(keyDefault({ type: 'collection' })).not.toBe(list);
  });
});

describe('keyValueProblem', () => {
  const number: StateKeyDef = { type: 'number', min: 0, max: 10 };
  const mood: StateKeyDef = { type: 'enum', options: ['calm', 'tense'] };
  it.each<[string, StateKeyDef, unknown, string | undefined]>([
    ['a number inside the bounds', number, 5, undefined],
    ['a number on the lower bound', number, 0, undefined],
    ['a number on the upper bound', number, 10, undefined],
    ['a number below min', number, -1, 'is below min 0'],
    ['a number above max', number, 11, 'is above max 10'],
    ['a number stored as text', number, '5', 'is not a number'],
    ['NaN', number, Number.NaN, 'is not a number'],
    ['Infinity', { type: 'number' }, Number.POSITIVE_INFINITY, 'is not a number'],
    ['null for a number', number, null, 'is not a number'],
    ['a number without bounds', { type: 'number' }, -1e9, undefined],
    ['true for a boolean', { type: 'boolean' }, true, undefined],
    ['a number for a boolean', { type: 'boolean' }, 1, 'is not true or false'],
    ['an enum option', mood, 'calm', undefined],
    ['a text outside the options', mood, 'happy', 'is not one of: calm, tense'],
    ['a number for an enum', mood, 1, 'is not one of: calm, tense'],
    ['a text', { type: 'text' }, '', undefined],
    ['a number for a text', { type: 'text' }, 5, 'is not text'],
    ['a plain object', { type: 'object' }, { a: 1 }, undefined],
    ['an empty object', { type: 'object' }, {}, undefined],
    ['an array for an object', { type: 'object' }, [], 'is not an object'],
    ['null for an object', { type: 'object' }, null, 'is not an object'],
    ['text for an object', { type: 'object' }, 'x', 'is not an object'],
  ])('%s', (_, def, value, problem) => {
    if (def.type === 'collection' || def.type === 'thread') throw new Error('scalar keys only');
    expect(keyValueProblem(def, value)).toBe(problem);
  });
});

describe('clampToKey', () => {
  it.each<[number | undefined, number | undefined, number, number]>([
    [0, 10, 5, 5],
    [0, 10, -3, 0],
    [0, 10, 13, 10],
    [0, 10, 0, 0],
    [0, 10, 10, 10],
    [undefined, 10, -100, -100],
    [undefined, 10, 100, 10],
    [0, undefined, -1, 0],
    [0, undefined, 1e9, 1e9],
    [undefined, undefined, 42, 42],
  ])('min %s max %s: %s becomes %s', (min, max, value, expected) => {
    expect(clampToKey({ type: 'number', min, max }, value)).toBe(expected);
  });
});

describe('incrementedValue', () => {
  const tension: Extract<StateKeyDef, { type: 'number' }> = { type: 'number', default: 3, min: 0, max: 10 };

  it.each<[unknown, number, number]>([
    [4, 2, 6],
    [4, -2, 2],
    [9, 5, 10],
    [1, -5, 0],
    // Anything that is not a number starts from the key's default.
    [undefined, 2, 5],
    ['7', 2, 5],
    [null, -9, 0],
  ])('%j plus %s is %s', (current, by, expected) => {
    expect(incrementedValue(tension, current, by)).toBe(expected);
  });
});

describe('type tables', () => {
  it.each([
    ['number', ['set', 'increment', 'delete']],
    ['boolean', ['set', 'delete']],
    ['enum', ['set', 'delete']],
    ['text', ['set', 'delete']],
    ['object', ['set', 'delete']],
    ['collection', ['add', 'remove', 'delete']],
    ['thread', ['add', 'remove', 'delete']],
  ] as const)('%s allows %j', (type, ops) => {
    expect(stateOpsFor(type)).toEqual(ops);
  });

  it.each([
    ['number', 'number'],
    ['boolean', 'boolean'],
    ['enum', 'text'],
    ['text', 'text'],
    ['object', 'object'],
    ['collection', 'array'],
    ['thread', 'array'],
  ] as const)('%s travels as %s', (type, port) => {
    expect(stateKeyPortType(type)).toBe(port);
  });

  it('covers every key type', () => {
    for (const type of stateKeyTypes) {
      expect(stateOpsFor(type).length).toBeGreaterThan(0);
      expect(stateKeyPortType(type)).toBeTruthy();
    }
    expect(stateKeyDefSchema.options.map((option) => option.shape.type.value).sort()).toEqual(
      [...stateKeyTypes].sort(),
    );
  });
});
