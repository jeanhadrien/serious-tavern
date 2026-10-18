import { describe, expect, it } from 'vitest';
import { withItemLinks } from './analyze.js';
import { linkedInChatOrder } from './order.js';
import { chat, linkedItem, range, withEdit } from './test-fixtures.js';

const history = chat(60);
const ids = (value: unknown[]) => value.map((item) => (item as { id: string }).id);
const order = (items: ReturnType<typeof linkedItem>[], messages = history) =>
  ids(linkedInChatOrder(withItemLinks(items, messages)));

describe('linkedInChatOrder', () => {
  const s1 = linkedItem(history, range(1, 20), 's1');
  const s2 = linkedItem(history, range(21, 40), 's2');
  const s3 = linkedItem(history, range(41, 60), 's3');

  it('sorts by the first linked message, whatever order the collection holds them in', () => {
    expect(order([s3, s1, s2])).toEqual(['s1', 's2', 's3']);
    expect(order([s1, s2, s3])).toEqual(['s1', 's2', 's3']);
  });

  it('puts a re-summary of an earlier chunk where its messages are, not where it was written', () => {
    const redone = linkedItem(history, range(21, 40), 's2b');
    // Newest first: the re-summary of 21-40 was written after the summary of 41-60.
    expect(order([redone, s3, s1])).toEqual(['s1', 's2b', 's3']);
  });

  it('uses only intact items', () => {
    const edited = withEdit(history, 'm25', 'edited');
    expect(order([s3, s2, s1], edited)).toEqual(['s1', 's3']);
    expect(order([s3, s2, s1], withEdit(history, 'm25'))).toEqual(['s1', 's3']);
    expect(order([s3, s2, s1], history.slice(20))).toEqual(['s2', 's3']);
  });

  it('keeps one of two items that link the same messages (an edit that was reverted), the newer first', () => {
    const twin = linkedItem(history, range(21, 40), 's2-new');
    expect(order([twin, s3, s2, s1])).toEqual(['s1', 's2-new', 's3']);
  });

  it('keeps items that overlap but are not the same', () => {
    const overlap = linkedItem(history, range(15, 25), 'mid');
    expect(order([s2, overlap, s1])).toEqual(['s1', 'mid', 's2']);
  });

  it('keeps the collection order for items starting at the same message', () => {
    const shorter = linkedItem(history, range(1, 10), 'short');
    expect(order([shorter, s1])).toEqual(['short', 's1']);
    expect(order([s1, shorter])).toEqual(['s1', 'short']);
  });

  it('skips items with no link, a hand-made link, no position or no ids', () => {
    const plain = { id: 'plain', text: 'x' };
    const fake = { id: 'fake', text: 'x', link: { status: 'intact', ids: ['m1'] } };
    const noIds = { id: 'noids', text: 'x', link: { status: 'intact', first: 1 } };
    expect(ids(linkedInChatOrder([plain, fake, noIds, ...withItemLinks([s2], history)]))).toEqual(['s2']);
  });

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['null', null],
    ['text', 'summaries'],
    ['a number', 3],
    ['an object', { 0: { link: { status: 'intact', ids: ['m1'], first: 1 } } }],
    ['an empty list', []],
    ['a list of junk', [1, null, 'x', [], { link: 5 }]],
  ])('gives an empty list for %s', (_, value) => {
    expect(linkedInChatOrder(value)).toEqual([]);
  });

  it('returns the items themselves', () => {
    const [item] = withItemLinks([s1], history);
    expect(linkedInChatOrder([item])[0]).toBe(item);
  });
});
