import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@st/shared';
import { executeWorkflow, validateWorkflow } from './executor.js';
import { stateWrite } from './nodes/state-write/index.js';
import { edge, graph, node, runNode } from './test-collections.js';
import { SCENE_ID, sceneDefinition, snapshotOf, stateResources } from './test-state.js';

const resources = stateResources(sceneDefinition);
const target = (key: string) => ({ kind: 'definition' as const, definitionId: SCENE_ID, key });
const config = (key: string, op = 'add') => ({ definitionId: SCENE_ID, key, op });
const run = (key: string, inputs: Record<string, unknown>, op = 'add') =>
  runNode(stateWrite, config(key, op), { resources, state: snapshotOf([sceneDefinition]), inputs });
const message = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  role: 'assistant',
  content: `reply ${id}`,
  createdAt: '',
  ...extra,
});
const stored = (messages: unknown, text = 'a summary') => ({
  op: 'add',
  target: target('plain'),
  nodeId: 'state-write',
  item: { id: 'run:state-write:1', text, messages },
});

describe('State Write: linking an item to messages', () => {
  it.each<[string, unknown, unknown]>([
    [
      'a link with its fingerprint',
      { ids: ['m1', 'm2'], fingerprint: 'abc' },
      { ids: ['m1', 'm2'], fingerprint: 'abc' },
    ],
    ['a link without a fingerprint', { ids: ['m1'] }, { ids: ['m1'] }],
    [
      'a link with other properties (Next Chunk could add some)',
      { ids: ['m1'], fingerprint: 'f', note: 1 },
      { ids: ['m1'], fingerprint: 'f' },
    ],
    ['one message', message('m7'), { ids: ['m7'] }],
    ['a list of messages, in order', [message('m3'), message('m1')], { ids: ['m3', 'm1'] }],
    ['a list that repeats a message', [message('m3'), message('m3')], { ids: ['m3'] }],
  ])('stores the link of %s', async (_, given, link) => {
    const result = await run('plain', { value: 'a summary', messages: given });
    expect(result.writes).toEqual([stored(link)]);
    expect(result.output.value).toEqual({ id: 'run:state-write:1', text: 'a summary', messages: link });
  });

  it('says in the node log that the item is linked', async () => {
    expect((await run('plain', { value: 'a summary', messages: [message('a'), message('b')] })).logs[0]).toBe(
      'scene.plain: adding a summary (linked to 2 messages)',
    );
    expect((await run('plain', { value: 'a summary', messages: message('a') })).logs[0]).toContain(
      '(linked to 1 message)',
    );
  });

  it('stores no link when the input is not connected', async () => {
    const result = await run('plain', { value: 'a summary' });
    expect(result.writes).toEqual([
      {
        op: 'add',
        target: target('plain'),
        nodeId: 'state-write',
        item: { id: 'run:state-write:1', text: 'a summary' },
      },
    ]);
  });

  it('keeps the declared fields next to the link', async () => {
    const result = await run('injected', { value: { text: 'a storm', level: 2 }, messages: { ids: ['m1'] } });
    expect(result.writes[0]).toMatchObject({ item: { text: 'a storm', level: 2, messages: { ids: ['m1'] } } });
  });

  it.each<[string, unknown, string]>([
    ['text', 'm1', 'scene.plain: Messages needs a link (ids), a message or a list of messages, got text'],
    ['a number', 4, 'scene.plain: Messages needs a link (ids), a message or a list of messages, got a number'],
    ['a boolean', true, 'scene.plain: Messages needs a link (ids), a message or a list of messages, got true'],
    ['null', null, 'scene.plain: Messages needs a link (ids), a message or a list of messages, got null'],
    [
      'an object that is neither',
      { text: 'hi' },
      'scene.plain: Messages needs a link (ids), a message or a list of messages, got an object',
    ],
    [
      'an object with an id but no role',
      { id: 'm1' },
      'scene.plain: Messages needs a link (ids), a message or a list of messages, got an object',
    ],
    ['an empty list', [], 'scene.plain: Messages is an empty list, so there is nothing to link to'],
    ['a list of ids', ['m1'], 'scene.plain: Messages can only hold messages, got text in the list'],
    [
      'a list with a stranger',
      [message('m1'), 3],
      'scene.plain: Messages can only hold messages, got a number in the list',
    ],
    ['a link with no ids', { ids: [] }, 'scene.plain: the link on Messages needs a list of message ids, got an array'],
    [
      'a link whose ids are not a list',
      { ids: 'm1' },
      'scene.plain: the link on Messages needs a list of message ids, got text',
    ],
    [
      'a link with a number for an id',
      { ids: ['m1', 2] },
      'scene.plain: the link on Messages needs a list of message ids, got an array',
    ],
    [
      'a link with an empty id',
      { ids: [''] },
      'scene.plain: the link on Messages needs a list of message ids, got an array',
    ],
    [
      'a link with a fingerprint that is not text',
      { ids: ['m1'], fingerprint: 5 },
      'scene.plain: the link on Messages has a fingerprint that is not text, got a number',
    ],
  ])('fails, naming the key and what it got, for %s', async (_, given, message) => {
    await expect(run('plain', { value: 'a summary', messages: given })).rejects.toThrow(message);
  });

  it("ignores a value's own messages and link properties: links only come from the input", async () => {
    const result = await run('injected', {
      value: { text: 'x', level: 1, messages: { ids: ['m1'], fingerprint: 'f' }, link: { status: 'intact' } },
    });
    expect(result.writes[0]).toMatchObject({ item: { id: 'run:state-write:1', text: 'x', level: 1 } });
    expect(result.writes[0]).not.toHaveProperty('item.messages');
    expect(result.logs).toContain("Left out fields the key doesn't declare: messages, link");
  });

  it('does not link other operations', async () => {
    const result = await run('note', { value: 'hi', messages: { ids: ['m1'] } }, 'set');
    expect(result.writes).toEqual([{ op: 'set', target: target('note'), nodeId: 'state-write', value: 'hi' }]);
  });
});

describe('State Write: the messages input', () => {
  const mark = (port: { name: string; dataType: string; requiredIfConnected?: boolean }) =>
    `${port.name}:${port.dataType}${port.requiredIfConnected ? '~' : ''}`;
  const inputs = async (key: string, op: string) =>
    (await stateWrite.resolvePorts!(config(key, op), resources)).inputs.map(mark);

  it('exists only for add on a collection key, and is required only when connected', async () => {
    expect(await inputs('plain', 'add')).toEqual(['value:any', 'messages:any~', 'when:any~']);
    expect(await inputs('injected', 'add')).toContain('messages:any~');
    for (const [key, op] of [
      ['plain', 'remove'],
      ['plain', 'delete'],
      ['note', 'set'],
      ['tension', 'increment'],
      ['data', 'set'],
    ] as const)
      expect(await inputs(key, op)).not.toContain('messages:any~');
  });

  it('keeps the input when the item has a fixed value', async () => {
    const ports = await stateWrite.resolvePorts!({ ...config('plain'), value: 'fixed' }, resources);
    expect(ports.inputs.map((port) => port.name)).toEqual(['value', 'messages', 'when']);
  });
});

describe('State Write with messages: in a workflow', () => {
  const wired = () =>
    graph(
      [
        node('input', 'chat-input'),
        node('output', 'chat-output'),
        node('gate', 'condition', { operator: 'equals', right: 'go' }),
        node('save', 'state-write', config('plain')),
      ],
      [
        edge('input', 'message', 'output', 'value'),
        edge('input', 'message', 'gate', 'value'),
        edge('input', 'message', 'save', 'value'),
        edge('gate', 'true', 'save', 'messages'),
      ],
    );
  const history: ChatMessage[] = ['a', 'b'].map((id) => ({ id, role: 'user', content: id, createdAt: '' }));

  it('validates', async () => {
    expect(await validateWorkflow(wired(), stateResources(sceneDefinition))).toEqual([]);
  });

  it('is skipped, writing nothing, when the source of the link was not produced', async () => {
    const result = await executeWorkflow(wired(), {
      message: 'nope',
      sessionId: 's',
      history,
      secrets: { get: async () => undefined },
      resources: stateResources(sceneDefinition),
      state: snapshotOf([sceneDefinition]),
    });
    expect(result.execution.nodes.save?.status).toBe('skipped');
    expect(result.writes).toEqual([]);
  });
});
