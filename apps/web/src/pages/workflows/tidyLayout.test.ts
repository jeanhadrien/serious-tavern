import { describe, expect, it } from 'vitest';
import { tidyLayout, type TidyNode } from './tidyLayout.js';

const node = (id: string, width = 200, height = 100): TidyNode => ({ id, width, height });
const edge = (source: string, target: string) => ({ source, target });

const overlap = (a: TidyNode, b: TidyNode, at: Map<string, { x: number; y: number }>) => {
  const [p, q] = [at.get(a.id)!, at.get(b.id)!];
  return p.x < q.x + b.width && q.x < p.x + a.width && p.y < q.y + b.height && q.y < p.y + a.height;
};

describe('tidyLayout', () => {
  it('lays a chain out left to right, level with each other', () => {
    const at = tidyLayout([node('c'), node('a'), node('b')], [edge('a', 'b'), edge('b', 'c')]);
    expect(at.get('a')!.x).toBeLessThan(at.get('b')!.x);
    expect(at.get('b')!.x).toBeLessThan(at.get('c')!.x);
    expect(at.get('a')!.y).toBe(at.get('b')!.y);
    expect(at.get('b')!.y).toBe(at.get('c')!.y);
  });

  it('leaves room for the width of a node before the next rank', () => {
    const wide = node('a', 500);
    const at = tidyLayout([wide, node('b')], [edge('a', 'b')]);
    expect(at.get('b')!.x).toBeGreaterThan(at.get('a')!.x + 500);
  });

  it('puts siblings of a rank apart, never overlapping', () => {
    const nodes = [node('a'), node('b', 200, 300), node('c'), node('d')];
    const at = tidyLayout(nodes, [edge('a', 'b'), edge('a', 'c'), edge('a', 'd')]);
    for (const [i, first] of nodes.entries())
      for (const second of nodes.slice(i + 1)) expect(overlap(first, second, at)).toBe(false);
  });

  it('places every node, the unconnected ones too', () => {
    const at = tidyLayout([node('a'), node('b'), node('lonely')], [edge('a', 'b')]);
    expect([...at.keys()].sort()).toEqual(['a', 'b', 'lonely']);
    for (const { x, y } of at.values()) expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
  });

  it('ignores edges to nodes it was not given', () => {
    const at = tidyLayout([node('a')], [edge('a', 'ghost'), edge('ghost', 'a')]);
    expect([...at.keys()]).toEqual(['a']);
  });

  it('survives a cycle and a self-loop', () => {
    const at = tidyLayout([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a'), edge('a', 'a')]);
    expect(at.size).toBe(2);
    for (const { x, y } of at.values()) expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
  });

  it('is empty for no nodes', () => {
    expect(tidyLayout([], []).size).toBe(0);
  });
});
