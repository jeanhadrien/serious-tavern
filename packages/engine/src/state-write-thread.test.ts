import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ConversationMessage, PortDef, StateDefinition } from '@st/shared';
import { executeWorkflow } from './executor.js';
import { stateRead } from './nodes/state-read/index.js';
import { stateWrite } from './nodes/state-write/index.js';
import { registry } from './registry.js';
import { edge, graph, node, runNode } from './test-collections.js';
import { snapshotOf, stateResources } from './test-state.js';

const ID = '33333333-3333-4333-8333-333333333333';
const definition: StateDefinition = {
  id: ID,
  name: 'story',
  keys: { notes: { type: 'collection' }, thread: { type: 'thread', cap: 5 } },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};
const resources = stateResources(definition);
const target = { kind: 'definition' as const, definitionId: ID, key: 'thread' };
const config = (op: string, extra: Record<string, unknown> = {}) => ({ definitionId: ID, key: 'thread', op, ...extra });
const mark = (port: PortDef) =>
  `${port.name}:${port.dataType}${port.required ? '!' : port.requiredIfConnected ? '~' : ''}${port.optional ? '?' : ''}`;

const provenance = { providerId: 'openrouter', model: 'm', nodeId: 'llm' };
const exchange = (): ConversationMessage[] => [
  {
    role: 'assistant',
    content: '',
    reasoning: 'let me look',
    provider_data: { reasoning_details: [{ blob: 'x' }] },
    provenance,
    tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_state', arguments: '{}' } }],
  },
  { role: 'tool', content: 'calm', tool_call_id: 'c1' },
  { role: 'assistant', content: 'It is calm.', reasoning: 'done', provenance },
];

const run = (inputs: Record<string, unknown>, extra: Record<string, unknown> = {}, op = 'add') =>
  runNode(stateWrite, config(op, extra), { resources, state: snapshotOf([definition]), inputs });

describe('State Write on a thread key: ports', () => {
  // `!` required, `~` required only when connected.
  it.each([
    ['add', ['value:messages!', 'input:any~', 'when:any~'], ['value:object']],
    ['remove', ['value:text!', 'when:any~'], ['value:object?']],
    ['delete', ['when:any~'], ['value:array']],
  ])('%s takes %j and gives %j', async (op, inputs, outputs) => {
    const ports = await stateWrite.resolvePorts!(config(op), resources);
    expect(ports.inputs.map(mark)).toEqual(inputs);
    expect(ports.outputs.map(mark)).toEqual(outputs);
  });

  it('offers no fixed value: a stored one changes nothing', async () => {
    const ports = await stateWrite.resolvePorts!(config('add', { value: 'text' }), resources);
    expect(ports.inputs.map(mark)).toEqual(['value:messages!', 'input:any~', 'when:any~']);
  });

  it('does not offer the thread inputs on a collection key', async () => {
    const ports = await stateWrite.resolvePorts!({ definitionId: ID, key: 'notes', op: 'add' }, resources);
    expect(ports.inputs.map((port) => port.name)).toEqual(['value', 'messages', 'when']);
  });

  it('refuses set and increment', async () => {
    await expect(stateWrite.resolvePorts!(config('set'), resources)).rejects.toThrow(
      `Operation "set" can't be used on a thread key; use add, remove or delete`,
    );
  });
});

describe('State Write on a thread key: add', () => {
  it('stores the exchange without reasoning or provider data, stamped with the turn and the run', async () => {
    const result = await run({ value: exchange() });
    const [first] = exchange();
    const { reasoning: _a, provider_data: _b, ...firstStep } = first!;
    expect(result.writes).toEqual([
      {
        op: 'add',
        target,
        nodeId: 'state-write',
        item: {
          id: 'run:state-write:1',
          text: 'It is calm.',
          exchange: [
            firstStep,
            { role: 'tool', content: 'calm', tool_call_id: 'c1' },
            { role: 'assistant', content: 'It is calm.', provenance },
          ],
          turnId: 'run',
          runId: 'run',
        },
      },
    ]);
    expect(result.output.value).toEqual((result.writes[0] as { item: unknown }).item);
  });

  it('keeps reasoning and provider data when asked to', async () => {
    const result = await run({ value: exchange() }, { keepReasoning: true });
    expect(result.writes[0]).toMatchObject({ item: { exchange: exchange() } });
  });

  it('stores the input as a user message, from text or from a message', async () => {
    const text = await run({ value: exchange(), input: 'What now?' });
    expect(text.writes[0]).toMatchObject({ item: { input: { role: 'user', content: 'What now?' } } });
    const message = await run({
      value: exchange(),
      input: { id: 'm1', role: 'user', content: 'Hello', name: 'Ann', createdAt: 'x', status: 'final' },
    });
    expect(message.writes[0]).toMatchObject({ item: { input: { role: 'user', content: 'Hello', name: 'Ann' } } });
    // Nothing else of the chat message comes along.
    expect(JSON.stringify(message.writes[0])).not.toContain('createdAt');
  });

  it('stores no input for blank text', async () => {
    const result = await run({ value: exchange(), input: '  ' });
    expect(result.writes[0]).not.toHaveProperty('item.input');
  });

  it('logs how long the exchange was', async () => {
    expect((await run({ value: exchange() })).logs).toEqual([
      'story.thread: adding an exchange of 2 steps and 1 tool call: It is calm.',
    ]);
  });

  it.each<[string, unknown, string]>([
    ['text', 'hello', 'story.thread needs a list of messages (the exchange of an LLM node), got text'],
    [
      'an object',
      { role: 'assistant' },
      'story.thread needs a list of messages (the exchange of an LLM node), got an object',
    ],
    ['an empty list', [], 'story.thread needs at least one message in the exchange'],
    ['a list with a stray value', ['hi'], 'story.thread needs messages only, but message 1 is not valid'],
    [
      'a tool message with no call',
      [{ role: 'tool', content: 'x' }],
      'story.thread needs messages only, but message 1 is not valid: A tool message needs the tool_call_id',
    ],
  ])('refuses %s', async (_, value, message) => {
    await expect(run({ value })).rejects.toThrow(message);
  });

  it('refuses an input that is neither text nor a message', async () => {
    await expect(run({ value: exchange(), input: 4 })).rejects.toThrow(
      'story.thread needs the input to be text or one message',
    );
  });
});

describe('State Write on a thread key: remove and delete', () => {
  const held = [{ id: 'e1', text: 'one', exchange: exchange() }];
  const withHeld = snapshotOf([definition], { keys: { 'story.thread': { value: held } } });
  const runHeld = (op: string, value?: unknown) =>
    runNode(stateWrite, config(op), { resources, state: withHeld, inputs: value === undefined ? {} : { value } });

  it('removes an exchange by its id', async () => {
    const result = await runHeld('remove', 'e1');
    expect(result.writes).toEqual([{ op: 'remove', target, nodeId: 'state-write', itemId: 'e1' }]);
    expect(result.output.value).toEqual(held[0]);
  });

  it('removes nothing for an unknown id', async () => {
    const result = await runHeld('remove', 'nope');
    expect(result.writes).toEqual([]);
    expect(result.logs[0]).toContain('no item has the id');
  });

  it('empties the thread', async () => {
    const result = await runHeld('delete');
    expect(result.writes).toEqual([{ op: 'delete', target, nodeId: 'state-write' }]);
    expect(result.output.value).toEqual([]);
  });
});

describe('thread items in a run', () => {
  it('are stamped with the turn id the caller gave and the run id', async () => {
    registry.set('exchange-source', {
      type: 'exchange-source',
      label: 'Exchange',
      description: '',
      category: '',
      inputs: [],
      outputs: [{ name: 'exchange', label: 'Exchange', dataType: 'messages' }],
      configSchema: z.object({}),
      defaultConfig: {},
      async execute() {
        return { exchange: exchange() };
      },
    });
    const flow = graph(
      [
        node('input', 'chat-input'),
        node('source', 'exchange-source'),
        node('write', 'state-write', { definitionId: ID, key: 'thread', op: 'add' }),
      ],
      [edge('source', 'exchange', 'write', 'value'), edge('input', 'message', 'write', 'input')],
    );
    const result = await executeWorkflow(flow, {
      message: 'Hi there',
      sessionId: 's',
      history: [],
      secrets: { get: async () => undefined },
      resources,
      executionId: 'run-7',
      turnId: 'turn-3',
      state: snapshotOf([definition]),
    });
    expect(result.writes).toHaveLength(1);
    expect(result.writes[0]).toMatchObject({
      op: 'add',
      item: {
        id: 'run-7:write:1',
        text: 'It is calm.',
        turnId: 'turn-3',
        runId: 'run-7',
        input: { role: 'user', content: 'Hi there' },
      },
    });
  });
});

describe('State Read on a thread key', () => {
  const held = [
    { id: 'e2', text: 'two', exchange: exchange() },
    { id: 'e1', text: 'one', exchange: exchange() },
  ];
  const state = snapshotOf([definition], {
    keys: { 'story.thread': { value: held, meta: { written: true, count: 2, turnsSinceWrite: 1, writtenAtTurn: 1 } } },
  });
  const read = (extra: Record<string, unknown>) =>
    runNode(stateRead, { definitionId: ID, key: 'thread', ...extra }, { resources, state });

  it('reads the items like a collection, and counts them', async () => {
    expect((await read({})).output.value).toEqual(held);
    expect(await read({ read: 'meta' }).then((result) => result.output.count)).toBe(2);
  });

  it('has no linked read', async () => {
    await expect(read({ read: 'linked' })).rejects.toThrow('"linked" needs a collection key');
  });
});
