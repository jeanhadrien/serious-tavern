import { describe, expect, it } from 'vitest';
import { escapeStep, isFieldElement, type EscapeSituation, type EscapeStep } from './escape.js';

const base: EscapeSituation = { handled: false, inDialog: false, layers: 0, inField: false };

describe('escapeStep', () => {
  const table: [string, Partial<EscapeSituation>, EscapeStep][] = [
    ['nothing special: the area acts', {}, 'area'],
    ['a field handled it', { handled: true }, 'none'],
    ['a field handled it, with layers and a field', { handled: true, layers: 2, inField: true }, 'none'],
    ['inside a native dialog', { inDialog: true }, 'none'],
    ['inside a dialog, with layers', { inDialog: true, layers: 1, inField: true }, 'none'],
    ['a layer is open', { layers: 1 }, 'layer'],
    ['a layer is open and focus is in a field', { layers: 3, inField: true }, 'layer'],
    ['focus is in a field', { inField: true }, 'leaveField'],
  ];
  it.each(table)('%s', (_name, change, step) => {
    expect(escapeStep({ ...base, ...change })).toBe(step);
  });
});

describe('isFieldElement', () => {
  it.each([
    [{ tagName: 'INPUT' }, true],
    [{ tagName: 'textarea' }, true],
    [{ tagName: 'SELECT' }, true],
    [{ tagName: 'DIV', isContentEditable: true }, true],
    [{ tagName: 'BUTTON' }, false],
    [{ tagName: 'SECTION', isContentEditable: false }, false],
    [null, false],
    [undefined, false],
  ])('%j is a field: %s', (element, expected) => {
    expect(isFieldElement(element)).toBe(expected);
  });
});
