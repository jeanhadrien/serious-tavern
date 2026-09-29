import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Workflow, Edge, ChatMessage } from '@st/shared';
import { executeWorkflow, validateWorkflow } from './executor.js';
import { renderTemplate } from './template.js';
import { registry } from './registry.js';

const node = (id: string, type: string, config: Record<string, unknown> = {}) =>
  ({ id, type, config: { ...registry.get(type)?.defaultConfig, ...config }, position: { x: 0, y: 0 } });
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge =>
  ({ id: `${source}-${sourceHandle}-${target}-${targetHandle}`, source, sourceHandle, target, targetHandle });
const workflow = (nodes: Workflow['nodes'], edges: Edge[]): Workflow =>
  ({ id: 'workflow', name: 'Test', nodes, edges, createdAt: '', updatedAt: '' });
const options = { message: 'hello', sessionId: 'session', history: [] as ChatMessage[],
  secrets: { get: async () => undefined } };
afterEach(() => { registry.delete('slow-test'); vi.restoreAllMocks(); });

describe('executor', () => {
  it('runs independent slow nodes concurrently and respects dependencies', async () => {
    const started: string[] = [];
    let release!: () => void;
    const bothStarted = new Promise<void>(resolve => { release = resolve; });
    registry.set('slow-test', { type: 'slow-test', label: 'Slow', description: '', category: '',
      inputs: [{ name: 'in', label: 'In' }], outputs: [{ name: 'out', label: 'Out' }],
      configSchema: z.object({}), defaultConfig: {},
      execute: async ({ trigger }) => {
        started.push(trigger.message);
        if (started.length === 2) release();
        await Promise.race([bothStarted, new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Branches did not start concurrently')), 1000))]);
        return { out: 'done' };
      } });
    const graph = workflow([node('input', 'chat-input'), node('a', 'slow-test'), node('b', 'slow-test'),
      node('merge', 'merge'), node('output', 'chat-output')], [
      edge('input', 'message', 'a', 'in'), edge('input', 'message', 'b', 'in'),
      edge('a', 'out', 'merge', 'a'), edge('b', 'out', 'merge', 'b'), edge('merge', 'value', 'output', 'value')
    ]);
    const result = await executeWorkflow(graph, options);
    expect(started).toHaveLength(2);
    expect(JSON.parse(result.reply)).toEqual({ a: 'done', b: 'done' });
    expect(result.execution.nodes.output?.status).toBe('completed');
  });
  it('propagates a condition skip and merges the taken branch', async () => {
    const graph = workflow([node('input', 'chat-input'),
      node('condition', 'condition', { left: '{{input.value}}', right: 'hello' }),
      node('merge', 'merge'), node('output', 'chat-output')], [
      edge('input', 'message', 'condition', 'value'),
      edge('condition', 'true', 'merge', 'a'), edge('condition', 'false', 'merge', 'b'),
      edge('merge', 'value', 'output', 'value')]);
    const result = await executeWorkflow(graph, options);
    expect(result.reply).toBe('{"a":"hello"}');
    expect(result.execution.nodes.condition?.output).toEqual({ true: 'hello' });
    const skipped = workflow([node('input', 'chat-input'), node('condition', 'condition', { right: 'other' }),
      node('mid', 'http-request'), node('merge', 'merge'), node('output', 'chat-output')],
    [edge('input', 'message', 'condition', 'value'), edge('condition', 'true', 'mid', 'input'),
      edge('mid', 'body', 'merge', 'a'), edge('condition', 'false', 'merge', 'b'),
      edge('merge', 'value', 'output', 'value')]);
    const result2 = await executeWorkflow(skipped, options);
    expect(result2.execution.nodes.mid?.status).toBe('skipped');
    expect(result2.reply).toBe('{"b":"hello"}');
  });
  it('supports array and first-non-empty merge modes', async () => {
    for (const [mode, expected] of [['array', '["hello"]'], ['first-non-empty', 'hello']] as const) {
      const graph = workflow([node('input', 'chat-input'), node('merge', 'merge', { mode }), node('output', 'chat-output')],
        [edge('input', 'message', 'merge', 'a'), edge('merge', 'value', 'output', 'value')]);
      expect((await executeWorkflow(graph, options)).reply).toBe(expected);
    }
  });
  it('reports unknown ports, invalid configs, duplicate inputs, missing nodes, and cycles', () => {
    const graph = workflow([node('input', 'chat-input'), node('output', 'chat-output')],
      [edge('input', 'wrong', 'output', 'value'), edge('input', 'message', 'output', 'value'),
        edge('output', 'reply', 'input', 'wrong')]);
    graph.nodes[1]!.config = { template: 123 };
    expect(validateWorkflow(graph).join(' ')).toMatch(/invalid config.*invalid output port.*multiple connections.*invalid input port.*cycle/i);
  });
  it('renders paths without evaluating expressions', () => {
    expect(renderTemplate('A {{input.foo}} B {{trigger.message}} C {{history}} D {{input.foo.constructor()}}',
      { inputs: { foo: 3 }, trigger: { message: 'hi', sessionId: 's' }, history: [] }))
      .toBe('A 3 B hi C [] D {{input.foo.constructor()}}');
  });
  it('marks a timed-out node failed and emits events', async () => {
    registry.set('slow-test', { type: 'slow-test', label: 'Slow', description: '', category: '',
      inputs: [{ name: 'in', label: 'In' }], outputs: [{ name: 'out', label: 'Out' }],
      configSchema: z.object({}), defaultConfig: {},
      execute: async () => new Promise(() => {}) });
    const graph = workflow([node('input', 'chat-input'), node('slow', 'slow-test'), node('output', 'chat-output')],
      [edge('input', 'message', 'slow', 'in'), edge('slow', 'out', 'output', 'value')]);
    const events: string[] = [];
    await expect(executeWorkflow(graph, { ...options, nodeTimeoutMs: 10, onEvent: e => events.push(e.type) }))
      .rejects.toMatchObject({ execution: { status: 'error', nodes: { slow: { status: 'error' } } } });
    expect(events).toContain('node:error');
    expect(events.at(-1)).toBe('execution:complete');
  });
});
