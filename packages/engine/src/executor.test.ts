import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Workflow, Edge, ChatMessage, Preset } from '@st/shared';
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
afterEach(() => {
  for (const type of ['slow-test', 'typed-test', 'fail-test', 'missing-test', 'optional-test',
    'fast-fail-test', 'abort-test', 'ignore-abort-test']) registry.delete(type);
  vi.restoreAllMocks();
});

describe('executor', () => {
  it('runs independent slow nodes concurrently and respects dependencies', async () => {
    const started: string[] = [];
    let release!: () => void;
    const bothStarted = new Promise<void>(resolve => { release = resolve; });
    registry.set('slow-test', { type: 'slow-test', label: 'Slow', description: '', category: '',
      inputs: [{ name: 'in', label: 'In', dataType: 'any' }], outputs: [{ name: 'out', label: 'Out', dataType: 'any' }],
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
    expect(result2.execution.nodes.condition?.output).toEqual({ false: 'hello' });
  });
  it('supports array and first-non-empty merge modes', async () => {
    for (const [mode, expected] of [['array', '["hello"]'], ['first-non-empty', 'hello']] as const) {
      const graph = workflow([node('input', 'chat-input'), node('merge', 'merge', { mode }), node('output', 'chat-output')],
        [edge('input', 'message', 'merge', 'a'), edge('merge', 'value', 'output', 'value')]);
      expect((await executeWorkflow(graph, options)).reply).toBe(expected);
    }
  });
  it('reports unknown ports, invalid configs, duplicate inputs, missing nodes, and cycles', async () => {
    const graph = workflow([node('input', 'chat-input'), node('output', 'chat-output')],
      [edge('input', 'wrong', 'output', 'value'), edge('input', 'message', 'output', 'value'),
        edge('output', 'reply', 'input', 'wrong')]);
    graph.nodes[1]!.config = { template: 123 };
    expect((await validateWorkflow(graph)).join(' ')).toMatch(/invalid config.*invalid output port.*multiple connections.*invalid input port.*cycle/i);
  });
  it('renders paths without evaluating expressions', () => {
    expect(renderTemplate('A {{input.foo}} B {{trigger.message}} C {{history}} D {{input.foo.constructor()}}',
      { inputs: { foo: 3 }, trigger: { message: 'hi', sessionId: 's' }, history: [] }))
      .toBe('A 3 B hi C [] D {{input.foo.constructor()}}');
  });
  it('renders character and persona variables in node templates', () => {
    expect(renderTemplate('{{char}}/{{char.description}}/{{user}}/{{user.description}}', {
      inputs: {}, trigger: { message: '', sessionId: '' }, history: [],
      character: { id: 'c', name: 'Rin', description: 'A {{user}}', personality: '', scenario: '', first_mes: '',
        mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [],
        tags: [], creator: '', character_version: '', extensions: {}, avatar: false, createdAt: '', updatedAt: '' },
      persona: { id: 'p', name: 'Sam', description: '', avatar: false, createdAt: '', updatedAt: '' }
    })).toBe('Rin/A Sam/Sam/');
  });
  it('marks a timed-out node failed and emits events', async () => {
    registry.set('slow-test', { type: 'slow-test', label: 'Slow', description: '', category: '',
      inputs: [{ name: 'in', label: 'In', dataType: 'any' }], outputs: [{ name: 'out', label: 'Out', dataType: 'any' }],
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
  it('resolves preset inputs and reports edges to removed inputs', async () => {
      const preset: Preset = { id: '2b041793-416b-4c94-a541-99ab866230b7', name: 'Dynamic',
        createdAt: '', updatedAt: '', inputs: [
          { id: 'prompt-input', label: 'Prompt', key: 'prompt', dataType: 'text' },
          { id: 'extra-input', key: 'extra', dataType: 'text' }
        ], entries: [
          { id: 'one', name: 'Prompt', kind: 'slot', enabled: true, inputKey: 'prompt', role: 'user' },
          { id: 'two', name: 'Extra', kind: 'slot', enabled: true, inputKey: 'extra', role: 'user' }
        ] };
      const resources = { presets: { get: async () => preset } };
      expect(await registry.get('llm')!.resolvePorts?.({ presetId: preset.id }, resources)).toMatchObject({
        inputs: [{ name: 'prompt', label: 'Prompt', dataType: 'text' }, { name: 'extra', label: 'extra', dataType: 'text' }]
      });
      const graph = workflow([node('input', 'chat-input'), node('llm', 'llm', { presetId: preset.id }),
        node('output', 'chat-output')], [
        edge('input', 'message', 'llm', 'extra'), edge('llm', 'text', 'output', 'value')
      ]);
      expect(await validateWorkflow(graph, resources)).toEqual([]);
      preset.inputs.splice(1, 1);
      preset.entries.splice(1, 1);
      expect((await validateWorkflow(graph, resources)).join(' ')).toContain('invalid input port extra');
  });
  it('rejects incompatible edges with node, port and type names after port resolution', async () => {
    registry.set('typed-test', { type: 'typed-test', label: 'Typed', description: '', category: '',
      inputs: [{ name: 'count', label: 'Count', dataType: 'number' }],
      outputs: [{ name: 'text', label: 'Text', dataType: 'text' }],
      configSchema: z.object({}), defaultConfig: {}, async execute() { return { text: 'done' }; }
    });
    const graph = workflow([node('input', 'chat-input'), node('convert', 'typed-test'), node('output', 'chat-output')],
      [edge('input', 'message', 'convert', 'count'), edge('convert', 'text', 'output', 'value')]);
    expect((await validateWorkflow(graph)).join(' ')).toMatch(/input \(chat-input\)\.message \[text\].*convert \(typed-test\)\.count \[number\]/);
  });
  it('converts messages to a transcript and objects to pretty JSON on text edges', async () => {
    const history: ChatMessage[] = [
      { id: '1', role: 'user', content: 'Hi', createdAt: '' },
      { id: '2', role: 'assistant', content: 'Hello', createdAt: '' }
    ];
    const transcript = workflow([node('input', 'chat-input'), node('output', 'chat-output')],
      [edge('input', 'history', 'output', 'value')]);
    expect((await executeWorkflow(transcript, { ...options, history })).reply).toBe('user: Hi\nassistant: Hello');
    registry.set('typed-test', { type: 'typed-test', label: 'Typed', description: '', category: '',
      inputs: [], outputs: [{ name: 'value', label: 'Value', dataType: 'object' }],
      configSchema: z.object({}), defaultConfig: {}, async execute() { return { value: { hello: ['world'] } }; }
    });
    const json = workflow([node('input', 'chat-input'), node('object', 'typed-test'), node('output', 'chat-output')],
      [edge('object', 'value', 'output', 'value')]);
    expect((await executeWorkflow(json, options)).reply).toBe('{\n  "hello": [\n    "world"\n  ]\n}');
  });
  it('does not execute nodes disconnected from Chat Output', async () => {
    const run = vi.fn(async () => { throw new Error('unreachable node ran'); });
    registry.set('fail-test', { type: 'fail-test', label: 'Fail', description: '', category: '',
      inputs: [], outputs: [{ name: 'out', label: 'Out', dataType: 'any' }],
      configSchema: z.object({}), defaultConfig: {}, execute: run });
    const graph = workflow([node('input', 'chat-input'), node('unused', 'fail-test'), node('output', 'chat-output')],
      [edge('input', 'message', 'output', 'value')]);
    const result = await executeWorkflow(graph, options);
    expect(result.reply).toBe('hello');
    expect(run).not.toHaveBeenCalled();
    expect(result.execution.nodes.unused?.status).toBe('skipped');
  });
  it('fails when a connected required output is omitted but permits optional branch omission', async () => {
    registry.set('missing-test', { type: 'missing-test', label: 'Missing', description: '', category: '',
      inputs: [], outputs: [{ name: 'out', label: 'Out', dataType: 'any' }],
      configSchema: z.object({}), defaultConfig: {}, async execute() { return {}; }
    });
    const missing = workflow([node('input', 'chat-input'), node('missing', 'missing-test'), node('output', 'chat-output')],
      [edge('missing', 'out', 'output', 'value')]);
    await expect(executeWorkflow(missing, options)).rejects.toMatchObject({
      message: 'Node missing (missing-test): Node did not produce output "out"',
      execution: { nodes: { missing: { status: 'error', error: 'Node did not produce output "out"' } } }
    });

    registry.set('optional-test', { type: 'optional-test', label: 'Optional', description: '', category: '',
      inputs: [], outputs: [{ name: 'out', label: 'Out', dataType: 'any', optional: true }],
      configSchema: z.object({}), defaultConfig: {}, async execute() { return {}; }
    });
    const optional = workflow([node('input', 'chat-input'), node('optional', 'optional-test'),
      node('merge', 'merge'), node('output', 'chat-output')], [
      edge('optional', 'out', 'merge', 'a'), edge('input', 'message', 'merge', 'b'),
      edge('merge', 'value', 'output', 'value')
    ]);
    expect((await executeWorkflow(optional, options)).reply).toBe('{"b":"hello"}');
  });
  it('aborts and settles sibling nodes before returning the first real failure', async () => {
    let siblingSettled = false;
    registry.set('fast-fail-test', { type: 'fast-fail-test', label: 'Fast failure', description: '', category: '',
      inputs: [{ name: 'in', label: 'In', dataType: 'any' }], outputs: [{ name: 'out', label: 'Out', dataType: 'any' }],
      configSchema: z.object({}), defaultConfig: {}, async execute() { throw new Error('first failure'); }
    });
    registry.set('abort-test', { type: 'abort-test', label: 'Abort-aware', description: '', category: '',
      inputs: [{ name: 'in', label: 'In', dataType: 'any' }], outputs: [{ name: 'out', label: 'Out', dataType: 'any' }],
      configSchema: z.object({}), defaultConfig: {}, async execute({ signal }) {
        return new Promise(resolve => {
          const settle = () => { siblingSettled = true; resolve({ out: 'cancelled' }); };
          if (signal.aborted) settle();
          else signal.addEventListener('abort', settle, { once: true });
        });
      }
    });
    const graph = workflow([node('input', 'chat-input'), node('fail', 'fast-fail-test'), node('slow', 'abort-test'),
      node('merge', 'merge'), node('output', 'chat-output')], [
      edge('input', 'message', 'fail', 'in'), edge('input', 'message', 'slow', 'in'),
      edge('fail', 'out', 'merge', 'a'), edge('slow', 'out', 'merge', 'b'), edge('merge', 'value', 'output', 'value')
    ]);
    let failedExecution: import('@st/shared').ExecutionLog | undefined;
    const failure = await executeWorkflow(graph, options).catch(error => error);
    expect(failure).toMatchObject({ message: 'Node fail (fast-fail-test): first failure' });
    failedExecution = failure.execution;
    expect(siblingSettled).toBe(true);
    expect(failedExecution?.nodes.slow?.status).toBe('cancelled');
    const snapshot = structuredClone(failedExecution);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(failedExecution).toEqual(snapshot);
  });
  it('waits for an abort-ignoring sibling and prevents its late callbacks from changing the log', async () => {
    registry.set('fast-fail-test', { type: 'fast-fail-test', label: 'Fast failure', description: '', category: '',
      inputs: [{ name: 'in', label: 'In', dataType: 'any' }], outputs: [{ name: 'out', label: 'Out', dataType: 'any' }],
      configSchema: z.object({}), defaultConfig: {}, async execute() { throw new Error('first failure'); }
    });
    registry.set('ignore-abort-test', { type: 'ignore-abort-test', label: 'Ignores abort', description: '', category: '',
      inputs: [{ name: 'in', label: 'In', dataType: 'any' }], outputs: [{ name: 'out', label: 'Out', dataType: 'any' }],
      configSchema: z.object({}), defaultConfig: {}, async execute({ recordRequest }) {
        await new Promise(resolve => setTimeout(resolve, 40));
        recordRequest({ late: true });
        return { out: 'late' };
      }
    });
    const graph = workflow([node('input', 'chat-input'), node('fail', 'fast-fail-test'), node('slow', 'ignore-abort-test'),
      node('merge', 'merge'), node('output', 'chat-output')], [
      edge('input', 'message', 'fail', 'in'), edge('input', 'message', 'slow', 'in'),
      edge('fail', 'out', 'merge', 'a'), edge('slow', 'out', 'merge', 'b'), edge('merge', 'value', 'output', 'value')
    ]);
    const started = Date.now();
    let failedExecution: import('@st/shared').ExecutionLog | undefined;
    const failure = await executeWorkflow(graph, options).catch(error => error);
    expect(failure).toMatchObject({ message: 'Node fail (fast-fail-test): first failure' });
    failedExecution = failure.execution;
    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
    expect(failedExecution?.nodes.slow).toMatchObject({ status: 'cancelled' });
    const snapshot = structuredClone(failedExecution);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(failedExecution).toEqual(snapshot);
    expect(failedExecution?.nodes.slow).not.toHaveProperty('request');
  });
});
