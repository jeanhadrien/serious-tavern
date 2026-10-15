import { describe, expect, it } from 'vitest';
import type { CollectionEntry } from '@st/shared';
import type { Candidate } from './collections.js';
import { executeWorkflow } from './executor.js';
import { draw } from './nodes/draw/index.js';
import { describeDraw, drawEntries, passesFilters, type DrawFilters } from './nodes/draw/select.js';
import { createRandom } from './seeded-random.js';
import { collection, edge, graph, node, resourcesWith, runNode } from './test-collections.js';

const noFilters: DrawFilters = { requireTags: [], anyTags: [], excludeTags: [] };
const entry = (fields: Partial<CollectionEntry> = {}): CollectionEntry => ({
  text: 'x',
  weight: 1,
  enabled: true,
  ...fields,
});
const candidatesOf = (...entries: CollectionEntry[]): Candidate[] =>
  entries.map((item, index) => ({ collectionId: 'c', index, entry: item }));
const scripted = (...draws: number[]) => {
  const queue = [...draws];
  const random = () => {
    if (!queue.length) throw new Error('drew more than scripted');
    return queue.shift()!;
  };
  return Object.assign(random, { left: () => queue.length });
};

describe('Draw config', () => {
  it('needs a collection, fills defaults and checks level bounds', () => {
    expect(draw.configSchema.safeParse({}).error?.issues).toEqual([
      expect.objectContaining({ path: ['collectionIds'], message: 'Select at least one collection' }),
    ]);
    expect(draw.configSchema.parse({ collectionIds: ['a'] })).toEqual({ ...draw.defaultConfig, collectionIds: ['a'] });
    expect(draw.configSchema.safeParse({ collectionIds: ['a'], minLevel: 3, maxLevel: 2 }).error?.issues).toEqual([
      expect.objectContaining({ path: ['maxLevel'], message: 'Max level must be at least min level' }),
    ]);
    for (const config of [{ minLevel: 0 }, { maxLevel: 6 }, { maxLevel: 2.5 }, { count: 0 }])
      expect(draw.configSchema.safeParse({ collectionIds: ['a'], ...config }).success).toBe(false);
  });
});

describe('passesFilters', () => {
  const tagged = entry({ tags: ['Forest', ' sound ', 'mystery'], level: 2 });
  it.each([
    [{ requireTags: ['forest'] }, true],
    [{ requireTags: ['FOREST', 'sound'] }, true],
    [{ requireTags: ['forest', 'sea'] }, false],
    [{ requireTags: ['', '  '] }, true],
    [{ anyTags: ['sea', 'mystery'] }, true],
    [{ anyTags: ['sea', 'sky'] }, false],
    [{ excludeTags: ['sound'] }, false],
    [{ excludeTags: ['sea'] }, true],
    [{ requireTags: ['forest'], anyTags: ['sea'] }, false],
    [{ maxLevel: 2 }, true],
    [{ maxLevel: 1 }, false],
    [{ minLevel: 2 }, true],
    [{ minLevel: 3 }, false],
    [{ minLevel: 1, maxLevel: 3 }, true],
  ])('%j → %s', (filters, expected) => {
    expect(passesFilters(tagged, { ...noFilters, ...filters })).toBe(expected);
  });

  it('leaves out entries without a level only when a level filter is set', () => {
    expect(passesFilters(entry(), noFilters)).toBe(true);
    expect(passesFilters(entry(), { ...noFilters, maxLevel: 5 })).toBe(false);
    expect(passesFilters(entry(), { ...noFilters, minLevel: 1 })).toBe(false);
  });
});

describe('drawEntries', () => {
  const options = { count: 1, useWeights: true };
  const texts = (result: { drawn: Candidate[] }) => result.drawn.map(({ entry }) => entry.text);
  const weighted = candidatesOf(entry({ text: 'a', weight: 1 }), entry({ text: 'b', weight: 3 }));

  it('picks by cumulative weight', () => {
    expect(texts(drawEntries(weighted, noFilters, options, scripted(0.2)))).toEqual(['a']);
    expect(texts(drawEntries(weighted, noFilters, options, scripted(0.25)))).toEqual(['b']);
    expect(texts(drawEntries(weighted, noFilters, options, scripted(0.99)))).toEqual(['b']);
  });

  it('gives every entry the same chance with weights off, but never draws weight 0', () => {
    const off = { ...options, useWeights: false };
    expect(texts(drawEntries(weighted, noFilters, off, scripted(0.49)))).toEqual(['a']);
    expect(texts(drawEntries(weighted, noFilters, off, scripted(0.5)))).toEqual(['b']);
    const zero = candidatesOf(entry({ text: 'a', weight: 0 }), entry({ text: 'b' }));
    expect(texts(drawEntries(zero, noFilters, off, scripted(0)))).toEqual(['b']);
    const none = drawEntries(candidatesOf(entry({ weight: 0 })), noFilters, options, scripted());
    expect(none).toEqual({ drawn: [], eligible: 0, excluded: 0, considered: 1 });
  });

  it('draws without replacement, one draw per pick', () => {
    const five = candidatesOf(...['a', 'b', 'c', 'd', 'e'].map((text) => entry({ text })));
    const random = scripted(0, 0, 0);
    const result = drawEntries(five, noFilters, { ...options, count: 3 }, random);
    expect(texts(result)).toEqual(['a', 'b', 'c']);
    expect(result).toMatchObject({ eligible: 5, considered: 5 });
    expect(random.left()).toBe(0);
  });

  it('draws every eligible entry when asked for more', () => {
    const random = scripted(0.9, 0.9, 0.9);
    const result = drawEntries(weighted, noFilters, { ...options, count: 5 }, random);
    expect(texts(result).sort()).toEqual(['a', 'b']);
    expect(random.left()).toBe(1);
  });

  it('removes and counts excluded candidates (the seam for avoiding recent draws)', () => {
    const result = drawEntries(
      weighted,
      noFilters,
      { ...options, isExcluded: ({ entry }) => entry.text === 'b' },
      scripted(0.9),
    );
    expect(result).toMatchObject({ eligible: 1, excluded: 1, considered: 2 });
    expect(texts(result)).toEqual(['a']);
  });

  it('follows the weights over many seeded draws', () => {
    const deck = candidatesOf(...[1, 2, 7].map((weight, index) => entry({ text: String(index), weight })));
    const random = createRandom('seed:draw');
    const counts = [0, 0, 0];
    const runs = 20_000;
    for (let run = 0; run < runs; run++)
      counts[Number(drawEntries(deck, noFilters, options, random).drawn[0]!.entry.text)]!++;
    const frequencies = counts.map((count) => count / runs);
    for (const [index, expected] of [0.1, 0.2, 0.7].entries())
      expect(Math.abs(frequencies[index]! - expected)).toBeLessThan(0.02);
  });
});

describe('describeDraw', () => {
  const result = (drawn: number, eligible: number, considered = eligible, excluded = 0) => ({
    drawn: candidatesOf(...Array.from({ length: drawn }, () => entry())),
    eligible,
    excluded,
    considered,
  });
  const on = { count: 1, useWeights: true };
  it.each([
    [result(1, 14), { requireTags: ['forest'], maxLevel: 2 }, on, 'drew 1 of 14 eligible (tags: forest; level ≤ 2)'],
    [
      result(2, 2),
      { requireTags: ['forest'] },
      { ...on, count: 3 },
      'drew 2 of 2 eligible (asked for 3; tags: forest)',
    ],
    [
      result(0, 0, 20),
      { requireTags: ['forest'], maxLevel: 2 },
      on,
      'no eligible entry among 20 (tags: forest; level ≤ 2)',
    ],
    [result(0, 0, 0), {}, on, 'no eligible entry among 0'],
    [result(1, 3), {}, on, 'drew 1 of 3 eligible'],
    [result(1, 3), { minLevel: 2, maxLevel: 4 }, on, 'drew 1 of 3 eligible (level 2–4)'],
    [result(1, 3), { minLevel: 3 }, on, 'drew 1 of 3 eligible (level ≥ 3)'],
    [result(1, 3), { minLevel: 3, maxLevel: 3 }, on, 'drew 1 of 3 eligible (level 3)'],
    [result(1, 3), { anyTags: ['A', 'b'] }, on, 'drew 1 of 3 eligible (any tag: a, b)'],
    [result(1, 3), { excludeTags: ['c'] }, on, 'drew 1 of 3 eligible (without: c)'],
    [result(1, 3), {}, { ...on, useWeights: false }, 'drew 1 of 3 eligible (weights off)'],
    [result(1, 3, 5, 2), {}, on, 'drew 1 of 3 eligible (2 recent excluded)'],
  ])('%#: %s', (drawResult, filters, options, expected) => {
    expect(describeDraw(drawResult, { ...noFilters, ...filters }, options)).toBe(expected);
  });
});

const deck = collection('deck', [
  { text: 'resin after rain', tags: ['sensory', 'forest'], level: 1 },
  { text: 'a boundary stone', tags: ['object', 'forest'], level: 2, weight: 2 },
  { text: 'a bell somewhere', tags: ['sound'], level: 2 },
  { text: 'no level', tags: ['forest'] },
  { text: 'disabled', tags: ['forest'], level: 1, enabled: false },
  { text: '   ', tags: ['forest'], level: 1 },
]);
const drawWith = (config: Record<string, unknown>, inputs: Record<string, unknown> = {}, draws?: number[]) =>
  runNode(draw, { collectionIds: ['deck'], ...config }, { resources: resourcesWith(deck), inputs, draws });

describe('Draw node', () => {
  it('outputs the drawn entry, its text, the list and the reason', async () => {
    const { output } = await drawWith({ requireTags: ['forest'], maxLevel: 2 }, {}, [0.5]);
    expect(output).toEqual({
      entry: {
        collectionId: 'deck',
        entryId: 'entry-2',
        text: 'a boundary stone',
        keywords: [],
        tags: ['object', 'forest'],
        level: 2,
      },
      text: 'a boundary stone',
      entries: [expect.objectContaining({ entryId: 'entry-2' })],
      reason: 'drew 1 of 2 eligible (tags: forest; level ≤ 2)',
    });
  });

  it('joins the texts one per line when drawing several', async () => {
    const { output } = await drawWith({ count: 2, requireTags: ['forest'], maxLevel: 2 }, {}, [0, 0]);
    expect(output.text).toBe('resin after rain\na boundary stone');
    expect(output.entry).toMatchObject({ text: 'resin after rain' });
    expect(output.entries).toHaveLength(2);
  });

  it('returns only the empty list and the reason when nothing is eligible', async () => {
    const { output, drawn } = await drawWith({ requireTags: ['sea'] });
    expect(output).toEqual({ entries: [], reason: 'no eligible entry among 4 (tags: sea)' });
    expect(drawn).toBe(0);
  });

  it('never draws disabled entries or blank texts', async () => {
    const { output } = await drawWith({ count: 10 });
    expect((output.entries as Array<{ text: string }>).map((item) => item.text).sort()).toEqual([
      'a bell somewhere',
      'a boundary stone',
      'no level',
      'resin after rain',
    ]);
  });

  it.each([
    [1, ['resin after rain']],
    ['1', ['resin after rain']],
    [' 2 ', ['a bell somewhere', 'a boundary stone', 'resin after rain']],
  ])('takes Max level %j from its input, which also leaves out entries without a level', async (maxLevel, expected) => {
    const { output } = await drawWith({ count: 10, maxLevel: 5 }, { maxLevel });
    expect((output.entries as Array<{ text: string }>).map((item) => item.text).sort()).toEqual(expected);
  });

  it.each([
    ['abc', 'Max level must be a number, got "abc"'],
    ['', 'Max level must be a number, got ""'],
    [{}, 'Max level must be a number, got an object'],
    [null, 'Max level must be a number, got null'],
  ])('fails on a Max level input of %j', async (maxLevel, message) => {
    await expect(drawWith({}, { maxLevel })).rejects.toThrow(message);
  });

  it.each([
    ['forest, object', ['a boundary stone']],
    [['Sound'], ['a bell somewhere']],
    ['', ['a bell somewhere', 'a boundary stone', 'no level', 'resin after rain']],
    [[], ['a bell somewhere', 'a boundary stone', 'no level', 'resin after rain']],
  ])('replaces Require tags with a Tags input of %j', async (tags, expected) => {
    const { output } = await drawWith({ count: 10, requireTags: ['sensory'] }, { tags });
    expect((output.entries as Array<{ text: string }>).map((item) => item.text).sort()).toEqual(expected);
  });

  it.each([
    [[1], 'Tags must be text, got a number'],
    [{}, 'Tags must be a list or comma-separated text, got an object'],
    [3, 'Tags must be a list or comma-separated text, got a number'],
  ])('fails on a Tags input of %j', async (tags, message) => {
    await expect(drawWith({}, { tags })).rejects.toThrow(message);
  });

  it('fails with a plain message naming an unknown collection', async () => {
    await expect(drawWith({ collectionIds: ['nope'] })).rejects.toThrow('Collection nope not found');
  });
});

describe('Draw in a workflow', () => {
  const big = collection(
    'big',
    Array.from({ length: 20 }, (_, index) => ({ text: `entry ${index + 1}` })),
  );
  const options = {
    message: 'go',
    sessionId: 's',
    history: [],
    secrets: { get: async () => undefined },
    resources: resourcesWith(deck, big),
  };

  it('draws the same entries for the same seed', async () => {
    const workflow = graph(
      [
        node('input', 'chat-input'),
        node('draw', 'draw', { collectionIds: ['big'], count: 3 }),
        node('out', 'chat-output'),
      ],
      [edge('draw', 'text', 'out', 'value')],
    );
    const run = async (seed: string) => (await executeWorkflow(workflow, { ...options, seed })).replies[0]?.content;
    expect(await run('one')).toBe(await run('one'));
    const firsts = new Set(
      await Promise.all(['a', 'b', 'c', 'd', 'e'].map(async (seed) => (await run(seed))?.split('\n')[0])),
    );
    expect(firsts.size).toBeGreaterThan(1);
  });

  it('skips what its text feeds when nothing is eligible, and still outputs the reason', async () => {
    const workflow = graph(
      [
        node('input', 'chat-input'),
        node('draw', 'draw', { collectionIds: ['deck'], requireTags: ['sea'] }),
        node('text', 'chat-output'),
        node('reason', 'chat-output', { order: 1 }),
      ],
      [edge('draw', 'text', 'text', 'value'), edge('draw', 'reason', 'reason', 'value')],
    );
    const result = await executeWorkflow(workflow, options);
    expect(result.execution.nodes.text?.status).toBe('skipped');
    expect(result.replies.map((reply) => reply.content)).toEqual(['no eligible entry among 4 (tags: sea)']);
  });

  it('is skipped when a connected input comes from a branch that was not taken', async () => {
    const workflow = graph(
      [
        node('input', 'chat-input'),
        node('combat', 'condition', { operator: 'equals', right: 'combat' }),
        node('draw', 'draw', { collectionIds: ['deck'] }),
        node('out', 'chat-output'),
      ],
      [
        edge('input', 'message', 'combat', 'value'),
        edge('combat', 'true', 'draw', 'tags'),
        edge('draw', 'reason', 'out', 'value'),
      ],
    );
    const result = await executeWorkflow(workflow, options);
    expect(result.execution.nodes.draw?.status).toBe('skipped');
    expect(result.replies).toEqual([]);
  });
});
