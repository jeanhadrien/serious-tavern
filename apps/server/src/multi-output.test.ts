import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { apiContract, errorEnvelopeSchema, sendMessageResultSchema, type ApiBody, type Workflow } from '@st/shared';
import { createApp } from './app.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
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
async function setup(nodes: Workflow['nodes'], edges: Workflow['edges']) {
  const directory = join(process.cwd(), '.test-data', `multi-${randomUUID()}`);
  directories.push(directory);
  const app = await createApp(directory, { seed: false });
  const created = apiContract.createWorkflow.response.parse(
    (
      await app.inject({
        method: 'POST',
        url: '/api/workflows',
        payload: { name: 'Multiple outputs' },
      })
    ).json(),
  );
  const workflow = apiContract.updateWorkflow.response.parse(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/workflows/${created.id}`,
        payload: { name: created.name, nodes, edges },
      })
    ).json(),
  );
  const session = apiContract.createSession.response.parse(
    (
      await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { workflowId: workflow.id },
      })
    ).json(),
  );
  const send = () =>
    app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, payload: { content: 'hello' } });
  const load = async () =>
    apiContract.getSession.response.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/sessions/${session.id}`,
        })
      ).json(),
    );
  return { app, workflow, session, send, load };
}

it('persists multiple named assistant messages and forwards history names to preview', async () => {
  const { app, send, load, session } = await setup(
    [
      node('input', 'chat-input'),
      node('foo', 'chat-output', { name: 'foo', order: 10 }),
      node('bar', 'chat-output', { name: 'bar', order: -10 }),
    ],
    [edge('input', 'foo'), edge('foo', 'bar', 'reply')],
  );
  try {
    const response = await send();
    expect(response.statusCode).toBe(200);
    const result = apiContract.sendMessage.response.parse(response.json());
    expect(result.assistantMessages.map((message) => [message.name, message.content])).toEqual([
      ['foo', 'hello'],
      ['bar', 'hello'],
    ]);
    expect((await load()).messages).toEqual([result.userMessage, ...result.assistantMessages]);
    const preset: ApiBody<'previewPreset'>['preset'] = {
      id: randomUUID(),
      createdAt: '',
      updatedAt: '',
      name: 'History',
      inputs: [{ id: 'history', key: 'history', dataType: 'messages' }],
      entries: [{ id: 'history', name: 'History', kind: 'slot', enabled: true, inputKey: 'history', role: 'user' }],
    };
    const preview = apiContract.previewPreset.response.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/presets/preview',
          payload: { preset, sessionId: session.id },
        })
      ).json(),
    );
    expect(preview.messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hello', name: 'foo' },
      { role: 'assistant', content: 'hello', name: 'bar' },
    ]);
  } finally {
    await app.close();
  }
});

it('persists completed messages on partial failure and returns them in the error contract', async () => {
  const { app, send, load } = await setup(
    [
      node('input', 'chat-input'),
      node('foo', 'chat-output', { name: 'foo' }),
      node('fail', 'http-request', { url: 'not-a-url' }),
      node('bar'),
    ],
    [edge('input', 'foo'), edge('foo', 'fail', 'reply', 'input'), edge('fail', 'bar', 'body')],
  );
  try {
    const response = await send();
    expect(response.statusCode).toBe(500);
    const error = errorEnvelopeSchema.parse(response.json()).error;
    expect(error.code).toBe('WORKFLOW_EXECUTION_FAILED');
    const details = sendMessageResultSchema.parse(error.details);
    expect(details.assistantMessages).toMatchObject([{ name: 'foo', content: 'hello' }]);
    expect(details.execution.status).toBe('error');
    expect((await load()).messages).toEqual([details.userMessage, ...details.assistantMessages]);
    expect(
      apiContract.getExecution.response.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/api/executions/${details.execution.id}`,
          })
        ).json(),
      ),
    ).toEqual(details.execution);
  } finally {
    await app.close();
  }
});

it('allows a turn without assistant messages, persists its execution warning and user message', async () => {
  const { app, send, load } = await setup(
    [
      node('input', 'chat-input'),
      node('condition', 'condition', { left: '{{input.value}}', right: 'different' }),
      node('output'),
    ],
    [edge('input', 'condition'), edge('condition', 'output', 'true')],
  );
  try {
    const response = await send();
    expect(response.statusCode).toBe(200);
    const result = apiContract.sendMessage.response.parse(response.json());
    expect(result.assistantMessages).toEqual([]);
    expect(result.execution.warnings).toHaveLength(1);
    expect(result.userMessage.executionId).toBe(result.execution.id);
    expect((await load()).messages).toEqual([result.userMessage]);
  } finally {
    await app.close();
  }
});

it('resolves selected cards for validation, output attribution and immutable speaker names', async () => {
  const { app, workflow, session, load } = await setup(
    [node('input', 'chat-input'), node('character', 'character'), node('output', 'chat-output', { name: 'ignored' })],
    [edge('input', 'output'), edge('character', 'output', 'character', 'character')],
  );
  try {
    const card = apiContract.createCharacter.response.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/characters',
          payload: { name: 'Original' },
        })
      ).json(),
    );
    workflow.nodes[1]!.config = { source: 'card', characterId: card.id };
    await app.inject({ method: 'PUT', url: `/api/workflows/${workflow.id}`, payload: workflow });
    expect((await app.inject({ method: 'POST', url: `/api/workflows/${workflow.id}/validate` })).statusCode).toBe(200);
    const result = apiContract.sendMessage.response.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/sessions/${session.id}/messages`,
          payload: { content: 'hi' },
        })
      ).json(),
    );
    expect(result.assistantMessages[0]).toMatchObject({ name: 'Original', characterId: card.id });
    await app.inject({ method: 'PUT', url: `/api/characters/${card.id}`, payload: { ...card, name: 'Renamed' } });
    expect((await load()).messages[1]?.name).toBe('Original');
    await app.inject({ method: 'DELETE', url: `/api/characters/${card.id}` });
    const invalid = await app.inject({ method: 'POST', url: `/api/workflows/${workflow.id}/validate` });
    expect(invalid.statusCode).toBe(422);
    expect(errorEnvelopeSchema.parse(invalid.json()).error.details).toEqual(
      expect.arrayContaining([`Node character: Character ${card.id} not found`]),
    );
  } finally {
    await app.close();
  }
});
