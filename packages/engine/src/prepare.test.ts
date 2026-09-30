import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Preset, Workflow } from '@st/shared';
import { prepareWorkflow } from './prepare.js';
import { executeWorkflow, ExecutionFailure } from './executor.js';
import { registry } from './registry.js';

const graph = (): Workflow => ({
  id: 'workflow',
  name: 'Prepared',
  createdAt: '',
  updatedAt: '',
  nodes: [
    { id: 'input', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
    { id: 'output', type: 'chat-output', config: {}, position: { x: 0, y: 0 } },
  ],
  edges: [{ id: 'edge', source: 'input', sourceHandle: 'message', target: 'output', targetHandle: 'value' }],
});
const options = { message: 'hello', sessionId: 'session', history: [], secrets: { get: async () => undefined } };
afterEach(() => {
  registry.delete('prepare-test');
  vi.restoreAllMocks();
});

it.each(['raw', 'prepared'] as const)(
  'resolves ports and parses configs once when executing %s workflows',
  async (mode) => {
    const workflow = graph();
    const definition = registry.get('chat-output')!;
    const parse = vi.spyOn(definition.configSchema, 'safeParse');
    const resolve = vi.fn(async (config: Record<string, unknown>) => {
      expect(config).toEqual({ template: '', name: '', order: 0 });
      return { inputs: definition.inputs, outputs: definition.outputs };
    });
    const original = definition.resolvePorts;
    definition.resolvePorts = resolve;
    try {
      const input = mode === 'prepared' ? (await prepareWorkflow(workflow)).prepared! : workflow;
      if (mode === 'prepared') workflow.nodes[1]!.config = { template: 'changed after preparation' };
      const result = await executeWorkflow(input, options);
      expect(result.replies[0]?.content).toBe('hello');
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(parse).toHaveBeenCalledTimes(1);
    } finally {
      definition.resolvePorts = original;
    }
  },
);

it('shares cloned resource snapshots between preparation and execution, including concurrent reads', async () => {
  const preset: Preset = { id: 'preset', name: 'Original', inputs: [], entries: [], createdAt: '', updatedAt: '' };
  const get = vi.fn(async () => preset);
  registry.set('prepare-test', {
    type: 'prepare-test',
    label: 'Test',
    description: '',
    category: '',
    inputs: [],
    outputs: [{ name: 'text', label: 'Text', dataType: 'text' }],
    configSchema: z.object({ presetId: z.string().default('preset') }),
    defaultConfig: {},
    async resolvePorts(config, resources) {
      const [a, b] = await Promise.all([
        resources.presets.get(String(config.presetId)),
        resources.presets.get(String(config.presetId)),
      ]);
      expect(a).toBe(b);
      return { inputs: [], outputs: [{ name: 'text', label: 'Text', dataType: 'text' }] };
    },
    async execute(ctx) {
      return { text: (await ctx.resources.presets.get(String(ctx.config.presetId)))!.name };
    },
  });
  const workflow = graph();
  workflow.nodes.push({ id: 'resource', type: 'prepare-test', config: {}, position: { x: 0, y: 0 } });
  workflow.edges[0] = { id: 'edge', source: 'resource', sourceHandle: 'text', target: 'output', targetHandle: 'value' };
  const { prepared, errors } = await prepareWorkflow(workflow, { presets: { get } });
  expect(errors).toEqual([]);
  preset.name = 'Changed';
  const result = await executeWorkflow(prepared!, options);
  expect(result.replies[0]?.content).toBe('Original');
  expect(get).toHaveBeenCalledTimes(1);
  expect(result.execution.nodes.input?.status).toBe('skipped');
});

it('returns structured failing node identity independently of the error message format', async () => {
  const workflow = graph();
  workflow.nodes[1]!.id = 'output with spaces';
  workflow.edges[0]!.target = 'output with spaces';
  vi.spyOn(registry.get('chat-output')!, 'execute').mockRejectedValue(new Error('boom'));
  const error = await executeWorkflow(workflow, options).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(ExecutionFailure);
  expect(error).toMatchObject({ nodeId: 'output with spaces', nodeType: 'chat-output', replies: [] });
});
