import { expect, it } from 'vitest';
import { executionLogSchema, sessionSchema } from './models.js';

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
