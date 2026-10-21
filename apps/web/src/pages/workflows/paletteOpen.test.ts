import { describe, expect, it } from 'vitest';
import { isCategoryOpen, loadPaletteOpen, savePaletteOpen } from './paletteOpen.js';

const stored = (value: string | null) => ({ getItem: () => value });

describe('loadPaletteOpen', () => {
  it.each([
    ['nothing stored', null, {}],
    ['a map', '{"Chat":false,"Logic":true}', { Chat: false, Logic: true }],
    ['values that are not booleans are dropped', '{"Chat":false,"Logic":"no","AI":1}', { Chat: false }],
    ['a list', '[true]', {}],
    ['broken JSON', '{"Chat":', {}],
  ])('%s', (_, raw, expected) => {
    expect(loadPaletteOpen(stored(raw))).toEqual(expected);
  });
  it('reads as empty without storage, or when reading throws', () => {
    expect(loadPaletteOpen(undefined)).toEqual({});
    expect(
      loadPaletteOpen({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toEqual({});
  });
});

describe('savePaletteOpen', () => {
  it('writes the map under one key', () => {
    const written: [string, string][] = [];
    savePaletteOpen({ Chat: false }, { setItem: (key, value) => written.push([key, value]) });
    expect(written).toEqual([['st.palette.open', '{"Chat":false}']]);
  });
  it('survives a storage that throws', () => {
    expect(() =>
      savePaletteOpen(
        {},
        {
          setItem: () => {
            throw new Error('full');
          },
        },
      ),
    ).not.toThrow();
  });
});

it('a category is open unless it was folded', () => {
  expect(isCategoryOpen({}, 'Chat')).toBe(true);
  expect(isCategoryOpen({ Chat: false }, 'Chat')).toBe(false);
  expect(isCategoryOpen({ Chat: true }, 'Chat')).toBe(true);
});
