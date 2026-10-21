import { describe, expect, it } from 'vitest';
import { countSlop, fourGrams, mtld } from './metrics.js';
import { chatStats, replyWindow, textStats, WINDOW_SIZE, type StatsMessage } from './index.js';
import { sentences, tokenize } from './tokenize.js';

describe('tokenize', () => {
  it.each([
    ['Hello, World!', ['hello', 'world']],
    ['She didn’t go — not today…', ['she', "didn't", 'go', 'not', 'today']],
    ['*smiles softly* "Come in," he said.', ['smiles', 'softly', 'come', 'in', 'he', 'said']],
    ['# Title\n> quoted _text_ here', ['title', 'quoted', 'text', 'here']],
    ['See [the map](https://x.io/a_b) now', ['see', 'the', 'map', 'now']],
    ['Go to https://example.com/page today', ['go', 'to', 'today']],
    ['Before\n```js\nconst answer = 42;\n```\nafter', ['before', 'after']],
    ['Room 101, well-known ﬁne', ['room', '101', 'well', 'known', 'fine']],
    ['', []],
  ])('%j', (text, expected) => {
    expect(tokenize(text)).toEqual(expected);
  });
});

describe('sentences', () => {
  it('normalizes and keeps only sentences of enough words', () => {
    const text =
      'Yes. "The door creaked open slowly," she said. *He waited!* Was it over? Nobody here knew.\nA new line of words';
    expect(sentences(text, 4)).toEqual(['the door creaked open slowly she said', 'a new line of words']);
  });
});

describe('mtld', () => {
  const words = (count: number) => Array.from({ length: count }, (_, index) => `w${index}`);
  it('is null under the minimum length', () => {
    expect(mtld(words(49))).toBeNull();
  });
  it('is null when no factor ever completes', () => {
    expect(mtld(words(60))).toBeNull();
  });
  it('is the length when a single repeated word is cut every factor', () => {
    // "a a a ..." completes a factor on the 2nd token (ttr 0.5), so 60 tokens make 30 factors: MTLD 2.
    expect(mtld(Array(60).fill('a'))).toBeCloseTo(2, 5);
  });
  it('is higher for a more varied text', () => {
    const repetitive = Array.from({ length: 80 }, (_, index) => ['the', 'cat', 'sat', 'down'][index % 4] as string);
    const varied = Array.from({ length: 80 }, (_, index) => `w${index % 40}`);
    expect(mtld(varied)!).toBeGreaterThan(mtld(repetitive)!);
  });
});

describe('countSlop', () => {
  it('counts every token found in the list', () => {
    expect(countSlop(['ached', 'the', 'ached', 'abuzz'])).toBe(3);
    expect(countSlop(['the', 'door'])).toBe(0);
  });
});

describe('fourGrams', () => {
  it.each([
    [['a', 'b', 'c'], []],
    [
      ['a', 'b', 'c', 'd', 'e'],
      ['a b c d', 'b c d e'],
    ],
  ])('%j', (tokens, expected) => {
    expect(fourGrams(tokens)).toEqual(expected);
  });
});

describe('textStats', () => {
  it('has no overlap without a window or without a 4-gram', () => {
    expect(textStats('one two three four five', []).ngramOverlap).toBeNull();
    expect(textStats('one two three', ['one two three four']).ngramOverlap).toBeNull();
  });
  it('measures the share of 4-gram instances found in the window', () => {
    // 4-grams of the reply: "a b c d", "b c d e", "c d e f"; the window holds the first two.
    const stats = textStats('a b c d e f', ['a b c d e']);
    expect(stats.ngramOverlap).toBeCloseTo(2 / 3, 5);
  });
  it('counts the sentences recycled from the window, ignoring case and punctuation', () => {
    const stats = textStats('The door creaked open. It was fine. Totally new words here!', [
      'Earlier: the DOOR creaked, open! And it was fine.',
      'the door creaked open',
    ]);
    expect(stats.recycledSentences).toBe(1);
  });
  it('counts words and slop', () => {
    const stats = textStats('The air was abuzz and ached.', []);
    expect(stats).toMatchObject({ words: 6, slopWords: 2, mtld: null, ngramOverlap: null, recycledSentences: 0 });
  });
});

describe('replyWindow', () => {
  it('keeps the last replies only', () => {
    const replies = Array.from({ length: WINDOW_SIZE + 3 }, (_, index) => index);
    expect(replyWindow(replies)).toEqual(replies.slice(-WINDOW_SIZE));
    expect(replyWindow([1, 2])).toEqual([1, 2]);
  });
});

describe('chatStats', () => {
  const message = (id: string, role: 'user' | 'assistant', content: string, status?: StatsMessage['status']) => ({
    id,
    role,
    content,
    status,
  });
  const chat = [
    message('u1', 'user', 'hi there my friend'),
    message('a1', 'assistant', 'the old door creaked open again'),
    message('u2', 'user', 'go on'),
    message('a2', 'assistant', 'the old door creaked open again'),
    message('u3', 'user', 'and then'),
    message('a3', 'assistant', 'stopped half way here now', 'partial'),
    message('u4', 'user', 'again'),
    message('a4', 'assistant', 'stopped half way here now'),
  ];
  const history = chat.filter((entry) => entry.status !== 'partial');
  const stats = chatStats(chat, history);

  it('gives stats to assistant replies only', () => {
    expect(Object.keys(stats)).toEqual(['a1', 'a2', 'a3', 'a4']);
  });
  it('compares a reply with the history replies before it, not with itself', () => {
    expect(stats.a1?.ngramOverlap).toBeNull();
    expect(stats.a2?.ngramOverlap).toBe(1);
  });
  it('gives a partial reply stats of its own but keeps it out of every window', () => {
    expect(stats.a3?.ngramOverlap).toBe(0);
    expect(stats.a4?.ngramOverlap).toBe(0);
  });
  it('skips streaming rows', () => {
    expect(chatStats([message('s', 'assistant', 'words', 'streaming')], [])).toEqual({});
  });
  it('agrees with textStats over the same window', () => {
    expect(stats.a2).toEqual(textStats('the old door creaked open again', ['the old door creaked open again']));
  });
});
