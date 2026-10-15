import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ChatMessage } from '@st/shared';
import { executeWorkflow } from './executor.js';
import { recall } from './nodes/recall/index.js';
import { keywordMatcher } from './nodes/recall/match.js';
import { collection, edge, graph, node, resourcesWith, runNode } from './test-collections.js';

const message = (content: string, role: ChatMessage['role'] = 'user'): ChatMessage => ({
  id: content,
  role,
  content,
  createdAt: '',
});

const lore = collection('lore', [
  { title: 'The Salt Inn', text: 'The Salt Inn sits by the river.', keywords: ['salt inn', 'Borin'], level: 2 },
  { text: 'Resin after rain.', tags: ['forest'] },
  { text: 'Snow on the pass.', keywords: ['pass'], tags: ['mountain', 'cold'] },
]);

const recallWith = (
  config: Record<string, unknown>,
  options: { message?: string; history?: ChatMessage[]; inputs?: Record<string, unknown> } = {},
  ...collections: ReturnType<typeof collection>[]
) =>
  runNode(
    recall,
    { collectionIds: ['lore'], ...config },
    { resources: resourcesWith(lore, ...collections), ...options },
  );
const texts = async (...args: Parameters<typeof recallWith>) =>
  ((await recallWith(...args)).output.entries as Array<{ text: string }>).map((entry) => entry.text);

describe('Recall config', () => {
  it('needs at least one collection and fills the defaults', () => {
    const missing = recall.configSchema.safeParse({});
    expect(missing.success).toBe(false);
    expect(missing.error?.issues).toEqual([
      expect.objectContaining({ path: ['collectionIds'], message: 'Select at least one collection' }),
    ]);
    expect(recall.configSchema.parse({ collectionIds: ['a'] })).toEqual({
      ...recall.defaultConfig,
      collectionIds: ['a'],
    });
  });

  it('describes collectionIds as an array, so the editor needs a custom panel', () => {
    const schema = z.toJSONSchema(recall.configSchema) as { properties: Record<string, { type?: string }> };
    expect(schema.properties.collectionIds?.type).toBe('array');
  });

  it.each([{ scanMessages: -1 }, { maxEntries: 0 }, { maxChars: -1 }, { scanMessages: 1.5 }])(
    'rejects %j',
    (config) => {
      expect(recall.configSchema.safeParse({ collectionIds: ['a'], ...config }).success).toBe(false);
    },
  );
});

describe('Recall scanning', () => {
  it('matches keywords in the current message', async () => {
    expect(await texts({}, { message: 'We reach the salt inn.' })).toEqual(['The Salt Inn sits by the river.']);
  });

  it('scans the last N history messages, plus the current message', async () => {
    const history = [message('Borin waves.'), message('Nothing here.', 'assistant')];
    expect(await texts({ scanMessages: 2 }, { history })).toHaveLength(1);
    expect(await texts({ scanMessages: 1 }, { history })).toEqual([]);
    expect(await texts({ scanMessages: 0 }, { history, message: 'over the pass' })).toEqual(['Snow on the pass.']);
  });

  it('scans the text input as well, and is fine without it', async () => {
    expect(await texts({}, { inputs: { text: 'the pass is closed' } })).toEqual(['Snow on the pass.']);
    expect(await texts({ scanMessages: 0 }, {})).toEqual([]);
  });

  it('never matches a keyword across two messages', async () => {
    const history = [message('the salt'), message('inn is closed')];
    expect(await texts({}, { history })).toEqual([]);
  });

  it('ignores case unless asked', async () => {
    expect(await texts({}, { message: 'borin' })).toHaveLength(1);
    expect(await texts({ caseSensitive: true }, { message: 'borin' })).toEqual([]);
    expect(await texts({ caseSensitive: true }, { message: 'Borin' })).toHaveLength(1);
  });
});

describe('Recall keyword matching', () => {
  const matches = (keyword: string, text: string, options: { caseSensitive?: boolean; wholeWords?: boolean } = {}) =>
    keywordMatcher(keyword, { caseSensitive: false, wholeWords: true, ...options })?.test(text) ?? false;

  it.each([
    ['inn', 'the innkeeper', false],
    ['inn', 'the inn.', true],
    ['inn', "the inn's door", true],
    ['salt inn', 'the Salt Inn', true],
    ['café', 'two cafés', false],
    ['café', 'a café!', true],
    ['Борин', 'где Борин?', true],
    ['Борин', 'у Борина', false],
    ['борин', 'БОРИН', true],
    ['C++', 'I like C++.', true],
    ['#tag', 'a #tag here', true],
    ['a.b', 'aXb', false],
    ['a.b', 'see a.b now', true],
    ['(x)', 'the (x) mark', true],
    ['[sic]', 'it was [sic] wrong', true],
    ['\\d', 'digit 5', false],
    ['\\d', 'a \\d escape', true],
    ['x|y', 'x', false],
    ['east-west', 'the east-west road', true],
    ['42', 'room 421', false],
    ['42', 'room 42', true],
  ])('%s in %j: %s', (keyword, text, expected) => {
    expect(matches(keyword, text)).toBe(expected);
  });

  it('matches inside words when whole words are off', () => {
    expect(matches('inn', 'the innkeeper', { wholeWords: false })).toBe(true);
    expect(matches('a.b', 'aXb', { wholeWords: false })).toBe(false);
  });

  it('has no matcher for a blank keyword', () => {
    expect(keywordMatcher('  ', { caseSensitive: false, wholeWords: true })).toBeNull();
  });
});

describe('Recall entries', () => {
  const special = collection('special', [
    { text: 'No keywords at all.' },
    { text: 'Blank keywords only.', keywords: ['', '  '] },
    { text: 'Disabled.', keywords: ['pass'], enabled: false },
    { text: '   ', keywords: ['pass'] },
    { text: 'Twice matched.', keywords: ['pass', 'snow'] },
  ]);

  it('skips entries without keywords, disabled entries and blank texts, and keeps a doubly matched entry once', async () => {
    expect(
      await texts({ collectionIds: ['special'] }, { message: 'snow on the pass, no keywords at all' }, special),
    ).toEqual(['Twice matched.']);
  });

  it('keeps collection order (as configured), then file order, each collection once', async () => {
    const other = collection('other', [{ text: 'Other pass.', keywords: ['pass'] }]);
    const message = 'Borin crosses the pass';
    expect(await texts({ collectionIds: ['other', 'lore'] }, { message }, other)).toEqual([
      'Other pass.',
      'The Salt Inn sits by the river.',
      'Snow on the pass.',
    ]);
    expect(await texts({ collectionIds: ['lore', 'other', 'lore'] }, { message }, other)).toEqual([
      'The Salt Inn sits by the river.',
      'Snow on the pass.',
      'Other pass.',
    ]);
  });

  it('outputs the joined text, the entries and the count', async () => {
    const { output, logs } = await recallWith({}, { message: 'Borin and the pass' });
    expect(output).toEqual({
      text: 'The Salt Inn sits by the river.\n\nSnow on the pass.',
      entries: [
        {
          collectionId: 'lore',
          entryId: 'entry-1',
          title: 'The Salt Inn',
          text: 'The Salt Inn sits by the river.',
          keywords: ['salt inn', 'Borin'],
          tags: [],
          level: 2,
        },
        {
          collectionId: 'lore',
          entryId: 'entry-3',
          text: 'Snow on the pass.',
          keywords: ['pass'],
          tags: ['mountain', 'cold'],
        },
      ],
      count: 2,
    });
    expect(logs).toEqual([]);
  });

  it('outputs empty results when nothing matched', async () => {
    expect((await recallWith({}, { message: 'nothing' })).output).toEqual({ text: '', entries: [], count: 0 });
  });

  it('uses the separator', async () => {
    expect((await recallWith({ separator: ' | ' }, { message: 'Borin, pass' })).output.text).toBe(
      'The Salt Inn sits by the river. | Snow on the pass.',
    );
  });
});

describe('Recall limits', () => {
  const deck = collection('deck', [
    { text: 'aaaa', keywords: ['x'] },
    { text: 'bbbbbbbbbb', keywords: ['x'] },
    { text: 'cc', keywords: ['x'] },
  ]);
  const limited = (config: Record<string, unknown>) =>
    recallWith({ collectionIds: ['deck'], separator: '+', ...config }, { message: 'x' }, deck);

  it('keeps at most maxEntries, in order, and logs what it dropped', async () => {
    const { output, logs } = await limited({ maxEntries: 2 });
    expect(output).toMatchObject({ text: 'aaaa+bbbbbbbbbb', count: 2 });
    expect(logs).toEqual(['Matched 3 entries; kept 2 (max entries 2).']);
  });

  it('stops at the first entry that would pass maxChars, without skipping to a shorter one', async () => {
    const { output, logs } = await limited({ maxChars: 14 });
    expect(output).toMatchObject({ text: 'aaaa', count: 1 });
    expect(logs).toEqual(['Matched 3 entries; kept 1 (max entries 5, max characters 14).']);
    // The separator counts: 4 + 1 + 10 = 15.
    expect((await limited({ maxChars: 15 })).output).toMatchObject({ text: 'aaaa+bbbbbbbbbb', count: 2 });
  });

  it('outputs nothing when the first entry alone is too long', async () => {
    expect((await limited({ maxChars: 3 })).output).toEqual({ text: '', entries: [], count: 0 });
  });
});

describe('Recall errors and runs', () => {
  it('fails with a plain message naming an unknown collection', async () => {
    await expect(recallWith({ collectionIds: ['nope'] })).rejects.toThrow(
      "Collection nope not found. Pick another collection in the node's settings.",
    );
    await expect(
      runNode(recall, { collectionIds: ['lore'] }, { resources: { presets: { get: async () => undefined } } }),
    ).rejects.toThrow('Collection lore not found');
  });

  it('runs in a workflow, reading each collection once per run', async () => {
    let reads = 0;
    const workflow = graph(
      [
        node('input', 'chat-input'),
        node('recall', 'recall', { collectionIds: ['lore'] }),
        node('again', 'recall', { collectionIds: ['lore'], maxEntries: 1 }),
        node('output', 'chat-output'),
        node('second', 'chat-output', { order: 1 }),
      ],
      [edge('recall', 'text', 'output', 'value'), edge('again', 'count', 'second', 'value')],
    );
    const result = await executeWorkflow(workflow, {
      message: 'I enter the salt inn',
      sessionId: 's',
      history: [],
      secrets: { get: async () => undefined },
      resources: {
        presets: { get: async () => undefined },
        collections: {
          get: async (id) => {
            reads++;
            return id === 'lore' ? lore : undefined;
          },
        },
      },
    });
    expect(result.replies.map((reply) => reply.content)).toEqual(['The Salt Inn sits by the river.', '1']);
    expect(reads).toBe(1);
  });
});
