import { describe, expect, it } from 'vitest';
import type { WorkflowSetting } from '@st/shared';
import {
  draftList,
  moveSetting,
  newSetting,
  optionalNumber,
  optionsText,
  parseOptions,
  removeSetting,
  toggleSettingsPanel,
  unsavableSettings,
  withDraftSettings,
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

  it('reads keys of raw items when naming a new setting', () => {
    expect(newSetting([{ key: 'setting1', type: 'color' }, null, 'x']).key).toBe('setting2');
  });

  it('reads a negative number typed from its sign', () => {
    expect(optionalNumber('-')).toBeUndefined();
    expect(optionalNumber('-5')).toBe(-5);
  });
});

describe('the raw draft', () => {
  const unreadable = [
    { key: 'mood', type: 'enum', options: ['a'] },
    { key: 'hand', type: 'number', default: '5' },
    { key: 'future', type: 'color' },
  ];

  it('keeps stored items as they are and only fills in a missing list', () => {
    const stored = { name: 'W', settings: unreadable };
    expect(withDraftSettings(stored)).toEqual(stored);
    expect(withDraftSettings(stored).settings).toBe(unreadable);
    const older: { name: string; settings?: unknown } = { name: 'W' };
    expect(withDraftSettings(older)).toEqual({ name: 'W', settings: [] });
    expect(withDraftSettings({ settings: {} }).settings).toEqual({});
  });

  it('treats a non-list as no rows', () => {
    expect(draftList(unreadable)).toBe(unreadable);
    expect(draftList({})).toEqual([]);
    expect(draftList(undefined)).toEqual([]);
  });

  it('refuses to save a declaration the API would reject, naming the first one', () => {
    expect(unsavableSettings(unreadable)).toBe(
      'Chat setting #2 is not valid: default: Invalid input: expected number, received string.',
    );
    expect(unsavableSettings([unreadable[2]])).toBe(
      'Chat setting #1 is not valid: its type "color" is not one of: number, boolean, enum, text.',
    );
    expect(unsavableSettings({})).toBe('Chat settings must be a list, not {}.');
    // Problems the API accepts (a duplicate key, a bad default) are workflow issues, not save blockers.
    expect(unsavableSettings([unreadable[0], unreadable[0]])).toBeUndefined();
    expect(unsavableSettings(undefined)).toBeUndefined();
  });
});

describe('the toolbar toggle', () => {
  it.each([
    [true, { open: false, deselect: false }],
    // Closed, or covered by a selected node's config: deselect and show the settings.
    [false, { open: true, deselect: true }],
  ])('when the panel is shown=%s gives %j', (shown, expected) => {
    expect(toggleSettingsPanel(shown)).toEqual(expected);
  });
});
