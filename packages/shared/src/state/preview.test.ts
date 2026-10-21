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

  it('keeps an item that links to messages whole: its text and its link', () => {
    const messages = {
      ids: Array.from({ length: 30 }, (_, index) => `m-${index}-${'i'.repeat(36)}`),
      fingerprint: 'f'.repeat(32),
    };
    const write = add({ id: 'e:n:1', text: LONG.repeat(5), note: LONG, messages });
    const preview = previewWrite(write);
    expect(preview).toEqual({ write, truncated: false });
    expect(preview.write).toBe(write);
  });

  it('still cuts an item whose link is not there', () => {
    expect(previewWrite(add({ id: 'e:n:1', text: LONG })).truncated).toBe(true);
  });

  it('cuts the long text and field values of an item update and never its item id', () => {
    const update: StateWrite = {
      op: 'update',
      target,
      nodeId: 'w',
      itemId: LONG,
      text: LONG,
      fields: { note: LONG, level: 3 },
    };
    const cut = 'x'.repeat(WRITE_PREVIEW_LIMIT);
    expect(previewWrite(update)).toEqual({
      write: { ...update, text: cut, fields: { note: cut, level: 3 } },
      truncated: true,
    });
    const short: StateWrite = { op: 'update', target, nodeId: 'w', itemId: 'i', fields: { level: 3 } };
    expect(previewWrite(short)).toEqual({ write: short, truncated: false });
  });

  it('does not change the stored write', () => {
    const write = set(LONG);
    previewWrite(write);
    expect(write).toMatchObject({ value: LONG });
  });
});
