import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ChatMessage, Edge, Workflow } from '@st/shared';
import { executeWorkflow, validateWorkflow } from './executor.js';
import { descriptors, registry } from './registry.js';
import type { EngineEvent, NodeDefinition } from './types.js';

const node = (id: string, type: string) => ({
  id,
  type,
  config: { ...registry.get(type)?.defaultConfig },
  position: { x: 0, y: 0 },
});
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});
const workflow = (nodes: Workflow['nodes'], edges: Edge[]): Workflow => ({
  id: 'workflow',
  name: 'Test',
  nodes,
  edges,
  createdAt: '',
  updatedAt: '',
});
const options = {
  message: 'hello',
  sessionId: 'session',
  history: [] as ChatMessage[],
  secrets: { get: async () => undefined },
};
const testType = (type: string, extra: Partial<NodeDefinition>): NodeDefinition => ({
  type,
  label: type,
  description: '',
  category: '',
  inputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
  outputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
  configSchema: z.object({}),
  defaultConfig: {},
  execute: async (ctx) => ({ value: ctx.inputs.value }),
  ...extra,
});

afterEach(() => {
  registry.delete('sink-test');
  registry.delete('pass-test');
  vi.restoreAllMocks();
});

describe('sinks', () => {
  it('runs a sink with no path to a Chat Output, and everything it depends on', async () => {
    const sink = vi.fn(async () => ({}));
    const pass = vi.fn(async (ctx: { inputs: Record<string, unknown> }) => ({ value: ctx.inputs.value }));
    registry.set('sink-test', testType('sink-test', { sink: true, outputs: [], execute: sink }));
    registry.set('pass-test', testType('pass-test', { execute: pass }));
    const graph = workflow(
      [
        node('input', 'chat-input'),
        node('pass', 'pass-test'),
        node('sink', 'sink-test'),
        node('output', 'chat-output'),
      ],
      [
        edge('input', 'message', 'output', 'value'),
        edge('input', 'message', 'pass', 'value'),
        edge('pass', 'value', 'sink', 'value'),
      ],
    );
    const result = await executeWorkflow(graph, options);
    expect(result.replies.map((reply) => reply.content)).toEqual(['hello']);
    expect(pass).toHaveBeenCalledOnce();
    expect(sink).toHaveBeenCalledOnce();
    expect(sink.mock.calls[0]).toMatchObject([{ inputs: { value: 'hello' } }]);
    expect(result.execution.nodes.pass?.status).toBe('completed');
    expect(result.execution.nodes.sink?.status).toBe('completed');
  });

  it('still skips a dead end that is not a sink, saying no output needs it', async () => {
    const dead = vi.fn(async () => ({ value: 'never' }));
    registry.set('sink-test', testType('sink-test', { sink: true, outputs: [], execute: async () => ({}) }));
    registry.set('pass-test', testType('pass-test', { execute: dead }));
    const events: EngineEvent[] = [];
    const graph = workflow(
      [
        node('input', 'chat-input'),
        node('dead', 'pass-test'),
        node('sink', 'sink-test'),
        node('output', 'chat-output'),
      ],
      [
        edge('input', 'message', 'output', 'value'),
        edge('input', 'message', 'sink', 'value'),
        edge('input', 'message', 'dead', 'value'),
      ],
    );
    const result = await executeWorkflow(graph, { ...options, onEvent: (event) => events.push(event) });
    expect(dead).not.toHaveBeenCalled();
    expect(result.execution.nodes.dead?.status).toBe('skipped');
    expect(result.execution.nodes.sink?.status).toBe('completed');
    expect(events).toContainEqual({ type: 'node:skipped', nodeId: 'dead', detail: { reason: 'not-needed' } });
  });

  it('runs the upstream a sink and a Chat Output share only once', async () => {
    const pass = vi.fn(async (ctx: { inputs: Record<string, unknown> }) => ({ value: ctx.inputs.value }));
    registry.set('sink-test', testType('sink-test', { sink: true, outputs: [], execute: async () => ({}) }));
    registry.set('pass-test', testType('pass-test', { execute: pass }));
    const graph = workflow(
      [
        node('input', 'chat-input'),
        node('pass', 'pass-test'),
        node('sink', 'sink-test'),
        node('output', 'chat-output'),
      ],
      [
        edge('input', 'message', 'pass', 'value'),
        edge('pass', 'value', 'output', 'value'),
        edge('pass', 'value', 'sink', 'value'),
      ],
    );
    const result = await executeWorkflow(graph, options);
    expect(pass).toHaveBeenCalledOnce();
    expect(result.replies.map((reply) => reply.content)).toEqual(['hello']);
  });

  it('accepts a workflow whose only sink is not a Chat Output, and rejects one with no sink at all', async () => {
    registry.set('sink-test', testType('sink-test', { sink: true, outputs: [], execute: async () => ({}) }));
    registry.set('pass-test', testType('pass-test', {}));
    const sinkOnly = workflow(
      [node('input', 'chat-input'), node('sink', 'sink-test')],
      [edge('input', 'message', 'sink', 'value')],
    );
    expect(await validateWorkflow(sinkOnly)).toEqual([]);
    const noSink = workflow(
      [node('input', 'chat-input'), node('pass', 'pass-test')],
      [edge('input', 'message', 'pass', 'value')],
    );
    const issues = await validateWorkflow(noSink);
    expect(issues.map((issue) => issue.message)).toEqual([
      'A workflow must contain at least one node that writes something, such as a Chat Output, a State Write or an LLM with write tools.',
    ]);
  });

  it('runs a workflow without a Chat Output to the end with no reply and no warning about one', async () => {
    registry.set('sink-test', testType('sink-test', { sink: true, outputs: [], execute: async () => ({}) }));
    const sinkOnly = workflow(
      [node('input', 'chat-input'), node('sink', 'sink-test')],
      [edge('input', 'message', 'sink', 'value')],
    );
    const result = await executeWorkflow(sinkOnly, options);
    expect(result.replies).toEqual([]);
    expect(result.execution.status).toBe('completed');
    expect(result.execution.warnings).toEqual([]);
  });

  it('records no reply and warns when only a non-output sink ran', async () => {
    const sink = vi.fn(async () => ({}));
    registry.set('sink-test', testType('sink-test', { sink: true, outputs: [], execute: sink }));
    // The Chat Output's only source returns nothing, so it is skipped; the sink still runs.
    registry.set(
      'pass-test',
      testType('pass-test', {
        outputs: [{ name: 'value', label: 'Value', dataType: 'any', optional: true }],
        execute: async () => ({}),
      }),
    );
    const graph = workflow(
      [
        node('input', 'chat-input'),
        node('pass', 'pass-test'),
        node('sink', 'sink-test'),
        node('output', 'chat-output'),
      ],
      [
        edge('input', 'message', 'pass', 'value'),
        edge('pass', 'value', 'output', 'value'),
        edge('input', 'message', 'sink', 'value'),
      ],
    );
    const result = await executeWorkflow(graph, options);
    expect(result.replies).toEqual([]);
    expect(sink).toHaveBeenCalledOnce();
    expect(result.execution.nodes.output?.status).toBe('skipped');
    expect(result.execution.warnings).toContain('No Chat Output nodes ran; this turn produced no assistant messages.');
  });

  it('marks sinks in the node type descriptors', () => {
    const byType = new Map(descriptors().map((descriptor) => [descriptor.type, descriptor]));
    expect(byType.get('chat-output')?.sink).toBe(true);
    expect(byType.get('llm')?.sink).toBe(false);
    expect(byType.get('chat-input')?.sink).toBe(false);
  });
});
