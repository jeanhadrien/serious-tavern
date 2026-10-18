import { describe, expect, it } from 'vitest';
import { indexById, type LinkMessage } from './fingerprint.js';
import { linkStatus, type LinkStatus } from './status.js';
import { chat, linkTo, range, withEdit } from './test-fixtures.js';

describe('linkStatus', () => {
  const history = chat(10);
  const link = linkTo(history, range(3, 6));
  const status = (messages: LinkMessage[], over = link) => linkStatus(over, indexById(messages));

  it.each<[string, LinkMessage[], LinkStatus]>([
    ['the messages it was made from', history, 'intact'],
    [
      'messages around it added, removed or edited',
      [...history.filter((m) => m.id !== 'm9'), ...chat(2).map((m) => ({ ...m, id: `n${m.id}` }))],
      'intact',
    ],
    ['an edited linked message', withEdit(history, 'm4', 'edited'), 'changed'],
    ['a renamed linked message', history.map((m) => (m.id === 'm4' ? { ...m, name: 'Z' } : m)), 'changed'],
    ['a deleted first message', withEdit(history, 'm3'), 'partial'],
    ['a deleted middle message', withEdit(history, 'm4'), 'partial'],
    ['a deleted last message', withEdit(history, 'm6'), 'partial'],
    ['a deleted message and an edited one', withEdit(withEdit(history, 'm4'), 'm5', 'edited'), 'partial'],
    ['every linked message deleted', history.filter((m) => !range(3, 6).includes(m.id)), 'gone'],
    ['an empty chat', [], 'gone'],
  ])('is %s -> %s', (_, messages, expected) => {
    expect(status(messages)).toBe(expected);
  });

  it('reverting an edit makes the link intact again', () => {
    expect(status(withEdit(history, 'm4', 'edited'))).toBe('changed');
    expect(status(history)).toBe('intact');
  });

  it('cannot verify a link without a fingerprint, so it is never intact', () => {
    expect(status(history, { ids: range(3, 6) })).toBe('changed');
    expect(status(withEdit(history, 'm4'), { ids: range(3, 6) })).toBe('partial');
  });

  it('judges a single-message link', () => {
    const one = linkTo(history, ['m2']);
    expect(status(history, one)).toBe('intact');
    expect(status(withEdit(history, 'm2', 'x'), one)).toBe('changed');
    expect(status(withEdit(history, 'm2'), one)).toBe('gone');
  });
});
