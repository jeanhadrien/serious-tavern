import { describe, expect, it } from 'vitest';
import { templateFieldWarnings } from './templateFieldWarnings.js';

const inputs = ['value', 'character'];

describe('templateFieldWarnings', () => {
  it.each([
    ['a clean template', '{{input.value}} says {{character.name}}', []],
    ['an unknown macro', '{{nope}}', ['Unknown macro: {{nope}}']],
    ['an input the node does not have', '{{input.other}}', ['Unknown input: other']],
    ['an empty field', '', []],
    ['a value that is not text', 42, []],
    ['a field that is not set', undefined, []],
  ])('%s', (_, value, expected) => {
    expect(templateFieldWarnings(value, inputs)).toEqual(expected);
  });

  it('checks the value of each key/value row, not the key', () => {
    const rows = [
      { key: '{{ignored}}', value: '{{nope}}' },
      { key: 'X-Other', value: '{{input.value}}' },
      { key: 'X-Again', value: '{{nope}}' },
    ];
    expect(templateFieldWarnings(rows, inputs)).toEqual(['Unknown macro: {{nope}}']);
  });

  it('warns about unknown snippets only when the stored names are known', () => {
    expect(templateFieldWarnings('{{snippets.tone}}', inputs)).toEqual([]);
    expect(templateFieldWarnings('{{snippets.tone}}', inputs, ['style'])).toEqual(['Unknown snippet: tone']);
  });

  it('leaves an array that is not key/value rows alone', () => {
    expect(templateFieldWarnings(['{{nope}}'], inputs)).toEqual([]);
  });
});
