import { expect, it } from 'vitest';
import { matchShortcut, SHORTCUTS } from './shortcuts.js';

const press = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

it.each([
  ['Ctrl+S', press('s', { ctrlKey: true }), 'save'],
  ['Cmd+S', press('s', { metaKey: true }), 'save'],
  ['Ctrl+S with caps lock', press('S', { ctrlKey: true }), 'save'],
  ['Shift+Ctrl+S', press('S', { ctrlKey: true, shiftKey: true }), undefined],
  ['Alt+Ctrl+S', press('s', { ctrlKey: true, altKey: true }), undefined],
  ['Ctrl+Cmd+S', press('s', { ctrlKey: true, metaKey: true }), undefined],
  ['a plain S', press('s'), undefined],
  ['Ctrl+Z', press('z', { ctrlKey: true }), undefined],
  ['Escape', press('Escape'), undefined],
])('%s', (_name, event, expected) => {
  expect(matchShortcut(event)).toBe(expected);
});

it('declares each shortcut once', () => {
  const keys = SHORTCUTS.map((shortcut) => shortcut.keys);
  expect(new Set(keys).size).toBe(keys.length);
});
