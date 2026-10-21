import { describe, expect, it } from 'vitest';
import { readAppSettings } from './app-settings.js';

describe('readAppSettings', () => {
  it.each<[string, unknown]>([
    ['nothing stored', undefined],
    ['null', null],
    ['a string', 'nope'],
    ['an array', [{ forkKeepsAlternatives: false }]],
    ['an empty object', {}],
    ['a field of the wrong type', { forkKeepsAlternatives: 'no' }],
    ['a null field', { forkKeepsAlternatives: null }],
  ])('gives the defaults for %s', (_, raw) => {
    expect(readAppSettings(raw)).toEqual({ forkKeepsAlternatives: true });
  });

  it('reads a stored value', () => {
    expect(readAppSettings({ forkKeepsAlternatives: false })).toEqual({ forkKeepsAlternatives: false });
    expect(readAppSettings({ forkKeepsAlternatives: true })).toEqual({ forkKeepsAlternatives: true });
  });

  it('keeps unknown keys, with the defaults filled in around them', () => {
    expect(readAppSettings({ theme: 'dark', nested: { a: 1 } })).toEqual({
      forkKeepsAlternatives: true,
      theme: 'dark',
      nested: { a: 1 },
    });
  });

  it('does not change its input', () => {
    const raw = Object.freeze({ other: 1 });
    expect(readAppSettings(raw)).toEqual({ forkKeepsAlternatives: true, other: 1 });
    expect(raw).toEqual({ other: 1 });
  });
});
