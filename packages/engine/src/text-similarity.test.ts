import { describe, expect, it } from 'vitest';
import { jaccard, ngrams, properNames, tokenize, wordsOf } from './text-similarity.js';

describe('tokenize', () => {
  it('lowercases and strips punctuation but keeps contractions whole', () => {
    expect(tokenize("Mira said: \"Don't go -- it's 3 o'clock!\"")).toEqual([
      'mira',
      'said',
      "don't",
      'go',
      "it's",
      '3',
      "o'clock",
    ]);
  });

  it('handles other scripts and never throws on odd input', () => {
    expect(tokenize('Привет, мир! Ünïcode çafé')).toEqual(['привет', 'мир', 'ünïcode', 'çafé']);
    // Unspaced scripts give one token per character, and a spaced word stops where they start.
    expect(tokenize('私は東京に行く')).toEqual([...'私は東京に行く']);
    expect(tokenize('Tokyoに行く')).toEqual(['tokyo', 'に', '行', 'く']);
    for (const text of ['', '   ', '...!?', '😀😀', '\u0000‮']) expect(() => tokenize(text)).not.toThrow();
    expect(tokenize('')).toEqual([]);
  });

  it('reports where each word starts', () => {
    expect(wordsOf('ab cd')).toEqual([
      { text: 'ab', index: 0 },
      { text: 'cd', index: 3 },
    ]);
  });
});

describe('ngrams', () => {
  it.each([
    [['a', 'b', 'c', 'd'], 2, ['a b', 'b c', 'c d']],
    [['a', 'b', 'c', 'd'], 3, ['a b c', 'b c d']],
    [['a', 'b'], 3, []],
    [[], 1, []],
    [['a', 'b'], 1, ['a', 'b']],
    [['a', 'b'], 0, ['a', 'b']],
  ])('%j with n=%i is %j', (tokens, n, expected) => {
    expect(ngrams(tokens, n)).toEqual(expected);
  });
});

describe('jaccard', () => {
  it.each([
    [['a', 'b', 'c'], ['a', 'b', 'c'], 1],
    [['a', 'b'], ['c', 'd'], 0],
    [['a', 'b', 'c'], ['b', 'c', 'd'], 0.5],
    [['a', 'a', 'b'], ['a', 'b'], 1],
    [[], ['a'], 0],
    [[], [], 0],
  ])('%j vs %j is %d', (a, b, expected) => {
    expect(jaccard(a, b)).toBe(expected);
  });
});

describe('properNames', () => {
  it('finds capitalised words inside a sentence, not sentence-initial ones', () => {
    const names = properNames('The door opened. Then Mira met Borin at the Gate. "Hello," said Corvin.');
    expect([...names].sort()).toEqual(['borin', 'corvin', 'gate', 'mira']);
  });

  it('keeps a sentence-initial word only when it is known as a name elsewhere', () => {
    const text = 'Mira laughed. She waved.';
    expect([...properNames(text)]).toEqual([]);
    expect([...properNames(text, { known: new Set(['mira']) })]).toEqual(['mira']);
  });

  it('skips stopwords, single letters and the excluded cast', () => {
    const text = 'Later I think Mira and I saw Dr Vance and Mr Hale on Friday, with Borin.';
    expect([...properNames(text, { exclude: new Set(['mira']) })].sort()).toEqual(['borin', 'hale', 'vance']);
  });

  it('finds nothing in scripts without capitals', () => {
    expect(properNames('私は東京に行く。 привет مرحبا').size).toBe(0);
    expect([...properNames('Он видел Бориса у Реки')].sort()).toEqual(['бориса', 'реки']);
  });
});
