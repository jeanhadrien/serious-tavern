import { expect, it } from 'vitest';
import { messageSchema } from '../models.js';
import { apiContract, errorEnvelopeSchema } from './index.js';

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
      entries: [{ id: 'slot', name: 'History', enabled: true, kind: 'slot', inputKey: 'missing' }],
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
