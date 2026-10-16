import { expect, it } from 'vitest';
import { messageSchema } from '../models.js';
import { apiContract, changeEventTypes, errorEnvelopeSchema, stateDefinitionInUseDetailsSchema } from './index.js';

it('preserves existing entity defaults, including defaults on partial updates', () => {
  expect(apiContract.createCharacter.body.parse({ name: '  Alice  ' })).toMatchObject({
    name: 'Alice',
    description: '',
    tags: [],
    extensions: {},
  });
  expect(apiContract.updateCharacter.body.parse({ name: 'Alice' })).toMatchObject({
    name: 'Alice',
    description: '',
    tags: [],
  });
  expect(apiContract.updatePersona.body.parse({})).toEqual({ description: '' });
});

it('validates preset writes with the same cross-field rules as complete presets', () => {
  const body = { name: 'Preset', inputs: [], entries: [] };
  expect(apiContract.createPreset.body.parse(body)).toEqual(body);
  expect(
    apiContract.updatePreset.body.safeParse({
      ...body,
      entries: [{ id: 'slot', displayName: 'History', enabled: true, kind: 'slot', inputKey: 'missing' }],
    }).success,
  ).toBe(false);
});

it('describes clearable session context, trimmed messages and opaque error details', () => {
  expect(apiContract.updateSession.body.parse({ characterId: null, personaId: null })).toEqual({
    characterId: null,
    personaId: null,
  });

  expect(apiContract.sendMessage.body.parse({ content: ' hi ' })).toEqual({ content: 'hi' });
  expect(errorEnvelopeSchema.parse({ error: { code: 'FAILED', message: 'Failure', details: { node: 'n' } } })).toEqual({
    error: { code: 'FAILED', message: 'Failure', details: { node: 'n' } },
  });
});

it('defines message mutation bodies, both UUID params, and a bodyless delete response', () => {
  const params = { id: '00000000-0000-4000-8000-000000000001', messageId: '00000000-0000-4000-8000-000000000002' };
  expect(apiContract.updateMessage.body.parse({ content: ' edited ' })).toEqual({ content: 'edited' });
  expect(apiContract.updateMessage.body.safeParse({ content: ' \n ' }).success).toBe(false);
  for (const contract of [apiContract.updateMessage, apiContract.deleteMessage]) {
    expect(contract.params.parse(params)).toEqual(params);
    expect(contract.params.safeParse({ ...params, messageId: '../message' }).success).toBe(false);
  }
  expect(apiContract.deleteMessage.response.parse(undefined)).toBeUndefined();
});

it('describes streamed turn events, the stop endpoint and optional streaming message fields', () => {
  const executionFailure = {
    userMessage: { id: 'user', role: 'user', content: 'hi', createdAt: '' },
    assistantMessages: [],
    execution: { id: 'exec', workflowId: 'wf', sessionId: 's', status: 'error', startedAt: '', nodes: {} },
  };
  const events = [
    { type: 'turn.start', executionId: 'exec' },
    { type: 'node.start', nodeId: 'llm' },
    { type: 'node.delta', nodeId: 'llm', textDelta: 'Hel' },
    { type: 'node.delta', nodeId: 'llm', reasoningDelta: 'Plan' },
    { type: 'node.complete', nodeId: 'llm' },
    { type: 'turn.complete', ...executionFailure },
    {
      type: 'turn.error',
      error: { code: 'WORKFLOW_EXECUTION_FAILED', message: 'Failed', details: executionFailure },
    },
  ];
  for (const event of events) expect(apiContract.streamTurn.response.parse(event)).toMatchObject(event);
  expect(apiContract.streamTurn.response.safeParse({ type: 'node.delta', nodeId: 'llm', textDelta: 1 }).success).toBe(
    false,
  );
  expect(apiContract.streamTurn.response.safeParse({ type: 'unknown' }).success).toBe(false);
  expect(apiContract.streamTurn.body.parse({ content: ' hi ' })).toEqual({ content: 'hi' });
  expect(apiContract.stopTurn.response.parse(undefined)).toBeUndefined();
  expect(apiContract.stopTurn.params.safeParse({ id: 'not-a-uuid' }).success).toBe(false);

  const message = { id: 'm', role: 'assistant', content: '', createdAt: '' };
  expect(messageSchema.parse({ ...message, status: 'streaming', reasoning: 'Plan', nodeId: 'llm' })).toMatchObject({
    status: 'streaming',
    reasoning: 'Plan',
    nodeId: 'llm',
  });
  expect(messageSchema.parse(message)).toEqual(message);
  expect(messageSchema.safeParse({ ...message, status: 'pending' }).success).toBe(false);
});

it('describes the change event stream, one event per resource type', () => {
  const event = { type: 'presets.changed', invalidFiles: [{ file: 'broken.yaml', reason: 'bad YAML' }] };
  expect(apiContract.streamChanges.response.parse(event)).toEqual(event);
  expect(apiContract.streamChanges.response.safeParse({ type: 'presets.changed' }).success).toBe(false);
  expect(changeEventTypes).toEqual([
    'presets.changed',
    'providers.changed',
    'collections.changed',
    'stateDefinitions.changed',
    'workflows.changed',
    'characters.changed',
    'personas.changed',
    'sessions.changed',
  ]);
  for (const event of [{ type: 'sessions.changed' }, { type: 'workflows.changed', id: 'abc' }])
    expect(apiContract.streamChanges.response.parse(event)).toEqual(event);
  const collections = { type: 'collections.changed', invalidFiles: [{ file: 'lore.yaml', reason: 'bad' }] };
  expect(apiContract.streamChanges.response.parse(collections)).toEqual(collections);
  expect(apiContract.streamChanges.response.safeParse({ type: 'collections.changed' }).success).toBe(false);
  const definitions = { type: 'stateDefinitions.changed', invalidFiles: [{ file: 'scene.yaml', reason: 'bad' }] };
  expect(apiContract.streamChanges.response.parse(definitions)).toEqual(definitions);
  expect(apiContract.streamChanges.response.safeParse({ type: 'stateDefinitions.changed' }).success).toBe(false);
});

it('describes state definitions: keys are required on a write, defaulted on a stored record', () => {
  const body = { name: 'scene', keys: { tension: { type: 'number', min: 0, max: 10 } } };
  expect(apiContract.createStateDefinition.body.parse(body)).toEqual(body);
  expect(apiContract.createStateDefinition.body.safeParse({ name: 'scene' }).success).toBe(false);
  for (const bad of [
    { name: '1x', keys: {} },
    { name: 'ok', keys: { a: { type: 'date' } } },
    { name: 'ok', keys: { a: { type: 'number', min: 2, max: 1 } } },
  ])
    expect(apiContract.updateStateDefinition.body.safeParse(bad).success).toBe(false);
  expect(apiContract.updateStateDefinition.params.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
  const stored = { ...body, id: '11111111-1111-4111-8111-111111111111', createdAt: 'a', updatedAt: 'b' };
  expect(apiContract.listStateDefinitions.response.parse([stored])).toEqual([stored]);
  expect(apiContract.getStateDefinition.response.safeParse({ ...stored, id: 'x' }).success).toBe(false);
  expect(apiContract.deleteStateDefinition.response.parse(undefined)).toBeUndefined();
  expect(stateDefinitionInUseDetailsSchema.parse({ sessions: [{ id: 's', title: 'T' }], workflows: [] })).toEqual({
    sessions: [{ id: 's', title: 'T' }],
    workflows: [],
  });
  expect(stateDefinitionInUseDetailsSchema.safeParse({ sessions: [] }).success).toBe(false);
});

it("describes a chat's computed story state: keys by name, turns with their writes", () => {
  const meta = { written: true, turnsSinceWrite: 1, writtenAtTurn: 2 };
  const view = {
    turn: 3,
    definitions: [
      {
        definitionId: 'd',
        name: 'scene',
        values: { tension: 4, injected: [{ id: 'i', text: 'x' }] },
        meta: { tension: meta, injected: { ...meta, count: 1, droppedByCap: 0 } },
        history: { tension: [{ turn: 2, value: 4 }], injected: [{ turn: 2, value: 1 }] },
        warnings: [
          { definition: 'scene', key: 'mood', message: 'Stored value 1 is not one of: calm; using default calm' },
        ],
      },
    ],
    nodes: [
      {
        nodeId: 'pick',
        label: 'Draw #1 (draw)',
        values: { draws: [] },
        meta: { draws: meta },
        history: { draws: [] },
        omitted: { draws: 3 },
      },
    ],
    turns: [
      {
        executionId: 'e1',
        at: 'a',
        completed: true,
        replies: 1,
        turnNumber: 1,
        writes: [
          {
            write: {
              op: 'set',
              target: { kind: 'definition', definitionId: 'd', key: 'tension' },
              nodeId: 'w',
              value: 4,
            },
            definitionName: 'scene',
            nodeLabel: 'State Write #1 (state-write)',
          },
        ],
      },
      { executionId: 'e2', at: 'b', completed: false, replies: 0, turnNumber: null, writes: [] },
    ],
  };
  expect(apiContract.getSessionState.response.parse(view)).toEqual(view);
  expect(apiContract.getSessionState.params.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
  // A turn number is a number or null, never missing; a node's label may be left out.
  const { turnNumber: _turnNumber, ...unnumbered } = view.turns[1]!;
  expect(apiContract.getSessionState.response.safeParse({ ...view, turns: [unnumbered] }).success).toBe(false);
  const { label: _label, ...nameless } = view.nodes[0]!;
  expect(apiContract.getSessionState.response.safeParse({ ...view, nodes: [nameless] }).success).toBe(true);
  // `omitted` counts the items a node collection's `values` leave out; it is always there, `{}` when none.
  const { omitted: _omitted, ...uncounted } = view.nodes[0]!;
  expect(apiContract.getSessionState.response.safeParse({ ...view, nodes: [uncounted] }).success).toBe(false);
  expect(
    apiContract.getSessionState.response.safeParse({ ...view, nodes: [{ ...uncounted, omitted: {} }] }).success,
  ).toBe(true);
});

it('describes collections: full records to write, summaries to list', () => {
  expect(apiContract.createCollection.body.parse({ name: 'Lore', entries: [{ text: 'a' }] })).toEqual({
    name: 'Lore',
    entries: [{ text: 'a', weight: 1, enabled: true }],
  });
  expect(apiContract.createCollection.body.safeParse({ name: 'Lore' }).success).toBe(false);
  expect(apiContract.updateCollection.body.safeParse({ name: ' ', entries: [] }).success).toBe(false);
  expect(apiContract.updateCollection.params.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
  const summary = { id: 'c', name: 'Lore', entryCount: 2, createdAt: 'a', updatedAt: 'b' };
  expect(apiContract.listCollections.response.parse([summary])).toEqual([summary]);
  expect(apiContract.listCollections.response.safeParse([{ ...summary, entryCount: -1 }]).success).toBe(false);
});

it('takes the model list refresh flag as the strings "true" or "false" only', () => {
  const { query } = apiContract.listProviderModels;
  expect(query.parse({})).toEqual({});
  expect(query.parse({ refresh: 'true' })).toEqual({ refresh: 'true' });
  expect(query.safeParse({ refresh: '1' }).success).toBe(false);
});

it('takes chat settings as a partial map with null resets, and keeps workflow declarations optional', () => {
  expect(apiContract.updateSession.body.parse({ settings: { a: 1, b: null } })).toEqual({
    settings: { a: 1, b: null },
  });
  expect(apiContract.updateSession.body.safeParse({ settings: 'x' }).success).toBe(false);
  const graph = { name: 'W', nodes: [], edges: [] };
  expect(apiContract.updateWorkflow.body.parse(graph)).not.toHaveProperty('settings');
  expect(apiContract.updateWorkflow.body.parse({ ...graph, settings: [{ key: 'a', type: 'text' }] }).settings).toEqual([
    { key: 'a', type: 'text', default: '' },
  ]);
  expect(apiContract.createWorkflow.body.parse({ name: 'W', settings: [] })).toEqual({ name: 'W', settings: [] });
});
