import { expect, it } from 'vitest';
import { areaShortcutAllowed, matchShortcut, SHORTCUTS } from './shortcuts.js';

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
  ['Ctrl+Z', press('z', { ctrlKey: true }), 'undo'],
  ['Cmd+Z', press('z', { metaKey: true }), 'undo'],
  ['Ctrl+Z with caps lock', press('Z', { ctrlKey: true }), 'undo'],
  ['Ctrl+Shift+Z', press('Z', { ctrlKey: true, shiftKey: true }), 'redo'],
  ['Cmd+Shift+Z', press('z', { metaKey: true, shiftKey: true }), 'redo'],
  ['Ctrl+Y', press('y', { ctrlKey: true }), 'redo'],
  ['Cmd+Y', press('y', { metaKey: true }), 'redo'],
  ['Ctrl+Shift+Y', press('Y', { ctrlKey: true, shiftKey: true }), undefined],
  ['Alt+Ctrl+Z', press('z', { ctrlKey: true, altKey: true }), undefined],
  ['Ctrl+Cmd+Z', press('z', { ctrlKey: true, metaKey: true }), undefined],
  ['a plain Z', press('z'), undefined],
  ['Ctrl+C is the native copy event, not a key shortcut', press('c', { ctrlKey: true }), undefined],
  ['Ctrl+V is the native paste event, not a key shortcut', press('v', { ctrlKey: true }), undefined],
  ['Escape', press('Escape'), undefined],
])('%s', (_name, event, expected) => {
  expect(matchShortcut(event)).toBe(expected);
});

it('declares each shortcut once', () => {
  const keys = SHORTCUTS.map((shortcut) => shortcut.keys);
  expect(new Set(keys).size).toBe(keys.length);
});

it('declares the undo, redo, copy and paste keys in the canvas scope', () => {
  const canvas = SHORTCUTS.filter((shortcut) => shortcut.scope === 'canvas').map((shortcut) => shortcut.keys);
  expect(canvas).toEqual(['Mod+Z', 'Mod+Shift+Z', 'Mod+Y', 'Mod+C', 'Mod+V']);
});

it.each([
  ['nothing in the way', { handled: false, inDialog: false, inField: false }, true],
  ['a field has focus: its own text undo wins', { handled: false, inDialog: false, inField: true }, false],
  ['something already handled the key', { handled: true, inDialog: false, inField: false }, false],
  ['an open dialog', { handled: false, inDialog: true, inField: false }, false],
])('area shortcuts: %s', (_name, situation, expected) => {
  expect(areaShortcutAllowed(situation)).toBe(expected);
});
