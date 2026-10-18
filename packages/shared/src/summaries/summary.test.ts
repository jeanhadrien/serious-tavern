import { describe, expect, it } from 'vitest';
import { hashSeed } from '../hash.js';
import { chat, range, summaryOf } from './test-fixtures.js';
import {
  fingerprintMessages,
  indexById,
  readSummaries,
  summarySetNameSchema,
  summaryIsValid,
  type SummaryMessage,
} from './summary.js';

describe('hashSeed', () => {
  it('is pinned (stored fingerprints and replayable seeds depend on it)', () => {
    expect(hashSeed('seed:node')).toMatchInlineSnapshot(`
      [
        1305237123,
        952911825,
        741962247,
        1631085139,
      ]
    `);
  });
});

describe('fingerprintMessages', () => {
  const base: SummaryMessage[] = [
    { id: 'a', role: 'user', content: 'hi' },
    { id: 'b', role: 'assistant', name: 'Mira', content: 'hello' },
  ];
  it('is 32 hex characters and stable', () => {
    expect(fingerprintMessages(base)).toMatch(/^[0-9a-f]{32}$/);
    expect(fingerprintMessages(base)).toBe(fingerprintMessages(structuredClone(base)));
    expect(fingerprintMessages(base)).toMatchInlineSnapshot(`"b843eb3195d28dfd72276f629b6bf593"`);
  });
  it.each<[string, SummaryMessage[]]>([
    ['another content', [base[0]!, { ...base[1]!, content: 'hello!' }]],
    ['another role', [base[0]!, { ...base[1]!, role: 'user' }]],
    ['another name', [base[0]!, { ...base[1]!, name: 'Mirai' }]],
    ['no name', [base[0]!, { id: 'b', role: 'assistant', content: 'hello' }]],
    ['another id', [base[0]!, { ...base[1]!, id: 'c' }]],
    ['another order', [base[1]!, base[0]!]],
    ['a missing message', [base[0]!]],
    ['an extra message', [...base, { id: 'c', role: 'user', content: '' }]],
  ])('changes with %s', (_, other) => {
    expect(fingerprintMessages(other)).not.toBe(fingerprintMessages(base));
  });
  it('ignores fields that are not part of the message text', () => {
    const extra = base.map((m) => ({ ...m, createdAt: 'x', executionId: 'e', reasoning: 'r' }));
    expect(fingerprintMessages(extra)).toBe(fingerprintMessages(base));
  });
  it('cannot confuse two different splits of the same characters', () => {
    const a = [{ id: 'x', role: 'user' as const, content: 'ab' }];
    const b = [{ id: 'xa', role: 'user' as const, content: 'b' }];
    expect(fingerprintMessages(a)).not.toBe(fingerprintMessages(b));
  });
  it('handles an empty list and unicode', () => {
    expect(fingerprintMessages([])).toMatch(/^[0-9a-f]{32}$/);
    expect(fingerprintMessages([{ id: '1', role: 'user', content: '🎲 日本語' }])).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('summaryIsValid', () => {
  const history = chat(10);
  const summary = summaryOf(history, range(3, 6));
  const valid = (messages: SummaryMessage[]) => summaryIsValid(summary, indexById(messages));
  it('is valid for the messages it was made from', () => expect(valid(history)).toBe(true));
  it('stays valid when other messages come, go or change', () => {
    expect(valid([...history, { id: 'm11', role: 'user', content: 'new' }])).toBe(true);
    expect(valid(history.filter((m) => m.id !== 'm9'))).toBe(true);
    expect(valid(history.map((m) => (m.id === 'm9' ? { ...m, content: 'edited' } : m)))).toBe(true);
  });
  it.each<[string, (m: SummaryMessage) => SummaryMessage | undefined]>([
    ['a covered message was edited', (m) => (m.id === 'm4' ? { ...m, content: 'edited' } : m)],
    ['a covered message got a name', (m) => (m.id === 'm4' ? { ...m, name: 'Z' } : m)],
    ['a covered message was deleted', (m) => (m.id === 'm4' ? undefined : m)],
    ['the first covered message was deleted', (m) => (m.id === 'm3' ? undefined : m)],
    ['the last covered message was deleted', (m) => (m.id === 'm6' ? undefined : m)],
  ])('is invalid when %s', (_, change) => {
    expect(valid(history.flatMap((m) => change(m) ?? []))).toBe(false);
  });
});

describe('summarySetNameSchema', () => {
  it.each(['main', 'short', 'detail_2', 'a-b', ' main ', 'A'.repeat(40)])('accepts %j', (name) => {
    expect(summarySetNameSchema.safeParse(name).success).toBe(true);
  });
  it.each(['', '   ', '-x', 'has space', 'a.b', '{{x}}', 'é', 'A'.repeat(41)])('rejects %j', (name) => {
    expect(summarySetNameSchema.safeParse(name).success).toBe(false);
  });
  it('trims', () => expect(summarySetNameSchema.parse(' main ')).toBe('main'));
});

describe('readSummaries', () => {
  const good = summaryOf(chat(4), ['m1', 'm2']);
  it.each<[string, unknown, unknown]>([
    ['nothing stored', undefined, {}],
    ['null', null, {}],
    ['a list', [good], {}],
    ['a string', 'x', {}],
    ['a set that is not a list', { main: 'x' }, {}],
    ['a set with only garbage', { main: [1, null, {}, { id: 'x' }] }, {}],
    ['garbage next to a good summary', { main: [1, good, { id: 'x' }] }, { main: [good] }],
    ['two sets, one bad', { a: [good], b: 5 }, { a: [good] }],
    ['unknown fields on a summary', { main: [{ ...good, extra: 1 }] }, { main: [{ ...good, extra: 1 }] }],
    ['an empty messageIds list', { main: [{ ...good, messageIds: [] }] }, {}],
  ])('%s', (_, stored, expected) => {
    expect(readSummaries(stored)).toEqual(expected);
  });
  it('keeps a set called __proto__ as an own key', () => {
    const stored = JSON.parse(`{"__proto__":[${JSON.stringify(good)}]}`);
    const read = readSummaries(stored);
    expect(Object.keys(read)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(read)).toBe(Object.prototype);
  });
});
