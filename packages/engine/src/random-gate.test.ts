import { describe, expect, it } from 'vitest';
import type { ChatMessage, Edge, Workflow } from '@st/shared';
import { executeWorkflow, validateWorkflow } from './executor.js';
import { pruneInvalidEdges } from './prune.js';

// Random's chance mode used as a gate, wired to other nodes' branches.
const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  config,
  position: { x: 0, y: 0 },
});
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});
const graph = (nodes: Workflow['nodes'], edges: Edge[]): Workflow => ({
  id: 'w',
  name: 'W',
  nodes,
  edges,
  createdAt: '',
  updatedAt: '',
});
const options = {
  message: 'hello there',
  sessionId: 'session',
  history: [] as ChatMessage[],
  secrets: { get: async () => undefined },
};

describe('Random chance gate', () => {
  it('is skipped, like a Condition, when its connected value comes from a branch that was not taken', async () => {
    const workflow = graph(
      [
        node('input', 'chat-input'),
        node('combat', 'condition', { operator: 'equals', right: 'combat' }),
        node('one', 'random', { mode: 'number', min: 1, max: 1 }),
        node('gate', 'random', { mode: 'chance' }),
        node('yes', 'chat-output'),
        node('no', 'chat-output'),
      ],
      [
        edge('input', 'message', 'combat', 'value'),
        edge('combat', 'true', 'gate', 'value'),
        edge('one', 'value', 'gate', 'probability'),
        edge('gate', 'true', 'yes', 'value'),
        edge('gate', 'false', 'no', 'value'),
      ],
    );
    const result = await executeWorkflow(workflow, options);
    expect(result.execution.nodes.one?.status).toBe('completed');
    expect(result.execution.nodes.gate?.status).toBe('skipped');
    expect(result.replies).toEqual([]);
    // The same wiring with the branch taken passes the value through.
    const taken = await executeWorkflow(workflow, { ...options, message: 'combat' });
    expect(taken.replies).toEqual([{ nodeId: 'yes', content: 'combat' }]);
  });

  it('is skipped instead of falling back to its config when its connected probability was not produced', async () => {
    const workflow = graph(
      [
        node('input', 'chat-input'),
        node('pick', 'random', { mode: 'pick' }),
        node('gate', 'random', { mode: 'chance', probability: 1 }),
        node('yes', 'chat-output'),
      ],
      [
        edge('input', 'history', 'pick', 'items'),
        edge('pick', 'value', 'gate', 'probability'),
        edge('input', 'message', 'gate', 'value'),
        edge('gate', 'true', 'yes', 'value'),
      ],
    );
    const result = await executeWorkflow(workflow, options);
    expect(result.execution.nodes.pick?.output).not.toHaveProperty('value');
    expect(result.execution.nodes.gate?.status).toBe('skipped');
    expect(result.replies).toEqual([]);
  });

  it('keeps its value input and value output apart when both are wired', async () => {
    const workflow = graph(
      [
        node('input', 'chat-input'),
        node('gate', 'random', { mode: 'chance', probability: 1 }),
        node('out-a', 'chat-output'),
        node('out-b', 'chat-output'),
      ],
      [
        edge('input', 'message', 'gate', 'value'),
        edge('gate', 'value', 'out-a', 'value'),
        edge('gate', 'true', 'out-b', 'value'),
      ],
    );
    expect(await validateWorkflow(workflow)).toEqual([]);
    const pruned = await pruneInvalidEdges(workflow, { presets: { get: async () => undefined } });
    expect(pruned.edges).toEqual(workflow.edges);
    const result = await executeWorkflow(workflow, options);
    expect(result.replies.map((reply) => reply.content)).toEqual(['true', 'hello there']);
  });
});
