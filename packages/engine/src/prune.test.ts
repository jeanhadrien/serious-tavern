import { describe, expect, it } from 'vitest';
import type { Preset, Workflow } from '@st/shared';
import { pruneInvalidEdges } from './prune.js';

const preset: Preset = {
  id: '2b041793-416b-4c94-a541-99ab866230b7',
  name: 'Dynamic',
  createdAt: '',
  updatedAt: '',
  inputs: [{ id: 'prompt-input', label: 'Prompt', key: 'prompt', dataType: 'text' }],
  entries: [{ id: 'one', name: 'Prompt', kind: 'slot', enabled: true, inputKey: 'prompt', role: 'user' }],
};
const resources = { presets: { get: async (id: string) => (id === preset.id ? preset : undefined) } };
const graph = (nodes: Workflow['nodes'], edges: Workflow['edges']): Workflow => ({
  id: 'workflow',
  name: 'Test',
  nodes,
  edges,
  createdAt: '',
  updatedAt: '',
});

describe('pruneInvalidEdges', () => {
  it('drops an edge into a preset input that was removed, without mutating the input', async () => {
    const workflow = graph(
      [
        { id: 'input', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
        { id: 'llm', type: 'llm', config: { presetId: preset.id }, position: { x: 100, y: 0 } },
      ],
      [
        { id: 'kept', source: 'input', sourceHandle: 'message', target: 'llm', targetHandle: 'prompt' },
        { id: 'stale', source: 'input', sourceHandle: 'message', target: 'llm', targetHandle: 'removed' },
      ],
    );
    const pruned = await pruneInvalidEdges(workflow, resources);
    expect(pruned.edges.map((edge) => edge.id)).toEqual(['kept']);
    expect(workflow.edges).toHaveLength(2);
  });

  it('keeps edges when port resolution throws (LLM with a missing preset)', async () => {
    const workflow = graph(
      [
        { id: 'input', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
        { id: 'llm', type: 'llm', config: { presetId: '' }, position: { x: 100, y: 0 } },
      ],
      [{ id: 'edge', source: 'input', sourceHandle: 'message', target: 'llm', targetHandle: 'anything' }],
    );
    expect((await pruneInvalidEdges(workflow, { presets: { get: async () => undefined } })).edges).toHaveLength(1);
  });

  it('keeps edges attached to unknown-type nodes', async () => {
    const workflow = graph(
      [
        { id: 'input', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
        { id: 'output', type: 'chat-output', config: {}, position: { x: 0, y: 0 } },
        { id: 'mystery', type: 'not-a-node', config: {}, position: { x: 0, y: 0 } },
      ],
      [
        { id: 'from-unknown', source: 'mystery', sourceHandle: 'gone', target: 'output', targetHandle: 'value' },
        { id: 'into-unknown', source: 'input', sourceHandle: 'message', target: 'mystery', targetHandle: 'stale' },
      ],
    );
    expect((await pruneInvalidEdges(workflow, resources)).edges.map((edge) => edge.id)).toEqual([
      'from-unknown',
      'into-unknown',
    ]);
  });
});
