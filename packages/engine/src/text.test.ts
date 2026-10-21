import { expect, it } from 'vitest';
import { coerceValue, stringify } from '@st/shared/ports';
import { describeValue } from './text.js';
import { renderTemplate } from './template.js';

it('keeps compact node output separate from pretty text coercion', () => {
  const value = { nested: [1, true] };
  expect(stringify(value)).toBe('{"nested":[1,true]}');
  expect(coerceValue(value, 'to-text')).toBe(JSON.stringify(value, null, 2));
  expect(renderTemplate('{{input.value}}', { inputs: { value }, trigger: { message: '', sessionId: '' } })).toBe(
    stringify(value),
  );
});

it.each([
  ['hi', 'text'],
  ['', 'text'],
  [7, 'a number'],
  [Number.NaN, 'NaN (not a number)'],
  [Number.POSITIVE_INFINITY, 'an infinite number'],
  [Number.NEGATIVE_INFINITY, 'an infinite number'],
  [true, 'true'],
  [false, 'false'],
  [null, 'null'],
  [undefined, 'nothing'],
  [[1], 'an array'],
  [{ a: 1 }, 'an object'],
])('describes %j as %s in error messages', (value, expected) => {
  expect(describeValue(value)).toBe(expected);
});
