import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@st/shared';
import { registry } from './registry.js';
import { stagnation } from './nodes/stagnation/index.js';
import { castNames, measureStagnation } from './nodes/stagnation/measure.js';
import { resourcesWith, runNode } from './test-collections.js';

const resources = resourcesWith();
const reply = (content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: content,
  role: 'assistant',
  content,
  createdAt: '',
  ...extra,
});
const user = (content: string): ChatMessage => ({ id: `u-${content}`, role: 'user', content, createdAt: '' });
const run = (history: ChatMessage[], config: Record<string, unknown> = {}) =>
  runNode(stagnation, config, { resources, history });

const LOOP = 'The rain keeps falling on the quiet street and nothing moves in the grey light of the evening.';
const params = { ngram: 3, repetitionWeight: 0.6, churnWeight: 0.4, repetitionFull: 0.3, cast: new Set<string>() };

describe('Stagnation config and ports', () => {
  it('has the documented defaults, is registered and sits under Creativity', () => {
    expect(registry.get('stagnation')).toBe(stagnation);
    expect(stagnation.category).toBe('Creativity');
    expect(stagnation.configSchema.parse({})).toEqual({
      window: 4,
      ngram: 3,
      repetitionWeight: 0.6,
      churnWeight: 0.4,
      repetitionFull: 0.3,
    });
    expect(stagnation.configSchema.parse(stagnation.defaultConfig)).toEqual(stagnation.configSchema.parse({}));
    expect(stagnation.outputs.map((port) => [port.name, port.dataType])).toEqual([
      ['score', 'number'],
      ['repetition', 'number'],
      ['novelty', 'number'],
      ['reason', 'text'],
    ]);
  });

  it.each([
    [{ window: 1 }, 'at least 2 replies'],
    [{ window: 2.5 }, undefined],
    [{ ngram: 0 }, 'N-gram size'],
    [{ ngram: 9 }, 'N-gram size'],
    [{ repetitionWeight: -1 }, 'can not be negative'],
    [{ repetitionFull: 0 }, 'Full repetition'],
    [{ repetitionFull: 1.5 }, 'Full repetition'],
    [{ repetitionWeight: 0, churnWeight: 0 }, 'At least one weight'],
  ])('rejects %j', (config, message) => {
    const result = stagnation.configSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (message) expect(result.error!.issues.map((issue) => issue.message).join('\n')).toContain(message);
  });
});

describe('measureStagnation', () => {
  it('scores identical replies as very stagnant', () => {
    const result = measureStagnation({ ...params, replies: [LOOP, LOOP, LOOP, LOOP] });
    expect(result.repetition).toBe(1);
    expect(result.score).toBe(1);
  });

  it('scores disjoint replies near zero', () => {
    const result = measureStagnation({
      ...params,
      replies: [
        'Wind rattles the shutters while embers die slowly in the hearth.',
        'A merchant argues loudly about the price of salted fish at dawn.',
        'Deep underground, water drips through cracks into a hidden cistern.',
      ],
    });
    expect(result.repetition).toBe(0);
    expect(result.score).toBe(0);
  });

  it('counts new names as churn: a repeated cast is stagnant, fresh names are not', () => {
    const stale = measureStagnation({
      ...params,
      repetitionWeight: 0,
      replies: ['Then Borin spoke to Corvin about the Gate.', 'Later Corvin answered Borin near the Gate.'],
    });
    expect(stale.names).toEqual({ total: 3, fresh: 0 });
    expect(stale.novelty).toBe(0);
    expect(stale.score).toBe(1);
    const fresh = measureStagnation({
      ...params,
      repetitionWeight: 0,
      replies: ['Then Borin spoke to Corvin about the Gate.', 'Later Ysolde crossed the Marsh with Tamsin.'],
    });
    expect(fresh.names).toEqual({ total: 3, fresh: 3 });
    expect(fresh.novelty).toBe(1);
    expect(fresh.score).toBe(0);
  });

  it('leaves the cast out of the churn', () => {
    const replies = ['Then Mira spoke to Borin.', 'Later Mira answered Borin and Ysolde.'];
    expect(measureStagnation({ ...params, replies }).names).toEqual({ total: 3, fresh: 1 });
    const result = measureStagnation({ ...params, replies, cast: castNames('Mira Vance', 'Borin') });
    expect(result.names).toEqual({ total: 1, fresh: 1 });
  });

  it('falls back to the repetition alone when the newest reply names nobody', () => {
    const result = measureStagnation({ ...params, replies: [LOOP, LOOP] });
    expect(result.names.total).toBe(0);
    expect(result.novelty).toBe(1);
    expect(result.score).toBe(1);
    expect(result.reason).toContain('no names in the newest reply');
  });

  it('survives text without capitals, without spaces and too short for n-grams', () => {
    for (const replies of [
      ['私は東京に行く。私は東京に行く。', '私は東京に行く。私は東京に行く。'],
      ['привет мир привет мир', 'привет мир привет мир'],
      ['hi', 'yo'],
      ['', ''],
      ['😀😀😀', '😀😀😀'],
    ]) {
      const result = measureStagnation({ ...params, replies });
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(Number.isFinite(result.score)).toBe(true);
    }
    expect(measureStagnation({ ...params, replies: ['私は東京に行く。', '私は東京に行く。'] }).repetition).toBe(1);
    expect(measureStagnation({ ...params, replies: ['hi', 'yo'] }).reason).toContain('too short');
  });

  it('weights the two measures and scales the repetition by repetitionFull', () => {
    // 1 of 2 trigrams shared in one direction each: jaccard 1/3.
    const replies = ['alpha beta gamma delta', 'alpha beta gamma epsilon'];
    const result = measureStagnation({ ...params, replies });
    expect(result.repetition).toBeCloseTo(1 / 3);
    expect(result.score).toBe(1);
    expect(measureStagnation({ ...params, replies, repetitionFull: 1 }).score).toBeCloseTo(1 / 3);
  });

  it('scores 0 with fewer than 2 replies and says why', () => {
    for (const replies of [[], [LOOP]]) {
      const result = measureStagnation({ ...params, replies });
      expect(result).toMatchObject({ score: 0, repetition: 0, novelty: 1 });
      expect(result.reason).toContain('needs at least 2 assistant replies');
    }
  });
});

describe('Stagnation node', () => {
  it('reads only the last `window` assistant replies and ignores user messages', async () => {
    const history = [
      reply('Totally different opening about dragons and thunder over distant peaks.'),
      user('go on'),
      reply(LOOP),
      user('and then?'),
      reply(LOOP),
    ];
    const wide = await run(history, { window: 3, repetitionWeight: 1, churnWeight: 0 });
    expect(wide.output.repetition).toBe(0.5);
    const narrow = await run(history, { window: 2, repetitionWeight: 1, churnWeight: 0 });
    expect(narrow.output).toMatchObject({ repetition: 1, score: 1 });
    expect(narrow.output.reason).toContain('across last 2 replies');
  });

  it('gives score 0 and a reason for a short history instead of throwing', async () => {
    for (const history of [[], [user('hi')], [reply(LOOP)], [user('hi'), reply(LOOP)]]) {
      const { output } = await run(history);
      expect(output).toMatchObject({ score: 0, repetition: 0, novelty: 1 });
      expect(String(output.reason)).toContain('needs at least 2 assistant replies');
    }
  });

  it('skips empty and inactive replies', async () => {
    const { output } = await run([reply(LOOP), reply('   '), reply(LOOP, { inactive: true }), reply(LOOP)]);
    expect(String(output.reason)).toContain('across last 2 replies');
  });

  it('leaves the speaker names of the history out of the churn', async () => {
    const history = [
      reply('Then Mira spoke to Borin.', { name: 'Borin' }),
      reply('Later Mira answered Borin and Ysolde.', { name: 'Borin' }),
    ];
    const { output } = await run(history, { repetitionWeight: 0 });
    // Borin is the speaker; Mira and Ysolde count, Mira was mentioned before.
    expect(output.novelty).toBe(0.5);
  });

  it('is deterministic and writes no state', async () => {
    const history = [reply(LOOP), reply(LOOP)];
    const first = await run(history);
    const second = await run(history);
    expect(second.output).toEqual(first.output);
    expect(first.drawn).toBe(0);
    expect(first.writes).toEqual([]);
  });
});
