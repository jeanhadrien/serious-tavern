import { describe, expect, it } from 'vitest';
import { layoutNodes } from './node-layout.js';

const bare = (...ids: string[]) => ids.map((id) => ({ id }));
const link = (source: string, target: string) => ({ source, target });
const at = (nodes: { id: string; position: { x: number; y: number } }[]) =>
  Object.fromEntries(nodes.map((node) => [node.id, [node.position.x, node.position.y]]));

describe('layoutNodes', () => {
  it('lays a chain out left to right, one column per step', () => {
    const laid = layoutNodes(bare('a', 'b', 'c'), [link('a', 'b'), link('b', 'c')]);
    expect(at(laid)).toEqual({ a: [0, 0], b: [320, 0], c: [640, 0] });
  });

  it('puts a node after its deepest feeder and stacks a column in the order given', () => {
    // a -> b -> d and a -> d, plus an unconnected c: d waits for b, c is a source like a.
    const laid = layoutNodes(bare('a', 'b', 'c', 'd'), [link('a', 'b'), link('b', 'd'), link('a', 'd')]);
    expect(at(laid)).toEqual({ a: [0, 0], c: [0, 240], b: [320, 0], d: [640, 0] });
  });

  it('orders a column by the rows of its feeders, so connections do not cross', () => {
    // x is listed first but is fed by the lower source.
    const laid = layoutNodes(bare('top', 'low', 'x', 'y'), [link('low', 'x'), link('top', 'y')]);
    expect(at(laid)).toMatchObject({ y: [320, 0], x: [320, 240] });
  });

  it('keeps the input order and the nodes it was given, whatever it adds', () => {
    const nodes = [{ id: 'a', type: 'chat-input', config: {} }, { id: 'b' }];
    const laid = layoutNodes(nodes, [link('a', 'b')]);
    expect(laid.map((node) => node.id)).toEqual(['a', 'b']);
    expect(laid[0]).toMatchObject({ type: 'chat-input', config: {} });
  });

  it('leaves positioned nodes alone and starts the rest below them, in line with the leftmost', () => {
    const nodes = [
      { id: 'kept', position: { x: 50, y: 100 } },
      { id: 'far', position: { x: 900, y: 300 } },
      ...bare('new'),
    ];
    const laid = layoutNodes(nodes, []);
    expect(at(laid)).toEqual({ kept: [50, 100], far: [900, 300], new: [50, 540] });
  });

  it('lays the loose nodes out as their own graph, ignoring edges to positioned ones', () => {
    const nodes = [{ id: 'placed', position: { x: 0, y: 0 } }, ...bare('a', 'b')];
    const laid = layoutNodes(nodes, [link('placed', 'a'), link('a', 'b')]);
    expect(at(laid)).toMatchObject({ a: [0, 240], b: [320, 240] });
  });

  it('returns the nodes as they are when all have a position', () => {
    const nodes = [{ id: 'a', position: { x: 1, y: 2 } }];
    expect(layoutNodes(nodes, [])).toEqual(nodes);
  });

  it('copes with loops, self connections and edges to unknown nodes', () => {
    const laid = layoutNodes(bare('a', 'b', 'c'), [link('a', 'b'), link('b', 'a'), link('c', 'c'), link('c', 'ghost')]);
    expect(at(laid)).toEqual({ a: [0, 0], c: [0, 240], b: [320, 0] });
  });

  it('is deterministic and does not mutate its input', () => {
    const nodes = bare('a', 'b');
    const edges = [link('a', 'b')];
    expect(layoutNodes(nodes, edges)).toEqual(layoutNodes(nodes, edges));
    expect(nodes).toEqual(bare('a', 'b'));
  });
});
