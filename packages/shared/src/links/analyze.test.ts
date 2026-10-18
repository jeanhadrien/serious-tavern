import { describe, expect, it } from 'vitest';
import { analyzeLinks, withItemLinks } from './analyze.js';
import { chat, linkedItem, range, withEdit } from './test-fixtures.js';

const history = chat(40);
const first = linkedItem(history, range(1, 20), 'a');
const second = linkedItem(history, range(21, 40), 'b');

describe('analyzeLinks', () => {
  it('describes every linked item in the items order, leaving out items without a link', () => {
    const plain = { id: 'plain', text: 'no link' };
    const entries = analyzeLinks([second, plain, first], history);
    expect(entries.map(({ item }) => item.id)).toEqual(['b', 'a']);
    expect(entries[0]).toMatchObject({
      status: 'intact',
      first: 21,
      last: 40,
      firstId: 'm21',
      lastId: 'm40',
      replaced: false,
    });
    expect(entries[0]!.survivors).toEqual(range(21, 40));
  });

  it('counts positions among the given history, not the ids', () => {
    const shifted = history.slice(5);
    const [entry] = analyzeLinks([first], shifted);
    expect(entry).toMatchObject({ status: 'partial', first: 1, last: 15, firstId: 'm6', lastId: 'm20' });
    expect(entry!.survivors).toEqual(range(6, 20));
  });

  it('gives a gone item no positions and does not call it replaced', () => {
    const [entry] = analyzeLinks([first], history.slice(20));
    expect(entry).toMatchObject({ status: 'gone', survivors: [], replaced: false });
    expect(entry).not.toHaveProperty('first');
    expect(entry).not.toHaveProperty('firstId');
  });

  it('survives a deleted message: the rest are survivors and positions follow the chat', () => {
    const [entry] = analyzeLinks([first], withEdit(history, 'm1'));
    expect(entry).toMatchObject({ status: 'partial', first: 1, firstId: 'm2', last: 19, lastId: 'm20' });
    expect(entry!.survivors).toHaveLength(19);
  });

  describe('replaced', () => {
    const edited = withEdit(history, 'm5', 'edited');
    const fresh = linkedItem(edited, range(1, 20), 'a2');
    const replacedOf = (items: ReturnType<typeof linkedItem>[], messages = edited) =>
      Object.fromEntries(analyzeLinks(items, messages).map(({ item, replaced }) => [item.id, replaced]));

    it('is true for a broken item whose messages an intact item links again', () => {
      expect(replacedOf([fresh, first])).toEqual({ a2: false, a: true });
    });

    it('is false while no intact item covers it, and for intact items', () => {
      expect(replacedOf([first])).toEqual({ a: false });
      expect(replacedOf([second, first])).toEqual({ b: false, a: false });
    });

    it('needs every surviving message covered, possibly by several intact items', () => {
      const half = linkedItem(edited, range(1, 10), 'h1');
      const rest = linkedItem(edited, range(11, 20), 'h2');
      expect(replacedOf([half, first])).toEqual({ h1: false, a: false });
      expect(replacedOf([rest, half, first])).toEqual({ h2: false, h1: false, a: true });
    });

    it('covers only the survivors of a partly deleted item', () => {
      const gone5 = withEdit(history, 'm5');
      const survivors = linkedItem(
        gone5,
        range(1, 20).filter((id) => id !== 'm5'),
        's',
      );
      expect(replacedOf([survivors, first], gone5)).toEqual({ s: false, a: true });
    });

    it('does not count a broken replacement as covering', () => {
      const broken = linkedItem(history, range(1, 20), 'x');
      expect(replacedOf([broken, first], withEdit(history, 'm5', 'edited'))).toEqual({ x: false, a: false });
    });
  });
});

describe('withItemLinks', () => {
  it('adds a link view to items that have messages and leaves the others (and the originals) alone', () => {
    const plain = { id: 'p', text: 'plain' };
    const edited = withEdit(history, 'm25', 'edited');
    const out = withItemLinks([first, second, plain], edited);
    expect(out[0]).toEqual({ ...first, link: { status: 'intact', ids: range(1, 20), first: 1 } });
    expect(out[1]).toMatchObject({ link: { status: 'changed', ids: range(21, 40), first: 21 } });
    expect(out[2]).toBe(plain);
    expect(first).not.toHaveProperty('link');
  });

  it('reports a gone item without a position', () => {
    const [out] = withItemLinks([first], []);
    expect(out!.link).toEqual({ status: 'gone', ids: range(1, 20) });
  });
});
