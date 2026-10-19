import { describe, expect, it } from 'vitest';
import { isTextField, keyMove, type MoveKeyEvent } from './keyMove.js';

const press = (key: string, mods: Partial<MoveKeyEvent> = {}): MoveKeyEvent => ({
  key,
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe('keyMove', () => {
  it.each([
    [press('ArrowUp'), 2, 4, 1],
    [press('ArrowDown'), 2, 4, 3],
    [press('ArrowUp'), 0, 4, undefined],
    [press('ArrowDown'), 3, 4, undefined],
    [press('ArrowDown'), 0, 1, undefined],
    [press('ArrowUp', { altKey: false }), 2, 4, undefined],
    [press('ArrowUp', { shiftKey: true }), 2, 4, undefined],
    [press('ArrowUp', { ctrlKey: true }), 2, 4, undefined],
    [press('ArrowDown', { metaKey: true }), 2, 4, undefined],
    [press('ArrowLeft'), 2, 4, undefined],
    [press('Enter'), 2, 4, undefined],
  ])('%j at %i of %i gives %j', (event, index, length, expected) => {
    expect(keyMove(event, index, length)).toBe(expected);
  });
});

describe('isTextField', () => {
  it.each([
    [{ tagName: 'INPUT', type: 'text' }, true],
    [{ tagName: 'INPUT' }, true],
    [{ tagName: 'INPUT', type: 'number' }, true],
    [{ tagName: 'INPUT', type: 'checkbox' }, false],
    [{ tagName: 'INPUT', type: 'RADIO' }, false],
    [{ tagName: 'TEXTAREA' }, true],
    [{ tagName: 'SELECT' }, true],
    [{ tagName: 'BUTTON' }, false],
    [{ tagName: 'DIV', isContentEditable: true }, true],
    [{ tagName: 'DIV' }, false],
  ])('%j gives %j', (element, expected) => {
    expect(isTextField(element)).toBe(expected);
  });
});
