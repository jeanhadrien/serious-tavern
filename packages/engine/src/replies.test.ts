import { describe, expect, it } from 'vitest';
import type { Workflow } from '@st/shared';
import { orderOutputs } from './replies.js';

type Case = {
  name: string;
  /** Plain nodes by id (non-outputs). */
  nodes: string[];
  /** Chat Outputs with their `order` config. */
  outputs: Record<string, number>;
  /** [source, target] pairs. */
  edges: [string, string][];
  expected: string[];
};

const cases: Case[] = [
  {
    name: 'puts a shared-upstream dependent after its prerequisite, whatever the order config',
    nodes: ['A', 'B', 'C'],
    outputs: { foo: 50, bar: 30, bazz: 0 },
    edges: [
      ['A', 'foo'],
      ['B', 'bar'],
      ['A', 'bazz'],
      ['C', 'bazz'],
    ],
    expected: ['bar', 'foo', 'bazz'],
  },
  {
    name: 'orders an LLM chain by dependency with no config',
    nodes: ['llm1', 'llm2'],
    outputs: { out2: 0, out1: 0 },
    edges: [
      ['llm1', 'out1'],
      ['llm1', 'llm2'],
      ['llm2', 'out2'],
    ],
    expected: ['out1', 'out2'],
  },
  {
    name: 'orders fully parallel outputs by order then id',
    nodes: ['A', 'B', 'C'],
    outputs: { c: 0, b: 1, a: 1 },
    edges: [
      ['A', 'a'],
      ['B', 'b'],
      ['C', 'c'],
    ],
    expected: ['c', 'a', 'b'],
  },
  {
    name: 'treats identical upstream sets as independent (order then id)',
    nodes: ['A'],
    outputs: { z: -1, b: 2, a: 2 },
    edges: [
      ['A', 'z'],
      ['A', 'b'],
      ['A', 'a'],
    ],
    expected: ['z', 'a', 'b'],
  },
  {
    name: 'never lets an explicit order put a dependent output ahead of its dependency',
    nodes: ['llm'],
    outputs: { early: 100, late: -100 },
    edges: [
      ['llm', 'early'],
      ['early', 'late'],
    ],
    expected: ['early', 'late'],
  },
];

describe('orderOutputs', () => {
  it.each(cases)('$name', ({ nodes, outputs, edges, expected }) => {
    const ids = [...nodes, ...Object.keys(outputs)];
    const upstream = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const [source, target] of edges) upstream.get(target)!.push(source);
    const workflow = {
      id: 'workflow',
      name: 'Order',
      createdAt: '',
      updatedAt: '',
      edges: [],
      nodes: ids.map((id) => ({
        id,
        type: id in outputs ? 'chat-output' : 'llm',
        config: id in outputs ? { order: outputs[id] } : {},
        position: { x: 0, y: 0 },
      })),
    } as Workflow;
    expect(orderOutputs(workflow, upstream, new Set(Object.keys(outputs)))).toEqual(expected);
  });

  it('ranks only the given outputs', () => {
    const workflow = {
      nodes: ['a', 'b'].map((id) => ({ id, type: 'chat-output', config: {}, position: { x: 0, y: 0 } })),
    } as Workflow;
    expect(orderOutputs(workflow, new Map(), new Set(['b']))).toEqual(['b']);
  });
});
