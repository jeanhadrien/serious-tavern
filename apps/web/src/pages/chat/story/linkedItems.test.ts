import { describe, expect, it } from 'vitest';
import type { ItemLinkView } from '@st/shared';
import { groupLinked, itemLinkOf, linkLabel } from './linkedItems.js';

const view = (patch: Partial<ItemLinkView> = {}): ItemLinkView => ({
  status: 'intact',
  replaced: false,
  count: 2,
  missing: 0,
  firstIndex: 1,
  lastIndex: 2,
  firstMessageId: 'a',
  lastMessageId: 'b',
  messageIds: ['a', 'b'],
  ...patch,
});

describe('linkLabel', () => {
  it.each<[string, Partial<ItemLinkView>, string]>([
    ['a range', { count: 20, firstIndex: 21, lastIndex: 40 }, 'messages 21–40 (20)'],
    ['one message', { count: 1, firstIndex: 7, lastIndex: 7 }, 'message 7'],
    ['a pair at the start', {}, 'messages 1–2 (2)'],
    ['some deleted', { count: 20, missing: 2, firstIndex: 21, lastIndex: 40 }, 'messages 21–40 (18 of 20 left)'],
    ['one of two left', { count: 2, missing: 1, firstIndex: 5, lastIndex: 5 }, 'message 5 (1 of 2 left)'],
    ['all deleted', { count: 20, missing: 20, firstIndex: undefined, lastIndex: undefined }, 'all 20 messages deleted'],
    [
      'its only message deleted',
      { count: 1, missing: 1, firstIndex: undefined, lastIndex: undefined },
      'its message was deleted',
    ],
  ])('%s', (_name, patch, expected) => {
    expect(linkLabel(view(patch))).toBe(expected);
  });
});

describe('itemLinkOf', () => {
  it('reads the view link and nothing else', () => {
    expect(itemLinkOf({ id: 'a', text: 't', link: view() })).toEqual(view());
    expect(itemLinkOf({ id: 'a', text: 't' })).toBeUndefined();
    expect(itemLinkOf({ id: 'a', text: 't', link: { status: 'weird' } })).toBeUndefined();
    expect(itemLinkOf('text')).toBeUndefined();
    expect(itemLinkOf(null)).toBeUndefined();
  });
});

describe('groupLinked', () => {
  const item = (id: string, patch: Partial<ItemLinkView>) => ({ id, link: view(patch) });
  const ids = (items: { id: string }[]) => items.map((entry) => entry.id);

  it('puts intact items in chat order, whatever the order they were written in', () => {
    const items = [
      item('late', { firstIndex: 41, messageIds: ['x'] }),
      item('early', { firstIndex: 1, messageIds: ['y'] }),
      item('mid', { firstIndex: 21, messageIds: ['z'] }),
    ];
    expect(ids(groupLinked(items).used)).toEqual(['early', 'mid', 'late']);
  });

  it('keeps the newest first when two items start at the same message', () => {
    const items = [item('newer', { messageIds: ['a'] }), item('older', { messageIds: ['b'] })];
    expect(ids(groupLinked(items).used)).toEqual(['newer', 'older']);
  });

  it('hides an intact copy of an earlier item (an edit that was reverted)', () => {
    const items = [item('redone', { messageIds: ['a', 'b'] }), item('first', { messageIds: ['a', 'b'] })];
    const groups = groupLinked(items);
    expect(ids(groups.used)).toEqual(['redone']);
    expect(ids(groups.hidden)).toEqual(['first']);
  });

  it('separates broken items waiting to be redone from the ones an intact item replaced', () => {
    const items = [
      item('new', { firstIndex: 1, messageIds: ['a', 'b'] }),
      item('old', { status: 'changed', replaced: true, firstIndex: 1, messageIds: ['a', 'b'] }),
      item('waiting', { status: 'partial', firstIndex: 21, messageIds: ['c'] }),
      item('empty', { status: 'gone', firstIndex: undefined, messageIds: [] }),
    ];
    const groups = groupLinked(items);
    expect(ids(groups.used)).toEqual(['new']);
    expect(ids(groups.broken)).toEqual(['waiting', 'empty']);
    expect(ids(groups.hidden)).toEqual(['old']);
  });

  it('handles no items', () => {
    expect(groupLinked([])).toEqual({ used: [], broken: [], hidden: [] });
  });
});
