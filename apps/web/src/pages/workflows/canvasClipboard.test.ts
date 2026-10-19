import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { NodeTypeDescriptor } from '@st/shared';
import { CLIPBOARD_KIND, PASTE_OFFSET, parseClipboard, pasteNodes, serializeSelection } from './canvasClipboard.js';
import type { CanvasNode } from './model.js';

const descriptor = (type: string, label: string): NodeTypeDescriptor => ({
  type,
  label,
  description: '',
  category: 'Test',
  dynamicPorts: false,
  inputs: [],
  outputs: [],
  configSchema: {},
  defaultConfig: {},
});
const types = [
  descriptor('chat-input', 'Chat Input'),
  descriptor('llm', 'LLM'),
  descriptor('chat-output', 'Chat Output'),
];
const node = (id: string, type: string, extra: Partial<CanvasNode> = {}, config: CanvasNode['data']['config'] = {}) =>
  ({
    id,
    type: 'workflow',
    position: { x: 10, y: 20 },
    data: { descriptor: types.find((t) => t.type === type) ?? descriptor(type, type), config, name: type },
    ...extra,
  }) as CanvasNode;
const edge = (id: string, source: string, target: string, extra: Partial<Edge> = {}): Edge => ({
  id,
  source,
  sourceHandle: 'out',
  target,
  targetHandle: 'in',
  ...extra,
});
const payloadOf = (nodes: unknown[], edges: unknown[] = []) =>
  JSON.stringify({ kind: CLIPBOARD_KIND, version: 1, nodes, edges });
const goodNode = { id: 'a', type: 'llm', config: { model: 'x' }, position: { x: 1, y: 2 } };

describe('serializeSelection', () => {
  const nodes = [
    node('a', 'llm', { selected: true }, { model: 'm' }),
    node('b', 'chat-output', { selected: true }),
    node('c', 'llm'),
  ];
  const edges = [edge('e1', 'a', 'b'), edge('e2', 'a', 'c'), edge('e3', 'c', 'b')];

  it('keeps the selected nodes and only the edges with both ends selected', () => {
    const payload = parseClipboard(serializeSelection(nodes, edges));
    expect(payload?.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(payload?.nodes[0]).toMatchObject({ type: 'llm', config: { model: 'm' }, position: { x: 10, y: 20 } });
    expect(payload?.edges).toEqual([{ source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'in' }]);
  });

  it('does not depend on whether the edge itself is selected', () => {
    const payload = parseClipboard(serializeSelection(nodes, [edge('e1', 'a', 'b', { selected: false })]));
    expect(payload?.edges).toHaveLength(1);
  });
});

describe('parseClipboard', () => {
  it.each([
    ['ordinary text', 'hello'],
    ['empty text', ''],
    ['JSON of another kind', JSON.stringify({ kind: 'other', version: 1, nodes: [goodNode], edges: [] })],
    ['another version', JSON.stringify({ kind: CLIPBOARD_KIND, version: 2, nodes: [goodNode], edges: [] })],
    ['an array', '[]'],
    ['no nodes', payloadOf([])],
    ['nodes that are not a list', JSON.stringify({ kind: CLIPBOARD_KIND, version: 1, nodes: {}, edges: [] })],
    ['a node without a type', payloadOf([{ ...goodNode, type: undefined }])],
    ['a node without a config', payloadOf([{ ...goodNode, config: undefined }])],
    ['a node with a bad position', payloadOf([{ ...goodNode, position: { x: 'a', y: 2 } }])],
    ['an edge with a missing handle', payloadOf([goodNode], [{ source: 'a', target: 'a', sourceHandle: 'x' }])],
    ['an edge that is not an object', payloadOf([goodNode], ['a'])],
  ])('ignores %s', (_name, text) => {
    expect(parseClipboard(text)).toBeUndefined();
  });

  it('accepts a well-formed payload, with or without a name', () => {
    expect(parseClipboard(payloadOf([goodNode, { ...goodNode, id: 'b', name: 'LLM #2 (llm)' }]))?.nodes).toHaveLength(
      2,
    );
  });
});

describe('pasteNodes', () => {
  const payload = (nodes: unknown[], edges: unknown[] = []) => {
    const parsed = parseClipboard(payloadOf(nodes, edges));
    if (!parsed) throw new Error('bad test payload');
    return parsed;
  };
  const two = payload(
    [goodNode, { id: 'b', type: 'chat-output', config: {}, position: { x: 100, y: 2 } }],
    [{ source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'in' }],
  );

  it('makes new ids, remaps the edges and offsets the positions', () => {
    const result = pasteNodes(two, { types, existing: [], offset: PASTE_OFFSET });
    expect(result.skipped).toEqual([]);
    expect(result.nodes.map((n) => n.position)).toEqual([
      { x: 1 + PASTE_OFFSET, y: 2 + PASTE_OFFSET },
      { x: 100 + PASTE_OFFSET, y: 2 + PASTE_OFFSET },
    ]);
    const [llm, output] = result.nodes;
    expect([llm?.id, output?.id]).not.toContain('a');
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      source: llm?.id,
      target: output?.id,
      sourceHandle: 'out',
      targetHandle: 'in',
    });
    expect(result.edges[0]?.id).not.toBe('');
    expect(new Set([...result.nodes.map((n) => n.id), result.edges[0]?.id]).size).toBe(3);
  });

  it('selects what it adds', () => {
    const result = pasteNodes(two, { types, existing: [], offset: 40 });
    expect(result.nodes.every((n) => n.selected)).toBe(true);
    expect(result.edges.every((e) => e.selected)).toBe(true);
  });

  it('copies each config so the pasted node shares nothing with the payload', () => {
    const nested = payload([{ ...goodNode, config: { list: [{ a: 1 }] } }]);
    const result = pasteNodes(nested, { types, existing: [], offset: 0 });
    const config = result.nodes[0]?.data.config as { list: { a: number }[] };
    expect(config).toEqual({ list: [{ a: 1 }] });
    const original = nested.nodes[0]?.config.list;
    expect(config.list).not.toBe(original);
  });

  it('numbers the new nodes after the ones already on the canvas', () => {
    const result = pasteNodes(two, { types, existing: [node('x', 'llm'), node('y', 'llm')], offset: 40 });
    expect(result.nodes.map((n) => n.data.name)).toEqual(['LLM #3 (llm)', 'Chat Output #1 (chat-output)']);
  });

  it('uses the known descriptor of the type, not anything from the payload', () => {
    const result = pasteNodes(two, { types, existing: [], offset: 0 });
    expect(result.nodes[0]?.data.descriptor).toBe(types[1]);
  });

  it('skips unknown types and the edges that lose an end', () => {
    const result = pasteNodes(
      payload(
        [goodNode, { ...goodNode, id: 'u', type: 'mystery' }],
        [{ source: 'a', sourceHandle: 'out', target: 'u', targetHandle: 'in' }],
      ),
      { types, existing: [], offset: 0 },
    );
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toEqual([]);
    expect(result.skipped).toEqual(['Unknown node type "mystery" was not pasted']);
  });

  it('skips a Chat Input when the canvas has one, and pastes it when it has none', () => {
    const input = payload([{ id: 'i', type: 'chat-input', config: {}, position: { x: 0, y: 0 } }, goodNode]);
    const refused = pasteNodes(input, { types, existing: [node('x', 'chat-input')], offset: 0 });
    expect(refused.nodes.map((n) => n.data.descriptor.type)).toEqual(['llm']);
    expect(refused.skipped).toEqual(['Chat Input was not pasted: a workflow has exactly one']);
    const allowed = pasteNodes(input, { types, existing: [node('x', 'llm')], offset: 0 });
    expect(allowed.nodes.map((n) => n.data.descriptor.type)).toEqual(['chat-input', 'llm']);
    expect(allowed.skipped).toEqual([]);
  });

  it('never pastes two Chat Inputs, even from a hand-made payload', () => {
    const result = pasteNodes(
      payload([
        { id: 'i', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
        { id: 'j', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
      ]),
      { types, existing: [], offset: 0 },
    );
    expect(result.nodes).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });

  it('keeps one edge per target handle and drops repeated node ids', () => {
    const result = pasteNodes(
      payload(
        [goodNode, { ...goodNode, id: 'a' }, { id: 'b', type: 'chat-output', config: {}, position: { x: 0, y: 0 } }],
        [
          { source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'in' },
          { source: 'a', sourceHandle: 'other', target: 'b', targetHandle: 'in' },
        ],
      ),
      { types, existing: [], offset: 0 },
    );
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
  });

  it('gives a second paste fresh ids', () => {
    const first = pasteNodes(two, { types, existing: [], offset: 40 });
    const second = pasteNodes(two, { types, existing: first.nodes, offset: 80 });
    expect(second.nodes[0]?.id).not.toBe(first.nodes[0]?.id);
    expect(second.nodes[0]?.data.name).toBe('LLM #2 (llm)');
  });
});
