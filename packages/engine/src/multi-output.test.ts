import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Character, ChatMessage, Preset, Workflow } from '@st/shared';
import { executeWorkflow, ExecutionFailure, validateWorkflow } from './executor.js';
import { registry } from './registry.js';
import { providers } from './providers/index.js';
import { memory } from './nodes/memory/index.js';
import { renderPreset } from './preset.js';
import type { ExecutionContext } from './types.js';

const node = (id: string, type = 'chat-output', config: Record<string, unknown> = {}) => ({
  id,
  type,
  config,
  position: { x: 0, y: 0 },
});
const edge = (source: string, target: string, sourceHandle = 'message', targetHandle = 'value') => ({
  id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
  source,
  target,
  sourceHandle,
  targetHandle,
});
const graph = (nodes: Workflow['nodes'], edges: Workflow['edges']): Workflow => ({
  id: 'workflow',
  name: 'Multiple',
  createdAt: '',
  updatedAt: '',
  nodes,
  edges,
});
const options = {
  message: 'hello',
  sessionId: 'session',
  history: [] as ChatMessage[],
  secrets: { get: async () => 'test-key' },
};
const card = (id = 'card', name = 'Rin'): Character => ({
  id,
  name,
  description: 'Description of {{char}}',
  personality: 'Kind',
  scenario: 'Garden',
  first_mes: '',
  mes_example: '',
  creator_notes: '',
  system_prompt: '',
  post_history_instructions: '',
  alternate_greetings: [],
  tags: [],
  creator: '',
  character_version: '',
  extensions: {},
  avatar: false,
  createdAt: '',
  updatedAt: '',
});
const preset: Preset = {
  id: '2b041793-416b-4c94-a541-99ab866230b7',
  name: 'Test',
  createdAt: '',
  updatedAt: '',
  inputs: [{ id: 'prompt', key: 'prompt', dataType: 'text' }],
  entries: [{ id: 'prompt', displayName: 'Prompt', kind: 'slot', enabled: true, inputKey: 'prompt', role: 'user' }],
};
afterEach(() => {
  registry.delete('reply-fail-test');
  providers.delete('reply-test');
  vi.restoreAllMocks();
});

describe('multiple chat outputs', () => {
  it('requires one input and at least one output, but allows multiple outputs', async () => {
    expect(await validateWorkflow(graph([node('input', 'chat-input')], []))).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('chat-output node') }),
    );
    expect(
      await validateWorkflow(
        graph([node('input', 'chat-input'), node('a'), node('b')], [edge('input', 'a'), edge('input', 'b')]),
      ),
    ).toEqual([]);
  });
  it('runs the upstream union, skipping unrelated nodes', async () => {
    const run = vi.spyOn(memory, 'execute');
    const result = await executeWorkflow(
      graph(
        [
          node('input', 'chat-input'),
          node('a'),
          node('memory', 'memory', { format: 'messages' }),
          node('b'),
          node('unused', 'memory'),
        ],
        [edge('input', 'a'), edge('memory', 'b', 'history')],
      ),
      options,
    );
    expect(result.replies.map((reply) => reply.nodeId)).toEqual(['a', 'b']);
    expect(result.execution.nodes.memory?.status).toBe('completed');
    expect(result.execution.nodes.unused?.status).toBe('skipped');
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('orders dependency-ready outputs by order then node id, independent of stored node order', async () => {
    const result = await executeWorkflow(
      graph(
        [
          node('input', 'chat-input'),
          node('z', 'chat-output', { order: 2 }),
          node('b'),
          node('a'),
          node('first', 'chat-output', { order: -1 }),
        ],
        ['z', 'b', 'a', 'first'].map((id) => edge('input', id)),
      ),
      options,
    );
    expect(result.replies.map((reply) => reply.nodeId)).toEqual(['first', 'a', 'b', 'z']);
  });
  it('does not order parallel outputs by finish time', async () => {
    const output = registry.get('chat-output')!;
    const execute = output.execute;
    const finished: string[] = [];
    vi.spyOn(output, 'execute').mockImplementation(async (ctx) => {
      if (ctx.config.name === 'slow') await new Promise((resolve) => setTimeout(resolve, 20));
      const value = await execute(ctx);
      finished.push(String(ctx.config.name));
      return value;
    });
    const result = await executeWorkflow(
      graph(
        [
          node('input', 'chat-input'),
          node('a', 'chat-output', { name: 'slow' }),
          node('b', 'chat-output', { name: 'fast' }),
        ],
        [edge('input', 'a'), edge('input', 'b')],
      ),
      options,
    );
    expect(finished).toEqual(['fast', 'slow']);
    expect(result.replies.map((reply) => reply.name)).toEqual(['slow', 'fast']);
  });
  it('orders by dependencies before configured order, and chains replies into a later LLM', async () => {
    const chat = vi.fn(async (request) => ({ text: `bar(${request.messages[0].content})`, raw: {} }));
    providers.set('reply-test', { id: 'reply-test', label: 'Test', secretName: 'test', chat });
    const result = await executeWorkflow(
      graph(
        [
          node('input', 'chat-input'),
          node('bar', 'chat-output', { order: -10, name: 'bar' }),
          node('llm', 'llm', { presetId: preset.id, provider: 'reply-test' }),
          node('foo', 'chat-output', { order: 10, name: 'foo' }),
        ],
        [edge('input', 'foo'), edge('foo', 'llm', 'reply', 'prompt'), edge('llm', 'bar', 'text')],
      ),
      { ...options, resources: { presets: { get: async () => preset } } },
    );
    expect(result.replies).toEqual([
      { nodeId: 'foo', content: 'hello', name: 'foo' },
      { nodeId: 'bar', content: 'bar(hello)', name: 'bar' },
    ]);
  });
  it('orders outputs fed by a shared upstream node by dependency, not by order config', async () => {
    const chat = vi.fn(async (request) => ({ text: `second(${request.messages[0].content})`, raw: {} }));
    providers.set('reply-test', { id: 'reply-test', label: 'Test', secretName: 'test', chat });
    const result = await executeWorkflow(
      graph(
        [
          node('input', 'chat-input'),
          node('first', 'chat-output', { order: 10, name: 'first' }),
          node('llm', 'llm', { presetId: preset.id, provider: 'reply-test' }),
          node('second', 'chat-output', { order: -10, name: 'second' }),
        ],
        [edge('input', 'first'), edge('input', 'llm', 'message', 'prompt'), edge('llm', 'second', 'text')],
      ),
      { ...options, resources: { presets: { get: async () => preset } } },
    );
    expect(result.replies.map((reply) => reply.name)).toEqual(['first', 'second']);
  });
  it('omits skipped condition outputs', async () => {
    const result = await executeWorkflow(
      graph(
        [
          node('input', 'chat-input'),
          node('condition', 'condition', { left: '{{input.value}}', right: 'hello' }),
          node('yes'),
          node('no'),
        ],
        [edge('input', 'condition'), edge('condition', 'yes', 'true'), edge('condition', 'no', 'false')],
      ),
      options,
    );
    expect(result.replies).toEqual([{ nodeId: 'yes', content: 'hello' }]);
    expect(result.execution.nodes.no?.status).toBe('skipped');
    expect(result.execution.warnings).toEqual([]);
  });
  it('allows zero executed outputs and records a warning', async () => {
    const result = await executeWorkflow(
      graph(
        [
          node('input', 'chat-input'),
          node('condition', 'condition', { left: '{{input.value}}', right: 'other' }),
          node('output'),
        ],
        [edge('input', 'condition'), edge('condition', 'output', 'true')],
      ),
      options,
    );
    expect(result.replies).toEqual([]);
    expect(result.execution.status).toBe('completed');
    expect(result.execution.warnings).toEqual([expect.stringContaining('No Chat Output nodes ran')]);
  });
  it('keeps completed replies on a downstream failure', async () => {
    registry.set('reply-fail-test', {
      type: 'reply-fail-test',
      label: 'Fail',
      description: '',
      category: 'Test',
      inputs: [{ name: 'value', label: 'Value', dataType: 'text' }],
      outputs: [{ name: 'text', label: 'Text', dataType: 'text' }],
      configSchema: z.object({}),
      defaultConfig: {},
      async execute() {
        throw new Error('later failure');
      },
    });
    const failure = await executeWorkflow(
      graph(
        [
          node('input', 'chat-input'),
          node('foo', 'chat-output', { name: 'foo' }),
          node('fail', 'reply-fail-test'),
          node('bar'),
        ],
        [edge('input', 'foo'), edge('foo', 'fail', 'reply'), edge('fail', 'bar', 'text')],
      ),
      options,
    ).catch((error) => error);
    expect(failure).toBeInstanceOf(ExecutionFailure);
    expect(failure.replies).toEqual([{ nodeId: 'foo', content: 'hello', name: 'foo' }]);
    expect(failure.execution.status).toBe('error');
    expect(failure.execution.nodes.foo.status).toBe('completed');
  });
  it('keeps same-wave completions but never emits cancelled output messages', async () => {
    const output = registry.get('chat-output')!;
    const execute = output.execute;
    vi.spyOn(output, 'execute').mockImplementation(async (ctx) => {
      if (ctx.config.name === 'slow') await new Promise((resolve) => setTimeout(resolve, 30));
      return execute(ctx);
    });
    vi.spyOn(registry.get('http-request')!, 'execute').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error('parallel failure');
    });
    const failure = await executeWorkflow(
      graph(
        [
          node('input', 'chat-input'),
          node('fast'),
          node('slow', 'chat-output', { name: 'slow' }),
          node('fail', 'http-request', { url: 'https://example.com' }),
          node('after'),
        ],
        [
          edge('input', 'fast'),
          edge('input', 'slow'),
          edge('input', 'fail', 'message', 'input'),
          edge('fail', 'after', 'body'),
        ],
      ),
      options,
    ).catch((error) => error);
    expect(failure.replies).toEqual([{ nodeId: 'fast', content: 'hello' }]);
    expect(failure.execution.nodes.slow.status).toBe('cancelled');
    const snapshot = structuredClone(failure.replies);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(failure.replies).toEqual(snapshot);
  });
  it.each([undefined, 'configured'])(
    'uses optional configured names without inferring a session speaker (%s)',
    async (name) => {
      const result = await executeWorkflow(
        graph(
          [node('input', 'chat-input'), node('output', 'chat-output', { ...(name ? { name } : {}) })],
          [edge('input', 'output')],
        ),
        { ...options, character: card() },
      );
      expect(result.replies).toEqual([{ nodeId: 'output', content: 'hello', ...(name ? { name } : {}) }]);
    },
  );
  it('uses a connected character name before configuration and snapshots the character id', async () => {
    const result = await executeWorkflow(
      graph(
        [
          node('input', 'chat-input'),
          node('character', 'character'),
          node('output', 'chat-output', { name: 'ignored' }),
        ],
        [edge('input', 'output'), edge('character', 'output', 'character', 'character')],
      ),
      { ...options, character: card() },
    );
    expect(result.replies).toEqual([{ nodeId: 'output', content: 'hello', name: 'Rin', characterId: 'card' }]);
  });
});

describe('character nodes and history', () => {
  it.each(['session', 'card'] as const)('loads a %s character', async (source) => {
    const selected = card();
    const result = await executeWorkflow(
      graph(
        [
          node('input', 'chat-input'),
          node('character', 'character', { source, characterId: selected.id }),
          node('output'),
        ],
        [edge('input', 'output'), edge('character', 'output', 'character', 'character')],
      ),
      {
        ...options,
        character: source === 'session' ? selected : card('session', 'Other'),
        resources: { presets: { get: async () => undefined }, characters: { get: async () => selected } },
      },
    );
    expect(result.replies[0]).toMatchObject({ name: 'Rin', characterId: 'card' });
  });
  it('fails clearly when the session character is missing', async () => {
    await expect(
      executeWorkflow(
        graph(
          [node('input', 'chat-input'), node('character', 'character'), node('output')],
          [edge('input', 'output'), edge('character', 'output', 'character', 'character')],
        ),
        options,
      ),
    ).rejects.toThrow('No session character selected');
  });
  it('validates missing card resources and empty card selection', async () => {
    const workflow = graph(
      [
        node('input', 'chat-input'),
        node('character', 'character', { source: 'card', characterId: 'missing' }),
        node('output'),
      ],
      [edge('input', 'output'), edge('character', 'output', 'character', 'character')],
    );
    expect(await validateWorkflow(workflow)).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('Character missing not found') }),
    );
    workflow.nodes[1]!.config.characterId = '';
    expect((await validateWorkflow(workflow)).map((issue) => issue.message).join(' ')).toContain(
      'Select a character card',
    );
  });
  it.each([false, true])('renders all character macros from the LLM render context (override=%s)', async (override) => {
    const chat = vi.fn(async () => ({ text: 'reply', raw: {} }));
    providers.set('reply-test', { id: 'reply-test', label: 'Test', secretName: 'test', chat });
    const definition: Preset = {
      ...preset,
      inputs: [],
      entries: [
        {
          id: 'macros',
          displayName: 'Macros',
          kind: 'message',
          enabled: true,
          role: 'system',
          placement: { mode: 'ordered' },
          content: '{{character.name}}/{{char}}/{{description}}/{{personality}}/{{scenario}}',
        },
      ],
    };
    const result = await executeWorkflow(
      graph(
        [
          node('input', 'chat-input'),
          node('character', 'character', { source: 'card', characterId: 'override' }),
          node('llm', 'llm', { presetId: preset.id, provider: 'reply-test' }),
          node('output'),
        ],
        [edge('llm', 'output', 'text'), ...(override ? [edge('character', 'llm', 'character', 'character')] : [])],
      ),
      {
        ...options,
        character: card('session', 'Session'),
        resources: {
          presets: { get: async () => definition },
          characters: { get: async () => card('override', 'Override') },
        },
      },
    );
    const name = override ? 'Override' : 'Session';
    expect(result.execution.nodes.llm?.request).toMatchObject({
      messages: [{ role: 'system', content: `${name}/${name}/Description of ${name}/Kind/Garden` }],
    });
  });
  it('preserves history names through Memory, Chat Input, and preset message slots', async () => {
    const history: ChatMessage[] = [
      { id: '1', role: 'assistant', content: 'Hi', name: 'foo', characterId: 'card', createdAt: '' },
    ];
    const context = {
      ...options,
      nodeId: 'memory',
      history,
      config: { lastN: 10, format: 'messages' },
      inputs: {},
      trigger: { message: '', sessionId: '' },
      resources: { presets: { get: async () => undefined } },
      signal: new AbortController().signal,
      log: () => {},
      emit: () => {},
      recordRequest: () => {},
    } satisfies ExecutionContext;
    const fromMemory = (await memory.execute(context)).history;
    const fromInput = (await registry.get('chat-input')!.execute(context)).history;
    const historyPreset: Preset = {
      ...preset,
      inputs: [{ id: 'history', key: 'history', dataType: 'messages' }],
      entries: [
        { id: 'history', displayName: 'History', kind: 'slot', enabled: true, inputKey: 'history', role: 'user' },
      ],
    };
    for (const value of [fromMemory, fromInput]) {
      expect(
        renderPreset(historyPreset, {
          inputs: { history: value },
          templateContext: { trigger: { message: '', sessionId: '' } },
        }),
      ).toEqual([{ role: 'assistant', content: 'Hi', name: 'foo' }]);
    }
  });
});
