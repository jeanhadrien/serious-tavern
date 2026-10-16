import { describe, expect, it } from 'vitest';
import {
  fieldsText,
  numberText,
  objectText,
  optionsText,
  parseFields,
  parseNumberText,
  parseObjectText,
  parseOptions,
} from './keyFields.js';

describe('numbers', () => {
  it('writes a number as text, and nothing for undefined', () => {
    expect([numberText(undefined), numberText(0), numberText(-1), numberText(0.25), numberText(1e21)]).toEqual([
      '',
      '0',
      '-1',
      '0.25',
      '1e+21',
    ]);
  });

  it.each([
    ['0', 0],
    ['-1', -1],
    ['  7 ', 7],
    ['1e3', 1000],
    ['1e+21', 1e21],
    ['.5', 0.5],
    ['2.', 2],
    ['+3', 3],
  ])('reads %j as %d', (text, value) => {
    expect(parseNumberText(text)).toEqual({ ok: true, value });
  });

  it.each(['', ' ', '\n'])('reads blank %j as not set', (text) => {
    expect(parseNumberText(text)).toEqual({ ok: true });
  });

  it.each(['abc', '1,5', '1 2', '0x10', 'Infinity', 'NaN', '--1', '1e', '.'])('rejects %j', (text) => {
    expect(parseNumberText(text)).toEqual({ ok: false });
  });
});

describe('options', () => {
  it('goes through one option per line, dropping blanks and trimming', () => {
    expect(optionsText(['calm', 'tense'])).toBe('calm\ntense');
    expect(optionsText([])).toBe('');
    expect(parseOptions(' calm \n\n tense\n  \n')).toEqual(['calm', 'tense']);
    expect(parseOptions('')).toEqual([]);
    // Repeated options are kept; the definition check reports them.
    expect(parseOptions('a\na')).toEqual(['a', 'a']);
  });
});

describe('item fields', () => {
  it('writes name:type per line', () => {
    expect(fieldsText({ level: 'number', weight: 'text' })).toBe('level:number\nweight:text');
    expect(fieldsText(undefined)).toBe('');
    expect(fieldsText({})).toBe('');
  });

  it('reads them back, allowing blank lines and spaces around the colon', () => {
    expect(parseFields('a:text\n\nb : number\n  c:boolean ')).toEqual({
      ok: true,
      fields: { a: 'text', b: 'number', c: 'boolean' },
    });
    expect(parseFields('')).toEqual({ ok: true });
    expect(parseFields('\n  \n')).toEqual({ ok: true });
  });

  it('names the line of each problem as the user counts it', () => {
    expect(parseFields('a:text\nb:blob\nc')).toEqual({
      ok: false,
      errors: [
        'Line 2: write name:type, with type text, number or boolean',
        'Line 3: write name:type, with type text, number or boolean',
      ],
    });
    expect(parseFields('a:text\n\nb c:text')).toEqual({
      ok: false,
      errors: ['Line 3: "b c" is not a usable field name (letters, digits and _, not starting with a digit)'],
    });
    expect(parseFields('a:text\na:number')).toEqual({ ok: false, errors: ['Line 2: "a" is listed twice'] });
    expect(parseFields(':text')).toMatchObject({ ok: false });
    expect(parseFields('1a:text')).toMatchObject({ ok: false });
  });

  it('round-trips', () => {
    const fields = { level: 'number', note: 'text', flag: 'boolean' } as const;
    expect(parseFields(fieldsText(fields))).toEqual({ ok: true, fields });
  });
});

describe('objects', () => {
  it('writes pretty JSON, and nothing for undefined', () => {
    expect(objectText({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(objectText(undefined)).toBe('');
    expect(objectText({})).toBe('{}');
  });

  it('reads a JSON object, and blank as none', () => {
    expect(parseObjectText('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseObjectText(' {} ')).toEqual({ ok: true, value: {} });
    expect(parseObjectText('')).toEqual({ ok: true });
    expect(parseObjectText('  \n')).toEqual({ ok: true });
  });

  it.each(['[1]', '3', '"x"', 'null', 'true'])('rejects %s because it is not an object', (text) => {
    expect(parseObjectText(text)).toEqual({ ok: false, error: 'Must be a JSON object, like {"a": 1}' });
  });

  it('reports invalid JSON', () => {
    const result = parseObjectText('{"a":');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/^Not valid JSON/);
  });
});
