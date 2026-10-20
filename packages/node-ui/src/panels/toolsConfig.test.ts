import { describe, expect, it } from 'vitest';
import type { StateDefinition } from '@st/shared';
import {
  addTarget,
  canAddTarget,
  describeTarget,
  parallelChoice,
  removeTarget,
  setMaxSteps,
  setParallel,
  toolTargets,
} from './toolsConfig.js';

const scene: StateDefinition = {
  id: 'd-scene',
  name: 'scene',
  keys: { tension: { type: 'number' }, log: { type: 'collection' } },
  createdAt: '',
  updatedAt: '',
};
const tension = { definitionId: 'd-scene', key: 'tension' };
const log = { definitionId: 'd-scene', key: 'log' };

describe('toolTargets', () => {
  it.each([
    ['no tools', {}, []],
    ['tools that are not an object', { tools: 'x' }, []],
    ['a list that is not an array', { tools: { read: 3 } }, []],
    ['entries that are not targets', { tools: { read: [tension, 'x', { key: 'k' }, null] } }, [tension]],
  ])('reads %s', (_name, config, expected) => {
    expect(toolTargets(config, 'read')).toEqual(expected);
  });

  it('reads each list on its own', () => {
    const config = { tools: { read: [tension], write: [log] } };
    expect(toolTargets(config, 'write')).toEqual([log]);
  });
});

describe('addTarget', () => {
  it('adds to the end of one list and leaves the other and the rest of the config alone', () => {
    const config = { model: 'm', tools: { read: [tension], write: [] } };
    expect(addTarget(config, 'read', log)).toEqual({ model: 'm', tools: { read: [tension, log], write: [] } });
    expect(addTarget(config, 'write', tension)).toEqual({ model: 'm', tools: { read: [tension], write: [tension] } });
  });

  it('creates the tools of a config saved before they existed', () => {
    expect(addTarget({ model: 'm' }, 'write', tension)).toEqual({ model: 'm', tools: { read: [], write: [tension] } });
  });

  it('keeps unknown properties of the tools object', () => {
    const config = { tools: { read: [], write: [], extra: 1 } };
    expect(addTarget(config, 'read', tension)).toEqual({ tools: { read: [tension], write: [], extra: 1 } });
  });

  it('changes nothing for a duplicate or an incomplete target', () => {
    const config = { tools: { read: [tension], write: [] } };
    expect(addTarget(config, 'read', { ...tension })).toBe(config);
    expect(addTarget(config, 'read', { definitionId: 'd-scene', key: '' })).toBe(config);
    expect(addTarget(config, 'read', { definitionId: '', key: 'tension' })).toBe(config);
    expect(canAddTarget(config, 'write', tension)).toBe(true);
    expect(canAddTarget(config, 'read', tension)).toBe(false);
  });
});

describe('removeTarget', () => {
  it('removes the target at the index only', () => {
    const config = { tools: { read: [tension, log], write: [tension] } };
    expect(removeTarget(config, 'read', 0)).toEqual({ tools: { read: [log], write: [tension] } });
    expect(removeTarget(config, 'write', 0)).toEqual({ tools: { read: [tension, log], write: [] } });
    expect(removeTarget(config, 'read', 5)).toEqual(config);
  });
});

describe('describeTarget', () => {
  it.each([
    ['a known key', tension, { label: 'scene.tension', known: true }],
    ['an unknown definition', { definitionId: 'gone', key: 'k' }, { label: 'Unknown definition (gone)', known: false }],
    ['an unknown key', { definitionId: 'd-scene', key: 'nope' }, { label: 'scene: Unknown key (nope)', known: false }],
  ])('names %s', (_name, target, expected) => {
    expect(describeTarget(target, [scene])).toEqual(expected);
  });

  it('calls everything unknown without definitions', () => {
    expect(describeTarget(tension, []).known).toBe(false);
  });
});

describe('setMaxSteps', () => {
  it.each([
    ['3', 3],
    ['2.7', 2],
    ['0', 1],
    ['-4', 1],
  ])('stores %s as %i', (text, expected) => {
    expect(setMaxSteps({ model: 'm' }, text)).toEqual({ model: 'm', maxSteps: expected });
  });

  it('unsets a cleared box and ignores text that is not a number', () => {
    expect(setMaxSteps({ maxSteps: 3 }, '')).toEqual({});
    expect(setMaxSteps({ maxSteps: 3 }, 'e')).toEqual({ maxSteps: 3 });
  });
});

describe('parallel tool calls', () => {
  it('maps unset, true and false to default, on and off and back', () => {
    expect(parallelChoice({})).toBe('default');
    expect(parallelChoice({ parallelToolCalls: true })).toBe('on');
    expect(parallelChoice({ parallelToolCalls: false })).toBe('off');
    expect(setParallel({}, 'on')).toEqual({ parallelToolCalls: true });
    expect(setParallel({}, 'off')).toEqual({ parallelToolCalls: false });
    expect(setParallel({ parallelToolCalls: true, model: 'm' }, 'default')).toEqual({ model: 'm' });
  });
});
