import { expect, it } from 'vitest';
import { coerceValue, describeValue, stringify } from './text.js';
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
  [null, ''],
  [undefined, ''],
  ['', ''],
  [0, '0'],
  [false, 'false'],
  ['text', 'text'],
])('preserves scalar conversion for %s', (value, expected) => {
  expect(stringify(value)).toBe(expected);
  expect(coerceValue(value, 'to-text')).toBe(expected);
});

it('uses the same role/content transcript for messages and ignores speaker names', () => {
  expect(
    coerceValue(
      [
        { role: 'user', content: 'Hello', name: 'User' },
        { role: 'assistant', content: 'Hi' },
      ],
      'messages-to-text',
    ),
  ).toBe('user: Hello\nassistant: Hi');
  expect(coerceValue([], 'messages-to-text')).toBe('');
  expect(coerceValue({ not: 'messages' }, 'messages-to-text')).toBe('{"not":"messages"}');
});

it.each([
  ['hi', 'text'],
  ['', 'text'],
  [7, 'a number'],
  [true, 'true'],
  [false, 'false'],
  [null, 'null'],
  [undefined, 'nothing'],
  [[1], 'an array'],
  [{ a: 1 }, 'an object'],
])('describes %j as %s in error messages', (value, expected) => {
  expect(describeValue(value)).toBe(expected);
});
