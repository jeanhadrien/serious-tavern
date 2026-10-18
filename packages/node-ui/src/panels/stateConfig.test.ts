import { describe, expect, it } from 'vitest';
import { stateOpsFor, type StateDefinition, type StateKeyType } from '@st/shared';
import {
  definitionOptions,
  keyOptions,
  pickDefinition,
  pickerHint,
  pickKey,
  readOptions,
  retarget,
} from './stateConfig.js';

const definition = (id: string, name: string, keys: StateDefinition['keys']): StateDefinition => ({
  id,
  name,
  keys,
  createdAt: '',
  updatedAt: '',
});
const scene = definition('d-scene', 'scene', {
  tension: { type: 'number', min: 0, max: 10 },
  mood: { type: 'enum', options: ['calm', 'tense'] },
  place: { type: 'text' },
  quiet: { type: 'boolean' },
  flags: { type: 'object' },
  injected: { type: 'collection' },
});
const other = definition('d-other', 'other', { tension: { type: 'text' }, note: { type: 'text' } });
const catalog = [scene, other];

describe('definitionOptions', () => {
  it('lists the catalog by name', () => {
    expect(definitionOptions('d-scene', catalog)).toEqual([
      { value: 'd-scene', label: 'scene' },
      { value: 'd-other', label: 'other' },
    ]);
  });

  it('puts an id without a record first, as unknown', () => {
    expect(definitionOptions('gone', catalog)[0]).toEqual({
      value: 'gone',
      label: 'Unknown definition (gone)',
    });
    expect(definitionOptions('gone', catalog)).toHaveLength(3);
    expect(definitionOptions('gone', [])).toEqual([{ value: 'gone', label: 'Unknown definition (gone)' }]);
  });

  it('adds nothing for an empty or missing id, and is empty for an empty catalog', () => {
    expect(definitionOptions('', catalog)).toHaveLength(2);
    expect(definitionOptions(undefined, catalog)).toHaveLength(2);
    expect(definitionOptions(42, catalog)).toHaveLength(2);
    expect(definitionOptions('', [])).toEqual([]);
  });
});

describe('keyOptions', () => {
  it('lists the keys with their types', () => {
    expect(keyOptions(scene, 'tension').map((option) => option.label)).toEqual([
      'tension (number)',
      'mood (enum)',
      'place (text)',
      'quiet (boolean)',
      'flags (object)',
      'injected (collection)',
    ]);
  });

  it('puts a key the definition does not have first, as unknown', () => {
    expect(keyOptions(scene, 'old')[0]).toEqual({ value: 'old', label: 'Unknown key (old)' });
    expect(keyOptions(scene, 'old')).toHaveLength(7);
    // Without a definition the stored key is all there is.
    expect(keyOptions(undefined, 'old')).toEqual([{ value: 'old', label: 'Unknown key (old)' }]);
  });

  it('adds nothing for an empty key, and is empty without a definition', () => {
    expect(keyOptions(scene, '')).toHaveLength(6);
    expect(keyOptions(undefined, '')).toEqual([]);
    expect(keyOptions(undefined, undefined)).toEqual([]);
  });
});

describe('retarget (read)', () => {
  it('sets the target and leaves `read` alone', () => {
    const config = { definitionId: 'd-scene', key: 'tension', read: 'meta' };
    expect(retarget(config, { definitionId: 'd-other', key: 'note' }, catalog, 'read')).toEqual({
      definitionId: 'd-other',
      key: 'note',
      read: 'meta',
    });
  });

  it('does not touch the config it was given', () => {
    const config = { definitionId: 'd-scene', key: 'tension', read: 'value' };
    retarget(config, { definitionId: 'd-other', key: 'note' }, catalog, 'read');
    expect(config).toEqual({ definitionId: 'd-scene', key: 'tension', read: 'value' });
  });
});

describe('retarget (read) and the linked read', () => {
  const linked = { definitionId: 'd-scene', key: 'injected', read: 'linked' };

  it('keeps `linked` while the key is a collection', () => {
    expect(retarget(linked, { definitionId: 'd-scene', key: 'injected' }, catalog, 'read')).toEqual(linked);
  });

  it('goes back to the value when the new key is not a collection', () => {
    expect(retarget(linked, { definitionId: 'd-scene', key: 'tension' }, catalog, 'read').read).toBe('value');
    expect(retarget(linked, { definitionId: 'd-other', key: 'note' }, catalog, 'read').read).toBe('value');
  });

  it('leaves the read alone when the target is not known or not picked yet', () => {
    expect(retarget(linked, { definitionId: 'd-scene', key: '' }, catalog, 'read').read).toBe('linked');
    expect(retarget(linked, { definitionId: 'missing', key: 'x' }, catalog, 'read').read).toBe('linked');
  });

  it('keeps `meta` for every type', () => {
    expect(
      retarget({ ...linked, read: 'meta' }, { definitionId: 'd-scene', key: 'tension' }, catalog, 'read').read,
    ).toBe('meta');
  });
});

describe('readOptions', () => {
  it('offers linked items only for a collection', () => {
    expect(readOptions('collection', 'value')).toEqual(['value', 'meta', 'linked']);
    for (const type of ['number', 'boolean', 'enum', 'text', 'object'] as const)
      expect(readOptions(type, 'value')).toEqual(['value', 'meta']);
  });

  it('offers the reads every key has while no key is picked', () => {
    expect(readOptions(undefined, 'value')).toEqual(['value', 'meta']);
  });

  it('keeps a read that is configured but not possible for the key, so it stays visible', () => {
    expect(readOptions('text', 'linked')).toEqual(['value', 'meta', 'linked']);
  });

  it('does not invent an entry for a read it does not know (the panel shows that one itself)', () => {
    expect(readOptions('text', 'bogus')).toEqual(['value', 'meta']);
  });
});

describe('pickDefinition', () => {
  it('keeps the key only when the new definition has it', () => {
    const config = { definitionId: 'd-scene', key: 'tension', read: 'value' };
    expect(pickDefinition(config, 'd-other', catalog, 'read')).toMatchObject({
      definitionId: 'd-other',
      key: 'tension',
    });
    expect(pickDefinition({ ...config, key: 'mood' }, 'd-other', catalog, 'read')).toMatchObject({
      definitionId: 'd-other',
      key: '',
    });
    // An unknown definition has no keys.
    expect(pickDefinition(config, 'gone', catalog, 'read')).toMatchObject({ definitionId: 'gone', key: '' });
    expect(pickDefinition(config, '', catalog, 'read')).toMatchObject({ definitionId: '', key: '' });
  });

  it('does not take an inherited property for a key', () => {
    const config = { definitionId: 'd-scene', key: 'toString' };
    expect(pickDefinition(config, 'd-other', catalog, 'read')).toMatchObject({ key: '' });
  });
});

describe('retarget (write)', () => {
  const write = { definitionId: 'd-scene', key: 'tension', op: 'increment', value: 2 };

  it('keeps the fixed value and operation while the target does not change', () => {
    expect(retarget(write, { definitionId: 'd-scene', key: 'tension' }, catalog, 'write')).toEqual(write);
  });

  it('drops the fixed value whenever the definition or the key changes', () => {
    expect(retarget(write, { definitionId: 'd-scene', key: 'place' }, catalog, 'write')).not.toHaveProperty('value');
    expect(retarget(write, { definitionId: 'd-other', key: 'tension' }, catalog, 'write')).not.toHaveProperty('value');
    expect(retarget(write, { definitionId: 'd-other', key: '' }, catalog, 'write')).not.toHaveProperty('value');
  });

  it('fits the operation to the key type', () => {
    // A number key keeps increment.
    expect(retarget({ ...write, key: 'x' }, { definitionId: 'd-scene', key: 'tension' }, catalog, 'write').op).toBe(
      'increment',
    );
    // A text key has no increment: it becomes set.
    expect(retarget(write, { definitionId: 'd-scene', key: 'place' }, catalog, 'write').op).toBe('set');
    // A collection key has no set: it becomes add.
    expect(retarget({ ...write, op: 'set' }, { definitionId: 'd-scene', key: 'injected' }, catalog, 'write').op).toBe(
      'add',
    );
    // delete is allowed everywhere.
    expect(
      retarget({ ...write, op: 'delete' }, { definitionId: 'd-scene', key: 'injected' }, catalog, 'write').op,
    ).toBe('delete');
  });

  it('treats a missing operation as set', () => {
    const { op: _op, ...withoutOp } = write;
    expect(retarget(withoutOp, { definitionId: 'd-scene', key: 'place' }, catalog, 'write')).not.toHaveProperty('op');
    expect(retarget(withoutOp, { definitionId: 'd-scene', key: 'injected' }, catalog, 'write').op).toBe('add');
  });

  it('leaves the operation alone when the key is not known', () => {
    expect(retarget(write, { definitionId: 'd-scene', key: 'old' }, catalog, 'write').op).toBe('increment');
    expect(retarget(write, { definitionId: 'gone', key: 'tension' }, catalog, 'write').op).toBe('increment');
    expect(retarget(write, { definitionId: 'd-scene', key: '' }, catalog, 'write').op).toBe('increment');
  });

  it('only ever leaves an operation the key type allows, for every type and operation', () => {
    const types: StateKeyType[] = ['number', 'boolean', 'enum', 'text', 'object', 'collection'];
    const keyOfType: Record<StateKeyType, string> = {
      number: 'tension',
      boolean: 'quiet',
      enum: 'mood',
      text: 'place',
      object: 'flags',
      collection: 'injected',
    };
    for (const type of types)
      for (const op of ['set', 'increment', 'add', 'remove', 'delete']) {
        const result = retarget({ ...write, op }, { definitionId: 'd-scene', key: keyOfType[type] }, catalog, 'write');
        expect(stateOpsFor(type)).toContain(result.op);
        // An allowed operation is never changed.
        if (stateOpsFor(type).includes(op as never)) expect(result.op).toBe(op);
      }
  });
});

describe('pickKey', () => {
  it('retargets within the current definition', () => {
    const config = { definitionId: 'd-scene', key: 'tension', op: 'increment', value: 3 };
    expect(pickKey(config, 'place', catalog, 'write')).toEqual({ definitionId: 'd-scene', key: 'place', op: 'set' });
    expect(pickKey(config, 'tension', catalog, 'write')).toEqual(config);
  });
});

describe('pickerHint', () => {
  it('asks for a definition first when there is none to pick', () => {
    expect(pickerHint({}, [])).toBe('Create a state definition in the State definitions list first.');
    expect(pickerHint({ definitionId: 'd-scene', key: 'tension' }, [])).toContain('Create a state definition');
  });

  it('says what to pick next, definition then key', () => {
    expect(pickerHint({ definitionId: '', key: '' }, catalog)).toBe('Select a state definition.');
    expect(pickerHint({}, catalog)).toBe('Select a state definition.');
    expect(pickerHint({ definitionId: 'd-scene', key: '' }, catalog)).toBe('Select a key.');
  });

  it('says nothing once both are chosen, even for ids the catalog does not know', () => {
    expect(pickerHint({ definitionId: 'd-scene', key: 'tension' }, catalog)).toBeUndefined();
    expect(pickerHint({ definitionId: 'gone', key: 'x' }, catalog)).toBeUndefined();
  });
});
