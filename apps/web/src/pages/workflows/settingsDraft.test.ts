import { describe, expect, it } from 'vitest';
import type { WorkflowSetting } from '@st/shared';
import {
  moveSetting,
  newSetting,
  optionalNumber,
  optionsText,
  parseOptions,
  removeSetting,
  withType,
} from './settingsDraft.js';

describe('settings draft helpers', () => {
  it('names a new setting with the first free key', () => {
    const existing: WorkflowSetting[] = [
      { key: 'setting1', type: 'boolean', default: false },
      { key: 'setting2', type: 'text', default: '' },
    ];
    expect(newSetting(existing)).toEqual({ key: 'setting3', type: 'number', default: 0 });
    expect(newSetting([]).key).toBe('setting1');
  });

  it('changes type, keeping key, label, description and unknown fields and resetting the typed ones', () => {
    const number = {
      key: 'v',
      label: 'V',
      description: 'd',
      future: 1,
      type: 'number',
      default: 3,
      min: 0,
      max: 5,
      step: 1,
    } as WorkflowSetting;
    expect(withType(number, 'enum')).toEqual({
      key: 'v',
      label: 'V',
      description: 'd',
      future: 1,
      type: 'enum',
      options: [],
    });
    const enumSetting: WorkflowSetting = { key: 'm', type: 'enum', options: ['a'], default: 'a' };
    expect(withType(enumSetting, 'text')).toEqual({ key: 'm', type: 'text', default: '' });
    expect(withType(enumSetting, 'boolean')).toEqual({ key: 'm', type: 'boolean', default: false });
    expect(withType({ key: 't', type: 'text', default: 'x', multiline: true }, 'number')).toEqual({
      key: 't',
      type: 'number',
      default: 0,
    });
  });

  it.each([
    [0, -1, ['a', 'b', 'c']],
    [0, 1, ['b', 'a', 'c']],
    [2, 1, ['a', 'b', 'c']],
    [2, -1, ['a', 'c', 'b']],
  ] as const)('moves item %i by %i', (index, delta, expected) => {
    expect(moveSetting(['a', 'b', 'c'], index, delta)).toEqual(expected);
  });

  it('removes one item', () => {
    expect(removeSetting(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });

  it('reads options one per line, trimmed, without blanks or repeats', () => {
    expect(parseOptions('a\n b \n\na\nc, d')).toEqual(['a', 'b', 'c, d']);
    expect(parseOptions('')).toEqual([]);
    expect(optionsText(['a', 'b'])).toBe('a\nb');
  });

  it('reads optional numbers', () => {
    expect(optionalNumber('')).toBeUndefined();
    expect(optionalNumber('  ')).toBeUndefined();
    expect(optionalNumber('1.5')).toBe(1.5);
    expect(optionalNumber('-')).toBeUndefined();
  });
});
