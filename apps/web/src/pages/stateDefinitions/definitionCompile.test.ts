import { describe, expect, it } from 'vitest';
import { compile, definitionNameProblem } from './definitionCompile.js';
import { changeKeyType, newKeyDraft, type DefinitionDraft, type KeyDraft } from './definitionDraft.js';
import type { StateKeyType } from '@st/shared';

let rows = 0;
const key = (name: string, type: StateKeyType, extra: Partial<KeyDraft> = {}): KeyDraft => ({
  ...changeKeyType(newKeyDraft(), type),
  uid: `r${++rows}`,
  name,
  ...extra,
});
const draft = (keys: KeyDraft[], extra: Partial<DefinitionDraft> = {}): DefinitionDraft => ({
  name: 'scene',
  description: '',
  keys,
  ...extra,
});
const problemsOf = (keys: KeyDraft[], extra: Partial<DefinitionDraft> = {}, taken: string[] = []) =>
  compile(draft(keys, extra), taken).problems;

describe('names', () => {
  it('asks for a definition name, and rejects names templates cannot use', () => {
    expect(problemsOf([], { name: '' }).name).toBe('Give the definition a name');
    expect(problemsOf([], { name: '  ' }).name).toBe('Give the definition a name');
    for (const name of ['my scene', '1scene', 'this', 'toString', 'a-b'])
      expect(problemsOf([], { name }).name).toMatch(/^Use letters, digits and _/);
    expect(problemsOf([], { name: 'Scene_2' }).name).toBeUndefined();
  });

  it('refuses a name another definition has, ignoring case', () => {
    expect(problemsOf([], { name: 'Scene' }, ['other', 'scene']).name).toBe(
      'A state definition named "Scene" already exists',
    );
    expect(problemsOf([], { name: 'scene' }, ['other']).name).toBeUndefined();
  });

  it('trims the name', () => {
    expect(compile(draft([], { name: ' scene ' })).body?.name).toBe('scene');
  });
});

describe('definitionNameProblem', () => {
  it('gives the reason in plain words, one for every way a name fails', () => {
    expect(definitionNameProblem('', [])).toBe('Give the definition a name');
    expect(definitionNameProblem('a b', [])).toMatch(/^Use letters, digits and _/);
    expect(definitionNameProblem('Scene', ['scene'])).toBe('A state definition named "Scene" already exists');
    expect(definitionNameProblem('scene_copy', ['scene'])).toBeUndefined();
  });
});

describe('key names', () => {
  it('trims a key name, and treats names that differ only by surrounding spaces as one', () => {
    const { body } = compile(draft([key(' mood ', 'text')]));
    expect(Object.keys(body?.keys ?? {})).toEqual(['mood']);
    const [first, again] = [key('mood', 'text'), key(' mood', 'text')];
    expect(compile(draft([first!, again!])).problems.keys[again!.uid]).toEqual(['Another key is already named mood']);
  });

  it('lands each problem on its own row', () => {
    const rowsWithProblems = [
      key('', 'number'),
      key('1a', 'number'),
      key('a b', 'text'),
      key('this', 'text'),
      key('ok', 'text'),
    ];
    const { problems, body } = compile(draft(rowsWithProblems));
    expect(body).toBeUndefined();
    const [empty, digit, space, reserved, fine] = rowsWithProblems;
    expect(problems.keys[empty!.uid]).toEqual(['Give the key a name']);
    expect(problems.keys[digit!.uid]?.[0]).toMatch(/^Use letters, digits and _/);
    expect(problems.keys[space!.uid]?.[0]).toMatch(/^Use letters, digits and _/);
    expect(problems.keys[reserved!.uid]?.[0]).toMatch(/reserved/);
    expect(problems.keys[fine!.uid]).toBeUndefined();
    expect(problems.count).toBe(4);
  });

  it('flags a repeated key name on the later row only, and keeps names case-sensitive', () => {
    const [a, again, upper] = [key('a', 'text'), key('a', 'number'), key('A', 'text')];
    const { problems } = compile(draft([a!, again!, upper!]));
    expect(problems.keys[again!.uid]).toEqual(['Another key is already named a']);
    expect(problems.keys[a!.uid]).toBeUndefined();
    expect(problems.keys[upper!.uid]).toBeUndefined();
    expect(problems.count).toBe(1);
  });
});

describe('typed fields', () => {
  const only = (row: KeyDraft) => compile(draft([row])).problems.keys[row.uid];

  it('reports numbers that are not numbers', () => {
    expect(only(key('n', 'number', { default: 'abc', min: '1,5', max: 'x' }))).toEqual([
      'Default must be a number',
      'Min must be a number',
      'Max must be a number',
    ]);
  });

  it('reports min above max and a default outside the range', () => {
    expect(only(key('n', 'number', { min: '9', max: '1' }))).toEqual(['max 1 must be at least min 9']);
    expect(only(key('n', 'number', { min: '0', max: '5', default: '9' }))?.[0]).toMatch(/default 9 is above max 5/);
    expect(only(key('n', 'number', { min: '0', max: '5', default: '0' }))).toBeUndefined();
  });

  it('reports an enum without options, repeated options and a default that is not an option', () => {
    expect(only(key('m', 'enum'))).toEqual(['An enum needs at least one option']);
    expect(only(key('m', 'enum', { options: 'a\nb\na' }))?.[0]).toMatch(/listed twice/);
    expect(only(key('m', 'enum', { options: 'a\nb', default: 'c' }))?.[0]).toMatch(/not one of its options/);
    expect(only(key('m', 'enum', { options: 'a\nb', default: 'b' }))).toBeUndefined();
  });

  it('reports a collection cap that is not a whole number from 1, and bad field lines', () => {
    expect(only(key('c', 'collection', { cap: '0' }))).toEqual(['Cap must be a whole number, 1 or more']);
    expect(only(key('c', 'collection', { cap: '1.5' }))).toEqual(['Cap must be a whole number, 1 or more']);
    expect(only(key('c', 'collection', { cap: 'x' }))).toEqual(['Cap must be a number']);
    expect(only(key('c', 'collection', { cap: '3', fields: 'a:text\nb:blob' }))).toEqual([
      'Line 2: write name:type, with type text, number or boolean',
    ]);
  });

  it('reports the item fields every item already has', () => {
    const messages = only(key('c', 'collection', { fields: 'id:text\ntext:number\nlevel:number' }));
    expect(messages?.[0]).toMatch(/"id" is part of every item already/);
    expect(only(key('c', 'collection', { fields: 'level:number' }))).toBeUndefined();
  });

  it('reports an object default that is not a JSON object', () => {
    expect(only(key('o', 'object', { default: '{"a":' }))?.[0]).toMatch(/^Default: Not valid JSON/);
    expect(only(key('o', 'object', { default: '[1]' }))).toEqual(['Default: Must be a JSON object, like {"a": 1}']);
    expect(only(key('o', 'object', { default: '{"a":1}' }))).toBeUndefined();
  });

  it('shows the problems of every row at once, and of the name', () => {
    const bad = [key('a', 'number', { min: '5', max: '1' }), key('b', 'enum')];
    const { problems } = compile(draft(bad, { name: '' }));
    expect(problems.count).toBe(3);
    expect(problems.name).toBe('Give the definition a name');
    expect(problems.keys[bad[0]!.uid]).toHaveLength(1);
    expect(problems.keys[bad[1]!.uid]).toHaveLength(1);
  });
});

describe('body', () => {
  it('is built from the rows in order, with blank optional fields left out', () => {
    const result = compile(
      draft(
        [
          key('level', 'number', { default: '1', min: '0', max: '5' }),
          key('flag', 'boolean', { default: 'false' }),
          key('maybe', 'boolean'),
          key('mood', 'enum', { options: 'calm\ntense', default: 'tense' }),
          key('note', 'text', { default: 'hi' }),
          key('blob', 'object', { default: '{"a":1}', rest: { schema: { a: 'number' } } }),
          key('notes', 'collection', { cap: '3', fields: 'weight:number' }),
        ],
        { description: ' about ' },
      ),
    );
    expect(result.problems.count).toBe(0);
    expect(result.body).toEqual({
      name: 'scene',
      description: 'about',
      keys: {
        level: { type: 'number', default: 1, min: 0, max: 5 },
        flag: { type: 'boolean', default: false },
        maybe: { type: 'boolean' },
        mood: { type: 'enum', options: ['calm', 'tense'], default: 'tense' },
        note: { type: 'text', default: 'hi' },
        blob: { type: 'object', default: { a: 1 }, schema: { a: 'number' } },
        notes: { type: 'collection', cap: 3, fields: { weight: 'number' } },
      },
    });
    expect(Object.keys(result.body!.keys)).toEqual(['level', 'flag', 'maybe', 'mood', 'note', 'blob', 'notes']);
  });

  it('is only present without problems, and an empty definition is fine', () => {
    expect(compile(draft([key('', 'text')])).body).toBeUndefined();
    expect(compile(draft([])).body).toEqual({ name: 'scene', keys: {} });
  });
});
