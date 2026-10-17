import { expect, it } from 'vitest';
import { formatValue, fullText, itemFields, itemText, quote, shortText } from './format.js';

it('collapses whitespace and cuts with an ellipsis only when too long', () => {
  expect(shortText('  a   bell\non\ta lost animal ', 40)).toBe('a bell on a lost animal');
  expect(shortText('abcdef', 6)).toBe('abcdef');
  expect(shortText('abcdefg', 6)).toBe('abcde…');
  expect(shortText('ab cdefgh', 4)).toBe('ab…');
  expect(shortText('', 5)).toBe('');
  expect(shortText('abc', 0)).toBe('…');
});

it.each([
  [6, '6'],
  [-2.5, '-2.5'],
  [0, '0'],
  [true, 'true'],
  [false, 'false'],
  ['tense', 'tense'],
  ['', '(empty)'],
  ['   ', '(empty)'],
  [null, 'none'],
  [undefined, 'none'],
  [{ a: 1, b: ['x'] }, '{"a":1,"b":["x"]}'],
  [[], '[]'],
])('words %j as %s', (value, expected) => {
  expect(formatValue(value)).toBe(expected);
});

it('cuts a long object and survives values JSON cannot hold', () => {
  const long = formatValue({ text: 'x'.repeat(200) });
  expect(long).toHaveLength(60);
  expect(long.endsWith('…')).toBe(true);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  expect(formatValue(circular)).toBe('none');
  expect(formatValue(() => 1)).toBe('none');
});

it('quotes text with single quotes after collapsing and cutting it', () => {
  expect(quote('a  bell\non a lost animal', 60)).toBe("'a bell on a lost animal'");
  expect(quote('abcdefgh', 5)).toBe("'abcd…'");
  expect(quote('', 5)).toBe("''");
});

it('gives a value in full for a tooltip, objects as indented JSON', () => {
  const object = { notes: 'x'.repeat(100), list: [1, 2] };
  expect(fullText(object)).toBe(JSON.stringify(object, null, 2));
  expect(fullText(object).length).toBeGreaterThan(formatValue(object).length);
  expect(fullText('plain')).toBe('plain');
  expect(fullText(4)).toBe('4');
  expect(fullText(false)).toBe('false');
  expect(fullText(null)).toBe('none');
  expect(fullText(undefined)).toBe('none');
});

it('reads an item as its text and the fields it declares, never its bookkeeping', () => {
  const item = { id: 'e1:note:0', text: 'a bell', entryKey: 'k', level: 2, ok: true };
  expect(itemText(item)).toBe('a bell');
  expect(itemFields(item)).toEqual([
    { name: 'level', value: '2' },
    { name: 'ok', value: 'true' },
  ]);
  expect(itemText({ id: 'x', text: 5 })).toBe('5');
  expect(itemFields({ id: 'x', text: 't' })).toEqual([]);
});
