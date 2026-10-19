import { expect, it } from 'vitest';
import { executionLogSchema, messageSchema, sessionSchema, workflowSchema } from './models.js';
import { presetSchema } from './preset.js';

it('loads old sessions without speaker metadata and preserves new speaker snapshots', () => {
  const session = {
    id: 'session',
    title: 'Old',
    workflowId: 'workflow',
    createdAt: '',
    updatedAt: '',
    messages: [{ id: 'message', role: 'assistant', content: 'Hi', createdAt: '' }],
  };
  expect(sessionSchema.parse(session)).toEqual(session);
  const named = { ...session, messages: [{ ...session.messages[0], name: 'Original', characterId: 'card' }] };
  expect(sessionSchema.parse(named)).toEqual(named);
});

it('loads old executions without warnings', () => {
  const execution = {
    id: 'execution',
    workflowId: 'workflow',
    sessionId: 'session',
    status: 'completed',
    startedAt: '',
    nodes: {},
  };
  expect(executionLogSchema.parse(execution).warnings).toEqual([]);
});

it('loads old executions that logged the canonical LLM request, next to new wire logs', () => {
  const request = { provider: 'openrouter', model: 'm', messages: [{ role: 'user', content: 'Hi' }] };
  const wire = { url: 'https://x.test/chat/completions', method: 'POST', headers: {}, body: { model: 'm' } };
  const execution = executionLogSchema.parse({
    id: 'execution',
    workflowId: 'workflow',
    sessionId: 'session',
    status: 'completed',
    startedAt: '',
    nodes: { old: { status: 'completed', request }, new: { status: 'completed', wire } },
  });
  expect(execution.nodes.old).toMatchObject({ request });
  expect(execution.nodes.old).not.toHaveProperty('wire');
  expect(execution.nodes.new?.wire).toEqual(wire);
});

it('preserves unknown fields on stored records for forward compatibility', () => {
  const workflow = workflowSchema.parse({
    id: 'w',
    name: 'W',
    nodes: [{ id: 'n', type: 'chat-input', config: {}, position: { x: 0, y: 0 }, futureNodeField: 1 }],
    edges: [{ id: 'e', source: 'n', sourceHandle: 'a', target: 'n', targetHandle: 'b', futureEdgeField: 1 }],
    createdAt: '',
    updatedAt: '',
    futureWorkflowField: 'kept',
  });
  expect((workflow as Record<string, unknown>).futureWorkflowField).toBe('kept');
  expect((workflow.nodes[0]! as Record<string, unknown>).futureNodeField).toBe(1);
  expect((workflow.edges[0]! as Record<string, unknown>).futureEdgeField).toBe(1);

  const message = messageSchema.parse({
    id: 'm',
    role: 'user',
    content: 'hi',
    createdAt: '',
    futureMessageField: 'kept',
  });
  expect((message as Record<string, unknown>).futureMessageField).toBe('kept');

  const session = sessionSchema.parse({
    id: 's',
    title: 'T',
    workflowId: 'w',
    messages: [],
    createdAt: '',
    updatedAt: '',
    futureSessionField: 'kept',
  });
  expect((session as Record<string, unknown>).futureSessionField).toBe('kept');

  const execution = executionLogSchema.parse({
    id: 'x',
    workflowId: 'w',
    sessionId: 's',
    status: 'completed',
    startedAt: '',
    nodes: { n: { status: 'completed', futureNodeField: 1 } },
    futureExecutionField: 'kept',
  });
  expect((execution as Record<string, unknown>).futureExecutionField).toBe('kept');
  expect((execution.nodes.n! as Record<string, unknown>).futureNodeField).toBe(1);
});

it('reads a session with and without forkedFrom', () => {
  const base = { id: 's', title: 'T', workflowId: 'w', messages: [], createdAt: '', updatedAt: '' };
  expect(sessionSchema.parse(base).forkedFrom).toBeUndefined();
  const forkedFrom = { sessionId: 'src', messageId: 'm1' };
  expect(sessionSchema.parse({ ...base, forkedFrom }).forkedFrom).toEqual(forkedFrom);
  expect(sessionSchema.safeParse({ ...base, forkedFrom: { sessionId: 'src' } }).success).toBe(false);
});

it('preserves unknown preset fields and defaults old placement/role', () => {
  const preset = presetSchema.parse({
    id: 'e305f530-421a-492b-9d25-fbb054f28c04',
    name: 'P',
    createdAt: '',
    updatedAt: '',
    futurePresetField: 'kept',
    inputs: [{ id: 'i', key: 'history', dataType: 'messages', futureInputField: 1 }],
    entries: [
      { id: 'm', kind: 'message', enabled: true, displayName: 'M', role: 'system', content: 'hi', futureEntryField: 1 },
      { id: 's', kind: 'slot', enabled: true, displayName: 'S', inputKey: 'history', futureSlotField: 2 },
    ],
  });
  expect((preset as Record<string, unknown>).futurePresetField).toBe('kept');
  expect((preset.inputs[0]! as Record<string, unknown>).futureInputField).toBe(1);
  expect((preset.entries[0]! as Record<string, unknown>).futureEntryField).toBe(1);
  expect((preset.entries[1]! as Record<string, unknown>).futureSlotField).toBe(2);
  expect(preset.entries[0]!.kind === 'message' && preset.entries[0]!.placement).toEqual({ mode: 'ordered' });
  expect(preset.entries[1]!.kind === 'slot' && preset.entries[1]!.role).toBe('user');
});
