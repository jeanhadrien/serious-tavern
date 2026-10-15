import { describe, expect, it } from 'vitest';
import type { WorkflowSetting } from '@st/shared';
import { controlKind, displayedSetting, parseNumberDraft, saveMode, type ControlKind } from './settingControls.js';

describe('chat setting controls', () => {
  it.each<[WorkflowSetting, string]>([
    [{ key: 'v', type: 'number', default: 0, min: 0, max: 1 }, 'slider'],
    [{ key: 'v', type: 'number', default: 0, min: 0 }, 'number'],
    [{ key: 'v', type: 'number', default: 0 }, 'number'],
    [{ key: 'b', type: 'boolean', default: false }, 'toggle'],
    [{ key: 'e', type: 'enum', options: ['a'] }, 'select'],
    [{ key: 't', type: 'text', default: '', multiline: true }, 'textarea'],
    [{ key: 't', type: 'text', default: '' }, 'text'],
  ])('gives %j a %s', (setting, kind) => {
    expect(controlKind(setting)).toBe(kind);
  });

  const bounded: WorkflowSetting = { key: 'v', type: 'number', default: 0, min: 0, max: 1 };
  it.each<[string, ReturnType<typeof parseNumberDraft>]>([
    ['', { problem: 'Enter a number' }],
    ['  ', { problem: 'Enter a number' }],
    ['-', { problem: '- is not a number' }],
    ['1.5', { problem: '1.5 is above max 1' }],
    ['-0.1', { problem: '-0.1 is below min 0' }],
    ['0.4', { value: 0.4 }],
    [' 1 ', { value: 1 }],
  ])('reads %j', (text, expected) => {
    expect(parseNumberDraft(text, bounded)).toEqual(expected);
  });
});

describe('when a control saves', () => {
  it.each<[ControlKind, string]>([
    ['slider', 'debounced'],
    ['number', 'debounced'],
    ['text', 'debounced'],
    ['textarea', 'debounced'],
    ['toggle', 'now'],
    ['select', 'now'],
  ])('a %s saves %s', (kind, mode) => {
    expect(saveMode(kind)).toBe(mode);
  });
});

describe('what the panel shows for a setting', () => {
  const setting: WorkflowSetting = { key: 'v', type: 'number', default: 3, min: 0, max: 10 };
  const fine = { values: { v: 5 }, issues: [] };
  const invalid = {
    values: { v: 3 },
    issues: [{ key: 'v', message: 'Stored value 12 is above max 10; using default 3' }],
  };
  it.each<[string, Parameters<typeof displayedSetting>, ReturnType<typeof displayedSetting>]>([
    ['nothing stored', [setting, { values: { v: 3 }, issues: [] }, {}, {}], { value: 3, resettable: false }],
    ['a stored value', [setting, fine, { v: 5 }, {}], { value: 5, resettable: true }],
    ['a pending value', [setting, fine, { v: 5 }, { v: 7 }], { value: 7, resettable: true }],
    ['a pending reset', [setting, fine, { v: 5 }, { v: null }], { value: 3, resettable: false }],
    [
      'an invalid stored value',
      [setting, invalid, { v: 12 }, {}],
      { value: 3, resettable: true, issue: 'Stored value 12 is above max 10; using default 3' },
    ],
    [
      'an invalid stored value with a pending one',
      [setting, invalid, { v: 12 }, { v: 4 }],
      { value: 4, resettable: true },
    ],
  ])('%s', (_name, args, expected) => {
    expect(displayedSetting(...args)).toEqual(expected);
  });
});
