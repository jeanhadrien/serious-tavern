import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { NodeTypeDescriptor, Workflow } from '@st/shared';
import {
  GROUP_WINDOW_MS,
  HISTORY_LIMIT,
  emptyHistory,
  nodesMoved,
  record,
  redo,
  restoreNodes,
  snapshotOf,
  undo,
  type CanvasSnapshot,
  type History,
} from './canvasHistory.js';
import { canvasToWorkflow, workflowToCanvas, type CanvasNode } from './model.js';

const descriptor: NodeTypeDescriptor = {
  type: 'llm',
  label: 'LLM',
  description: '',
  category: 'AI',
  dynamicPorts: false,
  inputs: [],
  outputs: [],
  configSchema: {},
  defaultConfig: {},
};
const node = (id: string, x = 0, extra: Partial<CanvasNode> = {}): CanvasNode => ({
  id,
  type: 'workflow',
  position: { x, y: 0 },
  data: { descriptor, config: { model: id }, name: id },
  ...extra,
});
const edge = (id: string, extra: Partial<Edge> = {}): Edge => ({
  id,
  source: 'a',
  sourceHandle: 'out',
  target: 'b',
  targetHandle: 'in',
  ...extra,
});
const snap = (...ids: string[]): CanvasSnapshot => ({ nodes: ids.map((id) => node(id)), edges: [] });
const ids = (snapshots: CanvasSnapshot[]) => snapshots.map((item) => item.nodes.map((n) => n.id).join(''));

describe('snapshotOf', () => {
  it('strips selection and React Flow bookkeeping from nodes and edges, and nothing else', () => {
    const live = node('a', 5, { selected: true, dragging: true, resizing: true, measured: { width: 170, height: 90 } });
    const result = snapshotOf([live], [edge('e', { selected: true })]);
    expect(result.nodes[0]).toEqual(node('a', 5));
    expect(result.nodes[0]).not.toHaveProperty('selected');
    expect(result.nodes[0]).not.toHaveProperty('measured');
    expect(result.nodes[0]).not.toHaveProperty('dragging');
    expect(result.edges[0]).toEqual(edge('e'));
    expect(result.edges[0]).not.toHaveProperty('selected');
    expect(live.selected).toBe(true); // the live state is not touched
  });
});

describe('record', () => {
  it('pushes the state before the change and clears the redo list', () => {
    const history: History = { past: [snap('a')], future: [snap('x')] };
    const next = record(history, snap('b'));
    expect(ids(next.past)).toEqual(['a', 'b']);
    expect(next.future).toEqual([]);
    expect(next.group).toBeUndefined();
  });

  it('keeps 100 steps, dropping the oldest', () => {
    let history = emptyHistory;
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) history = record(history, snap(String(i)));
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0]?.nodes[0]?.id).toBe('5');
    expect(history.past.at(-1)?.nodes[0]?.id).toBe(String(HISTORY_LIMIT + 4));
  });

  describe('groups', () => {
    it.each([
      ['the same key right away', 'config:a', 'config:a', 10, 1],
      ['the same key at the edge of the window', 'config:a', 'config:a', GROUP_WINDOW_MS, 1],
      ['the same key after the window', 'config:a', 'config:a', GROUP_WINDOW_MS + 1, 2],
      ['another node', 'config:a', 'config:b', 10, 2],
    ])('%s', (_name, first, second, gap, steps) => {
      const one = record(emptyHistory, snap('1'), first, 1000);
      const two = record(one, snap('2'), second, 1000 + gap);
      expect(two.past).toHaveLength(steps);
      expect(two.past[0]?.nodes[0]?.id).toBe('1'); // a group keeps the state before its first change
    });

    it('lets the window slide while changes keep coming', () => {
      let history = record(emptyHistory, snap('1'), 'config:a', 0);
      for (const at of [800, 1600, 2400]) history = record(history, snap('x'), 'config:a', at);
      expect(history.past).toHaveLength(1);
      history = record(history, snap('y'), 'config:a', 2400 + GROUP_WINDOW_MS + 1);
      expect(history.past).toHaveLength(2);
    });

    it('is ended by an ungrouped step', () => {
      let history = record(emptyHistory, snap('1'), 'config:a', 0);
      history = record(history, snap('2'), undefined, 10);
      history = record(history, snap('3'), 'config:a', 20);
      expect(history.past).toHaveLength(3);
    });

    it('is ended by undo and redo', () => {
      const typed = record(emptyHistory, snap('1'), 'config:a', 0);
      const back = undo(typed, snap('2'));
      expect(back.history.group).toBeUndefined();
      const again = redo(back.history, snap('1'));
      expect(again.history.group).toBeUndefined();
    });
  });
});

describe('undo and redo', () => {
  it('go back and forth over the same states', () => {
    let history = record(record(emptyHistory, snap('a')), snap('a', 'b'));
    const back1 = undo(history, snap('a', 'b', 'c'));
    expect(ids([back1.snapshot as CanvasSnapshot])).toEqual(['ab']);
    const back2 = undo(back1.history, snap('a', 'b'));
    expect(ids([back2.snapshot as CanvasSnapshot])).toEqual(['a']);
    expect(back2.history.past).toEqual([]);
    expect(ids(back2.history.future)).toEqual(['abc', 'ab']);
    const forward = redo(back2.history, snap('a'));
    expect(ids([forward.snapshot as CanvasSnapshot])).toEqual(['ab']);
    const forward2 = redo(forward.history, snap('a', 'b'));
    expect(ids([forward2.snapshot as CanvasSnapshot])).toEqual(['abc']);
    expect(ids(forward2.history.past)).toEqual(['a', 'ab']);
    expect(forward2.history.future).toEqual([]);
    history = forward2.history;
    expect(redo(history, snap('abc')).snapshot).toBeUndefined();
  });

  it('give no snapshot, and the same history, when there is nothing to go to', () => {
    expect(undo(emptyHistory, snap('a'))).toEqual({ history: emptyHistory });
    expect(redo(emptyHistory, snap('a'))).toEqual({ history: emptyHistory });
  });

  it('drop the redo list when a new step is recorded after an undo', () => {
    const back = undo(record(emptyHistory, snap('a')), snap('a', 'b'));
    expect(back.history.future).toHaveLength(1);
    expect(record(back.history, snap('a')).future).toEqual([]);
  });
});

describe('nodesMoved', () => {
  const start = snap('a', 'b');
  it.each([
    ['a node at a new place', [{ id: 'a', position: { x: 10, y: 0 } }], true],
    [
      'one of several moved',
      [
        { id: 'a', position: { x: 0, y: 0 } },
        { id: 'b', position: { x: 0, y: 7 } },
      ],
      true,
    ],
    ['a click that did not move anything', [{ id: 'a', position: { x: 0, y: 0 } }], false],
    ['a node the snapshot does not have', [{ id: 'z', position: { x: 9, y: 9 } }], false],
  ])('%s', (_name, dragged, expected) => {
    expect(nodesMoved(start, dragged)).toBe(expected);
  });
});

describe('restoreNodes', () => {
  it('keeps the measurements of live nodes so they do not blink out, and adds none to new ones', () => {
    const live = [node('a', 0, { measured: { width: 100, height: 50 }, selected: true })];
    const restored = restoreNodes([node('a', 3), node('b')], live);
    expect(restored[0]?.measured).toEqual({ width: 100, height: 50 });
    expect(restored[0]?.position.x).toBe(3);
    expect(restored[0]).not.toHaveProperty('selected');
    expect(restored[1]).not.toHaveProperty('measured');
  });
});

describe('dirty after undo', () => {
  const workflow: Workflow = {
    id: 'w',
    name: 'W',
    nodes: [{ id: 'a', type: 'llm', config: { model: 'm' }, position: { x: 1, y: 2 } }],
    edges: [],
    createdAt: '',
    updatedAt: '',
  } as unknown as Workflow;
  const key = (nodes: CanvasNode[], edges: Edge[]) => JSON.stringify(canvasToWorkflow(workflow, nodes, edges));

  it('a restored canvas serializes exactly like the saved one, so the editor reads it as clean', () => {
    const loaded = workflowToCanvas(workflow, [descriptor]);
    const saved = key(loaded.nodes, loaded.edges);
    // The user selects, moves and measures the node, then undoes the move.
    const before = snapshotOf(loaded.nodes, loaded.edges);
    const live = loaded.nodes.map((n) => ({
      ...n,
      position: { x: 50, y: 60 },
      selected: true,
      measured: { width: 1, height: 1 },
    }));
    expect(key(live, loaded.edges)).not.toBe(saved);
    const history = record(emptyHistory, before);
    const result = undo(history, snapshotOf(live, loaded.edges));
    const restored = restoreNodes(result.snapshot?.nodes ?? [], live);
    expect(key(restored, result.snapshot?.edges ?? [])).toBe(saved);
    // Redo goes back to the moved state, which is dirty again.
    const forward = redo(result.history, snapshotOf(restored, []));
    expect(key(forward.snapshot?.nodes ?? [], [])).not.toBe(saved);
  });
});
