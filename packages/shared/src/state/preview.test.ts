import { describe, expect, it } from 'vitest';
import { WRITE_PREVIEW_LIMIT } from '../api/state.js';
import { previewWrite } from './preview.js';
import type { StateWrite } from './writes.js';

const target = { kind: 'definition' as const, definitionId: 'd', key: 'k' };
const set = (value: unknown): StateWrite => ({ op: 'set', target, nodeId: 'w', value });
const add = (item: { id: string; text: string } & Record<string, unknown>): StateWrite => ({
  op: 'add',
  target,
  nodeId: 'w',
  item,
});
const LONG = 'x'.repeat(WRITE_PREVIEW_LIMIT + 1);

describe('previewWrite', () => {
  it.each<[string, StateWrite]>([
    ['a short text', set('x'.repeat(WRITE_PREVIEW_LIMIT))],
    ['a number', set(4)],
    ['a boolean', set(false)],
    ['null', set(null)],
    ['a small object', set({ a: 1, list: ['b'] })],
    ['an item with short fields', add({ id: 'e:n:1', text: 'hi', level: 2, tag: 'ok' })],
    ['a remove', { op: 'remove', target, nodeId: 'w', itemId: LONG }],
    ['a delete', { op: 'delete', target, nodeId: 'w' }],
  ])('leaves %s as it is', (_, write) => {
    const preview = previewWrite(write);
    expect(preview).toEqual({ write, truncated: false });
    expect(preview.write).toBe(write);
  });

  it('cuts a long text to the limit and says so', () => {
    const preview = previewWrite(set(`${LONG}tail`));
    expect(preview.truncated).toBe(true);
    expect(preview.write).toMatchObject({ op: 'set', value: 'x'.repeat(WRITE_PREVIEW_LIMIT) });
  });

  it('turns a large object into its JSON text, cut to the limit', () => {
    const value = { notes: 'y'.repeat(1000) };
    const preview = previewWrite(set(value));
    expect(preview.truncated).toBe(true);
    expect(preview.write).toMatchObject({ value: JSON.stringify(value).slice(0, WRITE_PREVIEW_LIMIT) });
  });

  it('cuts the long fields of an added item and never its id', () => {
    const id = `e:${'n'.repeat(300)}:1`;
    const preview = previewWrite(add({ id, text: LONG, level: 3, note: 'short' }));
    expect(preview.truncated).toBe(true);
    expect(preview.write).toMatchObject({
      op: 'add',
      item: { id, text: 'x'.repeat(WRITE_PREVIEW_LIMIT), level: 3, note: 'short' },
    });
  });

  it('does not change the stored write', () => {
    const write = set(LONG);
    previewWrite(write);
    expect(write).toMatchObject({ value: LONG });
  });
});
