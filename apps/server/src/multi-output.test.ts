import { afterEach, expect, it, vi } from 'vitest';
import { registry } from '@st/engine';
import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { apiContract, errorEnvelopeSchema, sendMessageResultSchema, type ApiBody, type Workflow } from '@st/shared';
import { createApp } from './app.js';
import { createContext } from './context.js';
import { characterFromCard } from './card.js';
import { sendMessage } from './services/chat.js';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
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
  return { app, workflow, session, send, load, directory };
}

it('prepares each chat turn once, passing defaults to port resolution', async () => {
  const definition = registry.get('chat-output')!;
  const resolve = vi.fn(async (config: Record<string, unknown>) => {
    expect(config).toEqual({ template: '', name: '', order: 0 });
    return { inputs: definition.inputs, outputs: definition.outputs };
  });
  const original = definition.resolvePorts;
  definition.resolvePorts = resolve;
  const { app, send } = await setup([node('input', 'chat-input'), node('output')], [edge('input', 'output')]);
  try {
    // Saving the workflow resolves ports once for pruning; the turn counter starts after that.
    resolve.mockClear();
    expect((await send()).statusCode).toBe(200);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect((await send()).statusCode).toBe(200);
    expect(resolve).toHaveBeenCalledTimes(2);
  } finally {
    definition.resolvePorts = original;
    await app.close();
  }
});

it('rejects invalid disconnected nodes before persisting any message or execution', async () => {
  const { app, send, load, directory } = await setup(
    [node('input', 'chat-input'), node('output'), node('unknown', 'unknown-type')],
    [edge('input', 'output')],
  );
  try {
    const response = await send();
    expect(response.statusCode).toBe(400);
    expect(errorEnvelopeSchema.parse(response.json()).error).toMatchObject({ code: 'WORKFLOW_INVALID' });
    expect((await load()).messages).toEqual([]);
    expect(await readdir(join(directory, 'executions')).catch(() => [])).toEqual([]);
  } finally {
    await app.close();
  }
});

it('fails a turn with a normal error naming the preset when its file was removed on disk', async () => {
  const directory = join(process.cwd(), '.test-data', `missing-preset-${randomUUID()}`);
  directories.push(directory);
  const app = await createApp(directory, { seed: false });
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/presets',
      payload: { name: 'Doomed', inputs: [], entries: [] },
    });
    const presetId = created.json().id as string;
    const workflow = apiContract.createWorkflow.response.parse(
      (await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'Uses preset' } })).json(),
    );
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/workflows/${workflow.id}`,
      payload: {
        name: workflow.name,
        nodes: [node('input', 'chat-input'), node('llm', 'llm', { presetId }), node('output')],
        edges: [edge('input', 'llm', 'message', 'unused'), edge('llm', 'output', 'text', 'value')],
      },
    });
    expect(saved.statusCode).toBe(200);
    const session = apiContract.createSession.response.parse(
      (await app.inject({ method: 'POST', url: '/api/sessions', payload: { workflowId: workflow.id } })).json(),
    );
    // Deleting the file by hand bypasses the PRESET_IN_USE guard.
    await rm(join(directory, 'presets', (await readdir(join(directory, 'presets')))[0]!));
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages`,
      payload: { content: 'hello' },
    });
    expect(response.statusCode).toBe(400);
    const error = errorEnvelopeSchema.parse(response.json()).error;
    expect(error.code).toBe('WORKFLOW_INVALID');
    expect(JSON.stringify(error.details)).toContain(`Preset ${presetId} not found`);
    const loaded = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` });
    expect(loaded.json().messages).toEqual([]);
  } finally {
    await app.close();
  }
});

it('shares the prepared card snapshot with session character context and execution', async () => {
  const directory = join(process.cwd(), '.test-data', `snapshot-${randomUUID()}`);
  directories.push(directory);
  const context = await createContext(directory, { seed: false });
  const card = characterFromCard(JSON.stringify({ name: 'Original' }), randomUUID(), '', false);
  const get = vi
    .spyOn(context.characters, 'get')
    .mockResolvedValueOnce(card)
    .mockResolvedValue({
      ...card,
      name: 'Changed',
    });
  const workflow: Workflow = {
    id: randomUUID(),
    name: 'Snapshot',
    createdAt: '',
    updatedAt: '',
    nodes: [
      node('input', 'chat-input'),
      node('card', 'character', { source: 'card', characterId: card.id }),
      node('output', 'chat-output', { template: '{{character.name}}' }),
    ],
    edges: [edge('input', 'output'), edge('card', 'output', 'character', 'character')],
  };
  await context.workflows.save(workflow);
  const id = randomUUID();
  await context.sessions.save({
    id,
    title: 'Snapshot',
    workflowId: workflow.id,
    characterId: card.id,
    messages: [],
    createdAt: '',
    updatedAt: '',
  });
  const result = await sendMessage(context, id, 'hello');
  expect(result.assistantMessages).toMatchObject([{ name: 'Original', content: 'Original', characterId: card.id }]);
  expect(get).toHaveBeenCalledTimes(1);
});

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
      node('fail with spaces', 'http-request', { url: 'not-a-url' }),
      node('bar'),
    ],
    [edge('input', 'foo'), edge('foo', 'fail with spaces', 'reply', 'input'), edge('fail with spaces', 'bar', 'body')],
  );
  try {
    const response = await send();
    expect(response.statusCode).toBe(500);
    const error = errorEnvelopeSchema.parse(response.json()).error;
    expect(error.code).toBe('WORKFLOW_EXECUTION_FAILED');
    expect(error.message).toMatch(/^HTTP Request \(fail with spaces\):/);
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
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining(`could not resolve its ports: Character ${card.id} not found`),
          }),
        ]),
      }),
    );
  } finally {
    await app.close();
  }
});
