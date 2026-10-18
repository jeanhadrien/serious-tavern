import { describe, expect, it } from 'vitest';
import { hashSeed } from '../hash.js';
import { fingerprintMessages, indexById, type LinkMessage } from './fingerprint.js';

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
  const base: LinkMessage[] = [
    { id: 'a', role: 'user', content: 'hi' },
    { id: 'b', role: 'assistant', name: 'Mira', content: 'hello' },
  ];
  it('is 32 hex characters and stable', () => {
    expect(fingerprintMessages(base)).toMatch(/^[0-9a-f]{32}$/);
    expect(fingerprintMessages(base)).toBe(fingerprintMessages(structuredClone(base)));
    expect(fingerprintMessages(base)).toMatchInlineSnapshot(`"b843eb3195d28dfd72276f629b6bf593"`);
  });
  it.each<[string, LinkMessage[]]>([
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

describe('indexById', () => {
  it('maps ids to their messages', () => {
    const messages: LinkMessage[] = [
      { id: 'a', role: 'user', content: 'x' },
      { id: 'b', role: 'assistant', content: 'y' },
    ];
    const index = indexById(messages);
    expect(index.get('b')).toBe(messages[1]);
    expect(index.has('c')).toBe(false);
  });
});
