import { describe, expect, it } from 'vitest';
import {
  addSignal,
  changeSignal,
  levelSetting,
  numberSetting,
  parseAtLeast,
  parseTurns,
  parseUnit,
  removeSignal,
  signalNameHint,
  signalRows,
  withLevel,
} from './triggerConfig.js';

const defaults = {
  baseChance: 0.1,
  cooldowns: { '1': 0, '2': 2, '3': 4, '4': 8, '5': 15 },
  levelWeights: { '1': 5, '2': 3, '3': 2, '4': 1, '5': 0.5 },
};

describe('parsers', () => {
  it.each([
    ['0.25', 0.25],
    [' 1 ', 1],
    ['0', 0],
    ['1.5', undefined],
    ['-0.1', undefined],
    ['', undefined],
    ['abc', undefined],
  ])('parseUnit(%j)', (text, expected) => expect(parseUnit(text)).toBe(expected));

  it.each([
    ['2.5', 2.5],
    ['0', 0],
    ['-1', undefined],
    ['', undefined],
    ['0x10', undefined],
  ])('parseAtLeast(%j, 0)', (text, expected) => expect(parseAtLeast(text, 0)).toBe(expected));

  it.each([
    ['3', 3],
    ['0', 0],
    ['1.5', undefined],
    ['-2', undefined],
  ])('parseTurns(%j)', (text, expected) => expect(parseTurns(text)).toBe(expected));
});

describe('settings', () => {
  it('reads a scalar from the config, else the default, else the fallback', () => {
    expect(numberSetting({ baseChance: 0.4 }, defaults, 'baseChance')).toBe(0.4);
    expect(numberSetting({}, defaults, 'baseChance')).toBe(0.1);
    expect(numberSetting({ baseChance: 'x' }, defaults, 'baseChance')).toBe(0);
    expect(numberSetting({}, {}, 'maxLevel', 2)).toBe(2);
  });

  it('reads a level from the config, else the default of that level', () => {
    expect(levelSetting({ cooldowns: { '2': 7 } }, defaults, 'cooldowns', 2)).toBe(7);
    expect(levelSetting({ cooldowns: { '2': 7 } }, defaults, 'cooldowns', 3)).toBe(4);
    expect(levelSetting({}, defaults, 'levelWeights', 5)).toBe(0.5);
    expect(levelSetting({ cooldowns: 'nope' }, defaults, 'cooldowns', 1)).toBe(0);
    expect(levelSetting({ cooldowns: { '1': 'x' } }, defaults, 'cooldowns', 2)).toBe(2);
  });

  it('changes one level and writes the others as the panel shows them', () => {
    const next = withLevel({ cooldowns: { '3': 9 }, baseChance: 0.3 }, defaults, 'cooldowns', 2, 6);
    expect(next).toEqual({ baseChance: 0.3, cooldowns: { '1': 0, '2': 6, '3': 9, '4': 8, '5': 15 } });
    expect(withLevel({}, defaults, 'levelWeights', 1, 0).levelWeights).toEqual({
      '1': 0,
      '2': 3,
      '3': 2,
      '4': 1,
      '5': 0.5,
    });
  });
});

describe('signal rows', () => {
  it('reads what is stored and shows anything else as an empty row', () => {
    expect(signalRows({})).toEqual([]);
    expect(signalRows({ signals: 'nope' })).toEqual([]);
    expect(signalRows({ signals: [{ name: 'a', weight: 1 }, null, { name: 3 }] })).toEqual([
      { name: 'a', weight: 1 },
      { name: '', weight: 0 },
      { name: '', weight: 0 },
    ]);
  });

  it('adds, changes and removes rows without touching the others', () => {
    const rows = addSignal(addSignal([]));
    expect(rows).toEqual([
      { name: '', weight: 0.5 },
      { name: '', weight: 0.5 },
    ]);
    const named = changeSignal(rows, 1, { name: 'gap' });
    expect(named[1]).toEqual({ name: 'gap', weight: 0.5 });
    expect(named[0]).toBe(rows[0]);
    expect(removeSignal(named, 0)).toEqual([{ name: 'gap', weight: 0.5 }]);
  });

  it('says what is wrong with a name', () => {
    const rows = [
      { name: 'a', weight: 1 },
      { name: 'a', weight: 1 },
    ];
    expect(signalNameHint('', rows, 0)).toMatch(/Name the signal/);
    expect(signalNameHint('1x', rows, 0)).toMatch(/Start with a letter/);
    expect(signalNameHint('value', rows, 0)).toMatch(/already has an input/);
    expect(signalNameHint(' a ', rows, 0)).toMatch(/Another signal/);
    expect(signalNameHint('b', rows, 0)).toBeUndefined();
    expect(signalNameHint('a', [{ name: 'a', weight: 1 }], 0)).toBeUndefined();
  });
});
