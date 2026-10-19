import { describe, expect, it } from 'vitest';
import type { Access, Character, Preset, Resource, StateDefinition, Workflow } from '@st/shared';
import { workflowAccess } from './access.js';
import { prepareWorkflow } from './prepare.js';
import { registry } from './registry.js';
import type { NodeAccessInfo, NodeResources } from './types.js';

const scene: StateDefinition = {
  id: 'scene-id',
  name: 'scene',
  keys: { tension: { type: 'number' }, log: { type: 'collection' } },
  createdAt: '',
  updatedAt: '',
};
const key = (name: string): Resource => ({ kind: 'key', definitionId: 'scene-id', key: name });
const messages: Resource = { kind: 'messages' };
const info = (...connected: string[]): NodeAccessInfo => ({
  connected: new Set(connected),
  definition: (id) => (id === scene.id ? scene : undefined),
});
const accessOf = (type: string, config: Record<string, unknown>, ...connected: string[]): Access =>
  registry.get(type)!.access(config, info(...connected));

describe('every node declares its access', () => {
  it('has an access function on every registered node (a node cannot forget it)', () => {
    for (const [type, definition] of registry) {
      expect(typeof definition.access, type).toBe('function');
      const { reads, writes } = definition.access(definition.defaultConfig, info());
      expect(Array.isArray(reads) && Array.isArray(writes), type).toBe(true);
    }
  });

  it('puts every node that renders templates through templateFields or a template hook', () => {
    const rendering = [...registry].filter(
      ([, definition]) => definition.templateFields || definition.resourceTemplates,
    );
    expect(rendering.map(([type]) => type).sort()).toEqual([
      'character',
      'chat-output',
      'condition',
      'http-request',
      'llm',
    ]);
  });
});

describe('what each node touches', () => {
  const table: [string, string, Record<string, unknown>, string[], Access][] = [
    ['Chat Input with only its message', 'chat-input', {}, ['message', 'turn'], { reads: [], writes: [] }],
    ['Chat Input with its history', 'chat-input', {}, ['history'], { reads: [messages], writes: [] }],
    ['Chat Input with the replies above', 'chat-input', {}, ['replies'], { reads: [messages], writes: [] }],
    ['Chat Output', 'chat-output', {}, [], { reads: [], writes: [messages] }],
    ['Memory', 'memory', {}, [], { reads: [messages], writes: [] }],
    ['Recall', 'recall', {}, [], { reads: [messages], writes: [] }],
    [
      'State Read of a number',
      'state-read',
      { definitionId: 'scene-id', key: 'tension', read: 'value' },
      [],
      {
        reads: [key('tension')],
        writes: [],
      },
    ],
    [
      'State Read of a collection',
      'state-read',
      { definitionId: 'scene-id', key: 'log', read: 'value' },
      [],
      {
        reads: [key('log'), messages],
        writes: [],
      },
    ],
    [
      'State Read of a collection, linked',
      'state-read',
      { definitionId: 'scene-id', key: 'log', read: 'linked' },
      [],
      {
        reads: [key('log'), messages],
        writes: [],
      },
    ],
    [
      'State Read of a collection, facts only',
      'state-read',
      { definitionId: 'scene-id', key: 'log', read: 'meta' },
      [],
      {
        reads: [key('log')],
        writes: [],
      },
    ],
    [
      'State Write set',
      'state-write',
      { definitionId: 'scene-id', key: 'tension', op: 'set' },
      [],
      {
        reads: [],
        writes: [key('tension')],
      },
    ],
    [
      'State Write increment (it reads the value it adds to)',
      'state-write',
      { definitionId: 'scene-id', key: 'tension', op: 'increment' },
      [],
      {
        reads: [key('tension')],
        writes: [key('tension')],
      },
    ],
    [
      'State Write add',
      'state-write',
      { definitionId: 'scene-id', key: 'log', op: 'add' },
      [],
      {
        reads: [],
        writes: [key('log')],
      },
    ],
    [
      'State Write remove (it looks the item up)',
      'state-write',
      { definitionId: 'scene-id', key: 'log', op: 'remove' },
      [],
      {
        reads: [key('log')],
        writes: [key('log')],
      },
    ],
    [
      'State Write delete',
      'state-write',
      { definitionId: 'scene-id', key: 'log', op: 'delete' },
      [],
      {
        reads: [],
        writes: [key('log')],
      },
    ],
    [
      'Next Chunk',
      'next-chunk',
      { definitionId: 'scene-id', key: 'log' },
      [],
      { reads: [key('log'), messages], writes: [] },
    ],
    [
      'Unlinked Messages',
      'unlinked-messages',
      { definitionId: 'scene-id', key: 'log' },
      [],
      {
        reads: [key('log'), messages],
        writes: [],
      },
    ],
  ];
  it.each(table)('%s', (_name, type, config, connected, expected) => {
    expect(accessOf(type, config, ...connected)).toEqual(expected);
  });

  it('keeps the memory of Draw and Trigger private: no shared access', () => {
    for (const type of ['draw', 'trigger'])
      expect(accessOf(type, registry.get(type)!.defaultConfig)).toEqual({ reads: [], writes: [] });
  });

  it.each([
    'condition',
    'http-request',
    'llm',
    'merge',
    'parse-json',
    'pick-fields',
    'random',
    'chat-settings',
    'character',
  ])('%s touches nothing besides what its templates read', (type) => {
    expect(accessOf(type, registry.get(type)!.defaultConfig)).toEqual({ reads: [], writes: [] });
  });

  it('treats a State Read of a key it cannot look up as a possible collection', () => {
    const unknown = registry
      .get('state-read')!
      .access({ definitionId: 'gone', key: 'x', read: 'value' }, { connected: new Set(), definition: () => undefined });
    expect(unknown.reads).toEqual([{ kind: 'key', definitionId: 'gone', key: 'x' }, messages]);
  });
});

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  config,
  position: { x: 0, y: 0 },
});
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({
  id: `${source}-${target}-${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});
const workflow = (nodes: ReturnType<typeof node>[], edges: ReturnType<typeof edge>[] = []): Workflow => ({
  id: 'wf',
  name: 'Access',
  createdAt: '',
  updatedAt: '',
  nodes,
  edges,
});
const resources = (extra: Partial<NodeResources> = {}): NodeResources => ({
  presets: { get: async () => undefined },
  stateDefinitions: { get: async (id) => (id === scene.id ? scene : undefined), list: async () => [scene] },
  ...extra,
});
const prepared = async (flow: Workflow, given = resources()) => {
  const { errors, prepared } = await prepareWorkflow(flow, given);
  expect(errors).toEqual([]);
  return prepared!;
};
const reply = (template: string) => [node('input', 'chat-input'), node('output', 'chat-output', { template })];
const toOutput = [edge('input', 'message', 'output', 'value')];

describe('PreparedWorkflow.access', () => {
  it('combines the nodes that run: a replying workflow writes the chat and reads nothing', async () => {
    expect((await prepared(workflow(reply('hello'), toOutput))).access).toEqual({ reads: [], writes: [messages] });
  });

  it('adds the reads of the templates a node renders', async () => {
    const flow = workflow(reply('{{state.scene.tension}} {{history}}'), toOutput);
    expect((await prepared(flow)).access).toEqual({ reads: [key('tension'), messages], writes: [messages] });
  });

  it('reads all the state for a state reference when the definitions cannot be listed', async () => {
    const flow = workflow(reply('{{state.scene.tension}}'), toOutput);
    const given = resources({ stateDefinitions: { get: async (id) => (id === scene.id ? scene : undefined) } });
    expect((await prepared(flow, given)).access.reads).toEqual([{ kind: 'state' }, messages]);
  });

  it('reads the templates of the preset an LLM node uses, enabled entries only', async () => {
    const presetId = '11111111-1111-4111-8111-111111111111';
    const preset: Preset = {
      id: presetId,
      name: 'P',
      inputs: [],
      entries: [
        {
          id: 'a',
          displayName: 'A',
          enabled: true,
          kind: 'message',
          role: 'system',
          content: 'T={{state.scene.tension}}',
          placement: { mode: 'ordered' },
        },
        {
          id: 'b',
          displayName: 'B',
          enabled: true,
          kind: 'message',
          role: 'user',
          content: 'x',
          name: '{{history}}',
          placement: { mode: 'ordered' },
        },
        {
          id: 'c',
          displayName: 'C',
          enabled: false,
          kind: 'message',
          role: 'user',
          content: '{{state.scene.log}}',
          placement: { mode: 'ordered' },
        },
      ],
      createdAt: '',
      updatedAt: '',
    };
    const flow = workflow(
      [node('input', 'chat-input'), node('llm', 'llm', { presetId }), node('output', 'chat-output')],
      [edge('llm', 'text', 'output', 'value')],
    );
    const { access } = await prepared(flow, resources({ presets: { get: async () => preset } }));
    expect(access.reads).toEqual([key('tension'), messages]);
  });

  it('reads the fields of a character card a Character node names', async () => {
    const card = { id: 'c1', name: 'Ann', description: '{{state.scene.tension}}' } as unknown as Character;
    const flow = workflow(
      [
        node('input', 'chat-input'),
        node('card', 'character', { source: 'card', characterId: 'c1' }),
        node('output', 'chat-output'),
      ],
      [edge('card', 'character', 'output', 'character'), edge('input', 'message', 'output', 'value')],
    );
    const given = resources({ characters: { get: async () => card } });
    expect((await prepared(flow, given)).access.reads).toEqual([key('tension')]);
  });

  it('counts only the nodes that run: a template on a node no sink needs reads nothing', async () => {
    const flow = workflow(
      [...reply('hello'), node('idle', 'condition', { left: '{{history}}', right: 'x' })],
      toOutput,
    );
    expect((await prepared(flow)).access.reads).toEqual([]);
  });

  it('reads the key a State Write increments, and writes it', async () => {
    const flow = workflow(
      [
        node('input', 'chat-input'),
        node('bump', 'state-write', { definitionId: 'scene-id', key: 'tension', op: 'increment' }),
      ],
      [],
    );
    expect((await prepared(flow)).access).toEqual({ reads: [key('tension')], writes: [key('tension')] });
  });

  it('reads and writes everything for a node of an unknown type', async () => {
    const flow = workflow([node('input', 'chat-input'), node('mystery', 'no-such-node')]);
    const access = await workflowAccess({
      workflow: flow,
      reachable: new Set(['input', 'mystery']),
      definitions: new Map([['input', registry.get('chat-input')!]]),
      resources: resources(),
    });
    expect(access).toEqual({ reads: [{ kind: 'everything' }], writes: [{ kind: 'everything' }] });
  });
});
