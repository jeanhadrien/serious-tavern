import { describe, expect, it } from 'vitest';
import { commitItemLinks } from './commit.js';
import { fingerprintMessages } from './fingerprint.js';
import { chat, linkedItem, range, withEdit } from './test-fixtures.js';
import { addWrite, nodeAddWrite, removeWrite, setWrite } from '../state/test-fixtures.js';
import type { StateWrite } from '../state/writes.js';

const history = chat(30);
const label = () => 'memory.summaries';
const commit = (writes: StateWrite[], messages = history) => commitItemLinks(writes, messages, label);
const link = (ids: string[], fingerprint?: string) => ({ ids, ...(fingerprint === undefined ? {} : { fingerprint }) });
const linked = (ids: string[], fingerprint?: string, text = 'The party met Borin at the inn.') =>
  addWrite('summaries', { id: 'e:n:1', text, messages: link(ids, fingerprint) });

describe('commitItemLinks', () => {
  it('keeps a write whose fingerprint still matches', () => {
    const write = addWrite('summaries', linkedItem(history, range(1, 20), 'e:n:1'));
    const result = commit([write]);
    expect(result.writes).toEqual([write]);
    expect(result.warnings).toEqual([]);
  });

  it('takes the fingerprint from the messages now when the write has none', () => {
    const result = commit([linked(['m3', 'm4'])]);
    expect(result.warnings).toEqual([]);
    expect(result.writes[0]).toMatchObject({
      item: { messages: { ids: ['m3', 'm4'], fingerprint: fingerprintMessages([history[2]!, history[3]!]) } },
    });
  });

  it('drops a write when a linked message was edited since the fingerprint was taken', () => {
    const write = addWrite('summaries', linkedItem(history, range(1, 20), 'e:n:1'));
    const result = commit([write], withEdit(history, 'm7', 'edited'));
    expect(result.writes).toEqual([]);
    expect(result.warnings).toEqual([
      'memory.summaries: the item "summary of m1,m2,m3,m4,m5,m6,m7,m8,m9,m1…" was not saved: a message it links to was edited while it was being written.',
    ]);
  });

  it('drops a write when a linked message was deleted, with or without a fingerprint', () => {
    const gone = withEdit(history, 'm7');
    for (const write of [linked(range(5, 9)), addWrite('summaries', linkedItem(history, range(5, 9), 'e:n:1'))]) {
      const result = commit([write], gone);
      expect(result.writes).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('a message it links to is not in the chat any more');
    }
  });

  it('drops a write that links an id the chat never had', () => {
    expect(commit([linked(['nope'])]).warnings[0]).toContain('is not in the chat any more');
  });

  it('judges each write on its own and keeps the order of what it keeps', () => {
    const ok1 = linked(['m1', 'm2'], undefined, 'one');
    const bad = linked(['zz'], undefined, 'two');
    const plain = addWrite('summaries', { id: 'e:n:3', text: 'no link' });
    const set = setWrite('mood', 'tense');
    const remove = removeWrite('summaries', 'old');
    const ok2 = linked(['m3'], undefined, 'three');
    const result = commit([ok1, bad, plain, set, remove, ok2]);
    expect(result.writes.map((write) => write.op)).toEqual(['add', 'add', 'set', 'remove', 'add']);
    expect(result.writes.map((write) => (write.op === 'add' ? write.item.text : write.op))).toEqual([
      'one',
      'no link',
      'set',
      'remove',
      'three',
    ]);
    expect(result.warnings).toHaveLength(1);
  });

  it('leaves writes without a link exactly as they are (same objects)', () => {
    const writes = [
      addWrite('summaries', { id: 'a', text: 'x' }),
      setWrite('mood', 'tense'),
      nodeAddWrite('draw', 'draws', { id: 'b', text: 'y' }),
    ];
    const result = commit(writes);
    expect(result.writes[0]).toBe(writes[0]);
    expect(result.writes[1]).toBe(writes[1]);
    expect(result.writes[2]).toBe(writes[2]);
  });

  it('does not pair with removes: a remove of the old item is not needed or checked', () => {
    const write = addWrite('summaries', linkedItem(history, range(1, 4), 'e:n:1'));
    const result = commit([removeWrite('summaries', 'old'), write]);
    expect(result.writes).toHaveLength(2);
  });

  it('also checks links on a node key', () => {
    const write = nodeAddWrite('n1', 'facts', { id: 'f', text: 'fact', messages: link(['zz']) });
    expect(commit([write]).writes).toEqual([]);
  });

  it('names the key and cuts a long text in the warning', () => {
    const long = 'x'.repeat(200);
    const result = commitItemLinks([linked(['zz'], undefined, long)], history, () => 'scene.facts');
    expect(result.warnings[0]).toBe(
      `scene.facts: the item "${'x'.repeat(40)}…" was not saved: a message it links to is not in the chat any more.`,
    );
  });

  it('collapses whitespace in the excerpt', () => {
    expect(commit([linked(['zz'], undefined, '  a\n\n b ')]).warnings[0]).toContain('"a b"');
  });

  it('does not change its input', () => {
    const write = linked(['m1']);
    const before = structuredClone(write);
    commit([write]);
    expect(write).toEqual(before);
  });
});
