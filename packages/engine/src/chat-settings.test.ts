import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { noAccess, presetSchema, type ChatMessage, type Edge, type Workflow } from '@st/shared';
import { executeWorkflow } from './executor.js';
import { prepareWorkflow, validateWorkflow } from './prepare.js';
import { renderPreset } from './preset.js';
import { registry } from './registry.js';

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  config: { ...registry.get(type)?.defaultConfig, ...config },
  position: { x: 0, y: 0 },
});
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});
const workflow = (nodes: Workflow['nodes'], edges: Edge[], settings?: unknown): Workflow => ({
  id: 'workflow',
  name: 'Test',
  nodes,
  edges,
  createdAt: '',
  updatedAt: '',
  ...(settings ? { settings: settings as Workflow['settings'] } : {}),
});
const options = {
  message: 'hello',
  sessionId: 'session',
  history: [] as ChatMessage[],
  secrets: { get: async () => undefined },
};
const values = { v: 0.3, on: true, mode: 'calm' };
const templated = (template: string) =>
  workflow(
    [node('input', 'chat-input'), node('output', 'chat-output', { template })],
    [edge('input', 'message', 'output', 'value')],
  );

describe('settings in templates', () => {
  it('renders settings in a Chat Output template and records them in the execution log', async () => {
    const graph = templated('v={{settings.v}} {{#if settings.on}}on{{else}}off{{/if}} {{settings.mode}} {{settings}}');
    const result = await executeWorkflow(graph, { ...options, settings: values });
    expect(result.replies[0]?.content).toBe('v=0.3 on calm {"v":0.3,"on":true,"mode":"calm"}');
    expect(result.execution.settings).toEqual(values);
  });

  it('renders missing settings as empty text and records an empty object', async () => {
    const result = await executeWorkflow(
      templated('v={{settings.v}} {{#if settings.on}}on{{else}}off{{/if}}'),
      options,
    );
    expect(result.replies[0]?.content).toBe('v= off');
    expect(result.execution.settings).toEqual({});
  });

  it.each([
    [3, 'true'],
    [2, 'false'],
  ])('routes a Condition on settings.level = %s to %s', async (level, branch) => {
    const graph = workflow(
      [
        node('input', 'chat-input'),
        node('condition', 'condition', { left: '{{settings.level}}', operator: 'gt', right: '2' }),
        node('yes', 'chat-output', { template: 'yes' }),
        node('no', 'chat-output', { template: 'no' }),
      ],
      [
        edge('input', 'message', 'condition', 'value'),
        edge('condition', 'true', 'yes', 'value'),
        edge('condition', 'false', 'no', 'value'),
      ],
    );
    const result = await executeWorkflow(graph, { ...options, settings: { level } });
    expect(result.replies.map((reply) => reply.content)).toEqual([branch === 'true' ? 'yes' : 'no']);
  });

  it("records a copy, so a later change to the caller's object does not reach the log", async () => {
    const given = { v: 1 };
    const graph = templated('{{settings.v}}');
    const result = await executeWorkflow(graph, { ...options, settings: given });
    given.v = 2;
    expect(result.execution.settings).toEqual({ v: 1 });
  });

  describe('as seen by nodes', () => {
    afterEach(() => registry.delete('settings-writer-test'));

    it('gives nodes a frozen object, so a node cannot change what the log records', async () => {
      registry.set('settings-writer-test', {
        type: 'settings-writer-test',
        access: () => noAccess(),
        label: 'Writer',
        description: '',
        category: '',
        inputs: [],
        outputs: [{ name: 'out', label: 'Out', dataType: 'text' }],
        configSchema: z.object({}),
        defaultConfig: {},
        async execute(ctx) {
          let threw = false;
          try {
            (ctx.settings as Record<string, unknown>).v = 2;
          } catch {
            threw = true;
          }
          return { out: `${Object.isFrozen(ctx.settings)} ${threw}` };
        },
      });
      const graph = workflow(
        [node('input', 'chat-input'), node('writer', 'settings-writer-test'), node('output', 'chat-output')],
        [edge('writer', 'out', 'output', 'value')],
      );
      const result = await executeWorkflow(graph, { ...options, settings: { v: 1 } });
      expect(result.replies.map((reply) => reply.content)).toEqual(['true true']);
      expect(result.execution.settings).toEqual({ v: 1 });
    });
  });

  it('renders settings in preset entries and drops an entry whose setting is empty', () => {
    const preset = presetSchema.parse({
      id: '8f1fe1a9-3480-4e52-834c-f25d90684d71',
      name: 'Test',
      createdAt: '',
      updatedAt: '',
      inputs: [],
      entries: [
        {
          id: 'note',
          displayName: 'Note',
          kind: 'message',
          role: 'system',
          enabled: true,
          content: '{{#if settings.note}}[Note: {{settings.note}}]{{/if}}',
        },
      ],
    });
    const render = (note: string) =>
      renderPreset(preset, {
        inputs: {},
        templateContext: { trigger: { message: '', sessionId: 's' }, settings: { note } },
      });
    expect(render('Rain.')).toEqual([{ role: 'system', content: '[Note: Rain.]' }]);
    expect(render('')).toEqual([]);
  });
});

describe('Chat Settings node', () => {
  const graph = (key: string, port: 'settings' | 'value') =>
    workflow(
      [
        node('input', 'chat-input'),
        node('settings', 'chat-settings', { key }),
        node('output', 'chat-output'),
        node('anchor', 'chat-output', { template: 'anchor' }),
      ],
      [edge('settings', port, 'output', 'value'), edge('input', 'message', 'anchor', 'value')],
    );

  it('outputs every resolved setting', async () => {
    const result = await executeWorkflow(graph('', 'settings'), { ...options, settings: values });
    expect(result.execution.nodes.settings?.output).toEqual({ settings: values });
    expect(result.replies.map((reply) => reply.content)).toContain(JSON.stringify(values, null, 2));
  });

  it('outputs the value of its key', async () => {
    const result = await executeWorkflow(graph('mode', 'value'), { ...options, settings: values });
    expect(result.execution.nodes.settings?.output).toEqual({ settings: values, value: 'calm' });
    expect(result.replies.map((reply) => reply.content)).toEqual(['anchor', 'calm']);
  });

  it('outputs no value without a key, so what it feeds is skipped', async () => {
    const result = await executeWorkflow(graph('', 'value'), { ...options, settings: values });
    expect(result.execution.nodes.output?.status).toBe('skipped');
    expect(result.replies.map((reply) => reply.content)).toEqual(['anchor']);
    expect(result.execution.nodes.settings?.logs).toBeUndefined();
  });

  it('outputs a falsy value too, so what it feeds still runs', async () => {
    const result = await executeWorkflow(graph('on', 'value'), { ...options, settings: { on: false } });
    expect(result.execution.nodes.settings?.output).toEqual({ settings: { on: false }, value: false });
    expect(result.execution.nodes.output?.status).toBe('completed');
    expect(result.replies.map((reply) => reply.content)).toEqual(['anchor', 'false']);
  });

  it('logs a key the workflow does not declare and outputs no value', async () => {
    const result = await executeWorkflow(graph('nope', 'value'), { ...options, settings: values });
    expect(result.execution.nodes.output?.status).toBe('skipped');
    expect(result.execution.nodes.settings?.logs).toEqual([
      'Chat setting "nope" is not declared by this workflow; Value is empty.',
    ]);
  });
});

describe('declaration validation', () => {
  const base = templated('x');

  it('adds no issue for valid declarations or none', async () => {
    expect(await validateWorkflow(base)).toEqual([]);
    const settings = [
      { key: 'v', type: 'number', default: 0.3, min: 0, max: 1, step: 0.05 },
      { key: 'mode', type: 'enum', options: ['calm', 'tense'] },
    ];
    expect(await validateWorkflow({ ...base, settings: settings as Workflow['settings'] })).toEqual([]);
  });

  it.each([
    [
      [
        { key: 'a', type: 'text' },
        { key: 'a', type: 'boolean' },
      ],
      'More than one chat setting uses the key "a"; keys must be unique.',
    ],
    [
      [{ key: 'my key', type: 'text' }],
      'Chat setting #1 has the key "my key", which can\'t be used in templates: use letters, digits and _, not starting with a digit.',
    ],
    [[{ key: 'v', type: 'number', min: 2, max: 1, default: 1 }], 'Chat setting "v": min 2 is greater than max 1.'],
    [{}, 'Chat settings must be a list, not {}.'],
    [
      [{ key: 'm', type: 'enum', options: ['a'], default: 'b' }],
      'Chat setting "m": the default "b" is not one of its options.',
    ],
  ])('reports bad declarations in plain language: %j', async (settings: unknown, message) => {
    const result = await prepareWorkflow(workflow(base.nodes, base.edges, settings));
    expect(result.prepared).toBeUndefined();
    expect(result.errors).toEqual([{ message }]);
  });
});
