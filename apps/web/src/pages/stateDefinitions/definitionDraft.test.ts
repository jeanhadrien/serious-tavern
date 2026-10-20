import { describe, expect, it } from 'vitest';
import type { StateDefinition } from '@st/shared';
import { compile } from './definitionCompile.js';
import {
  changeKeyType,
  classifyDefinitionChange,
  draftChanged,
  newKeyDraft,
  toDraft,
  type DefinitionDraft,
} from './definitionDraft.js';
import { definition } from './test-fixtures.js';

const bodyOf = (draft: DefinitionDraft) => {
  const { body, problems } = compile(draft);
  expect(problems.count).toBe(0);
  return body;
};

describe('toDraft and compile', () => {
  it('give back the stored keys for every key type', () => {
    const stored = definition();
    expect(bodyOf(toDraft(stored))).toEqual({ name: 'scene', description: 'The scene so far', keys: stored.keys });
  });

  it('keeps 0 as a value, never as "blank"', () => {
    const draft = toDraft(definition());
    const level = draft.keys.find((key) => key.name === 'level');
    expect([level?.default, level?.min]).toEqual(['0', '0']);
    expect(bodyOf(draft)?.keys.level).toEqual({ type: 'number', default: 0, min: 0 });
  });

  it('keeps unknown key properties, and an object key schema, out of the form but in the body', () => {
    const draft = toDraft(definition());
    const flags = draft.keys.find((key) => key.name === 'flags');
    expect(flags?.rest).toEqual({ schema: { a: 'number' }, 'x-note': 'keep me' });
    expect(flags?.default).toBe('{\n  "a": 1\n}');
    expect(bodyOf(draft)?.keys.flags).toMatchObject({ schema: { a: 'number' }, 'x-note': 'keep me' });
  });

  it('keeps a key description out of the unknown properties, trims it, and drops a blank one', () => {
    const stored = definition({ keys: { tension: { type: 'number', description: 'How tense it is', max: 10 } } });
    const draft = toDraft(stored);
    expect(draft.keys[0]).toMatchObject({ description: 'How tense it is', rest: {} });
    expect(bodyOf(draft)?.keys.tension).toEqual({ type: 'number', description: 'How tense it is', max: 10 });
    const edited = { ...draft, keys: [{ ...draft.keys[0]!, description: '  Tension  ' }] };
    expect(bodyOf(edited)?.keys.tension).toMatchObject({ description: 'Tension' });
    expect(draftChanged(edited, stored)).toBe(true);
    expect(bodyOf({ ...draft, keys: [{ ...draft.keys[0]!, description: ' ' }] })?.keys.tension).toEqual({
      type: 'number',
      max: 10,
    });
  });

  it('keeps the description when the key type changes', () => {
    const key = { ...newKeyDraft(), name: 'k', description: 'About k', min: '1' };
    expect(changeKeyType(key, 'text')).toMatchObject({ description: 'About k', min: '' });
  });

  it('numbers the rows k0..kn in key order', () => {
    expect(toDraft(definition()).keys.map((key) => key.uid)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6']);
  });

  it('does not carry unknown top-level fields (the server keeps them)', () => {
    const draft = toDraft({ ...definition(), futureField: 1 } as StateDefinition);
    expect(Object.keys(draft).sort()).toEqual(['description', 'keys', 'name']);
    expect(bodyOf(draft)).not.toHaveProperty('futureField');
  });

  it('omits a blank description and blank optional fields', () => {
    const draft: DefinitionDraft = {
      name: 'a',
      description: '  ',
      keys: [
        { ...newKeyDraft(), name: 'n' },
        { ...changeKeyType(newKeyDraft(), 'text'), name: 't' },
      ],
    };
    expect(bodyOf(draft)).toEqual({ name: 'a', keys: { n: { type: 'number' }, t: { type: 'text' } } });
  });
});

describe('changeKeyType', () => {
  it('clears what belonged to the old type and keeps the name and unknown properties', () => {
    const number = { ...toDraft(definition()).keys[0]!, rest: { 'x-note': 'n', min: 'stale' } };
    const changed = changeKeyType(number, 'boolean');
    expect(changed).toMatchObject({ uid: number.uid, name: 'tension', type: 'boolean', default: '', min: '', max: '' });
    expect(changed.rest).toEqual({ 'x-note': 'n', min: 'stale' });
    // A property the new type edits does not travel as an unknown one.
    expect(changeKeyType(number, 'number').rest).toEqual({ 'x-note': 'n' });
  });
});

describe('draftChanged', () => {
  it('ignores row uids: deleting a key and adding an identical one is clean', () => {
    const stored = definition();
    const draft = toDraft(stored);
    const [first, ...others] = draft.keys;
    const readded = { ...first!, uid: 'n99' };
    expect(draftChanged({ ...draft, keys: [readded, ...others] }, stored)).toBe(false);
    expect(draftChanged(draft, stored)).toBe(false);
  });

  it('notices edits of the name, description, key order and any key field', () => {
    const stored = definition();
    const draft = toDraft(stored);
    expect(draftChanged({ ...draft, name: 'scene2' }, stored)).toBe(true);
    expect(draftChanged({ ...draft, description: '' }, stored)).toBe(true);
    expect(draftChanged({ ...draft, keys: draft.keys.slice(1) }, stored)).toBe(true);
    expect(draftChanged({ ...draft, keys: [{ ...draft.keys[0]!, max: '11' }, ...draft.keys.slice(1)] }, stored)).toBe(
      true,
    );
  });
});

describe('classifyDefinitionChange', () => {
  const stored = definition();
  const clean = { definition: stored, draft: toDraft(stored) };
  const withKeys = (keys: StateDefinition['keys'], extra: Partial<StateDefinition> = {}) => ({
    ...stored,
    keys,
    ...extra,
  });

  it('reads an echo of the same content (other property order, new updatedAt) as unchanged', () => {
    const shuffled = Object.fromEntries(
      Object.entries(stored.keys).map(([name, def]) => [name, Object.fromEntries(Object.entries(def).reverse())]),
    ) as StateDefinition['keys'];
    expect(classifyDefinitionChange(clean, [withKeys(shuffled, { updatedAt: 'later' })])).toEqual({
      kind: 'unchanged',
    });
  });

  it('treats another row order as an edit: rows are ordered', () => {
    const reordered = Object.fromEntries(Object.entries(stored.keys).reverse());
    expect(classifyDefinitionChange(clean, [withKeys(reordered)])).toMatchObject({ kind: 'reload' });
  });

  it('reloads a clean editor after a disk edit and closes it when the file is gone', () => {
    const edited = withKeys({ ...stored.keys, tension: { type: 'number', max: 12 } });
    expect(classifyDefinitionChange(clean, [edited])).toEqual({ kind: 'reload', item: edited });
    expect(classifyDefinitionChange(clean, [])).toEqual({ kind: 'removed' });
  });

  it('does not report its own delete as news', () => {
    expect(classifyDefinitionChange({ ...clean, deleting: true }, [])).toEqual({ kind: 'unchanged' });
  });

  it('warns about a dirty draft when the disk moved on, and about a removed file', () => {
    const dirty = { definition: stored, draft: { ...toDraft(stored), description: 'mine' } };
    const edited = withKeys({ ...stored.keys, tension: { type: 'number', max: 12 } });
    expect(classifyDefinitionChange(dirty, [edited])).toMatchObject({ kind: 'conflict', removed: false });
    expect(classifyDefinitionChange(dirty, [])).toMatchObject({ kind: 'conflict', removed: true });
  });

  it('reloads when the disk already holds a dirty draft (its own save, seen before the response)', () => {
    const draft = toDraft(stored);
    const tension = { ...draft.keys[0]!, max: ' 12 ' };
    const unsaved = {
      definition: stored,
      draft: { ...draft, name: 'scene', description: '', keys: [tension, ...draft.keys.slice(1)] },
    };
    // The server dropped the description (a body without one clears it) and stored the number.
    const { description: _description, ...rest } = stored;
    const ownSave = {
      ...rest,
      keys: { ...stored.keys, tension: { type: 'number', default: 3, min: 0, max: 12 } },
      updatedAt: 'later',
    } as StateDefinition;
    expect(classifyDefinitionChange(unsaved, [ownSave])).toEqual({ kind: 'reload', item: ownSave });
  });

  it('never matches a draft that cannot be saved against the disk', () => {
    const broken = { definition: stored, draft: { ...toDraft(stored), name: 'not a name' } };
    expect(classifyDefinitionChange(broken, [withKeys({}, { name: 'x' })])).toMatchObject({ kind: 'conflict' });
  });
});
