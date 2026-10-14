import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';
import { apiContract, errorEnvelopeSchema } from '@st/shared';
import { createApp } from './app.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = join(process.cwd(), '.test-data', `messages-${randomUUID()}`);
  directories.push(directory);
  const app = await createApp(directory, { seed: false });
  const workflow = (await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'Echo' } })).json();
  await app.inject({
    method: 'PUT',
    url: `/api/workflows/${workflow.id}`,
    payload: {
      name: 'Echo',
      nodes: [
        { id: 'input', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
        { id: 'output', type: 'chat-output', config: { name: 'Speaker' }, position: { x: 100, y: 0 } },
      ],
      edges: [{ id: 'reply', source: 'input', sourceHandle: 'message', target: 'output', targetHandle: 'value' }],
    },
  });
  const session = apiContract.createSession.response.parse(
    (await app.inject({ method: 'POST', url: '/api/sessions', payload: { workflowId: workflow.id } })).json(),
  );
  const result = apiContract.sendMessage.response.parse(
    (
      await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/messages`,
        payload: { content: 'Original' },
      })
    ).json(),
  );
  return { app, session, result };
}

it('edits either role without changing metadata or executing, then deletes only the selected message', async () => {
  const { app, session, result } = await fixture();
  try {
    const before = (await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })).json();
    for (const message of [result.userMessage!, ...result.assistantMessages]) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/sessions/${session.id}/messages/${message.id}`,
        payload: { content: '  Edited\ncontent  ', name: 'Not allowed' },
      });
      expect(response.statusCode).toBe(200);
      expect(apiContract.updateMessage.response.parse(response.json())).toEqual({
        ...message,
        content: 'Edited\ncontent',
      });
    }
    const edited = (await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })).json();
    expect(edited.messages).toHaveLength(2);
    expect(edited.updatedAt).toBe(before.updatedAt);
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/sessions/${session.id}/messages/${result.userMessage!.id}`,
    });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    const remaining = (await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })).json();
    expect(remaining.messages).toEqual([edited.messages[1]]);
    expect(remaining.updatedAt).toBe(edited.updatedAt);
    const execution = await app.inject({ method: 'GET', url: `/api/executions/${result.execution.id}` });
    expect(execution.json()).toEqual(result.execution);
  } finally {
    await app.close();
  }
});

it('only advances session updatedAt on message send, not on edits, deletes or metadata patches', async () => {
  const { app, session, result } = await fixture();
  try {
    const before = (await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })).json();
    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${session.id}/messages/${result.userMessage!.id}`,
      payload: { content: 'Edited' },
    });
    expect(edited.statusCode).toBe(200);
    const afterEdit = (await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })).json();
    expect(afterEdit.updatedAt).toBe(before.updatedAt);
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/sessions/${session.id}/messages/${result.assistantMessages[0]!.id}`,
    });
    expect(deleted.statusCode).toBe(204);
    const afterDelete = (await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })).json();
    expect(afterDelete.updatedAt).toBe(before.updatedAt);
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${session.id}`,
      payload: { title: 'Renamed' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().title).toBe('Renamed');
    const afterPatch = (await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })).json();
    expect(afterPatch.updatedAt).toBe(before.updatedAt);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const sent = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages`,
      payload: { content: 'Another turn' },
    });
    expect(sent.statusCode).toBe(200);
    const afterSend = (await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })).json();
    expect(afterSend.updatedAt > before.updatedAt).toBe(true);
  } finally {
    await app.close();
  }
});

it('returns standard 404s for missing sessions/messages and rejects invalid edits/params without writing', async () => {
  const { app, session, result } = await fixture();
  try {
    for (const method of ['PATCH', 'DELETE'] as const) {
      for (const [id, messageId] of [
        [randomUUID(), result.userMessage!.id],
        [session.id, randomUUID()],
      ]) {
        const response = await app.inject({
          method,
          url: `/api/sessions/${id}/messages/${messageId}`,
          ...(method === 'PATCH' ? { payload: { content: 'Edited' } } : {}),
        });
        expect(response.statusCode).toBe(404);
        expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
      }
    }
    for (const payload of [{}, { content: '' }, { content: ' \n ' }, { content: 1 }]) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/sessions/${session.id}/messages/${result.userMessage!.id}`,
        payload,
      });
      expect(response.statusCode).toBe(400);
      errorEnvelopeSchema.parse(response.json());
    }
    for (const method of ['PATCH', 'DELETE'] as const) {
      const response = await app.inject({
        method,
        url: `/api/sessions/not-a-uuid/messages/not-a-uuid`,
        ...(method === 'PATCH' ? { payload: { content: 'Edited' } } : {}),
      });
      expect(response.statusCode).toBe(400);
      errorEnvelopeSchema.parse(response.json());
    }
    const current = (await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })).json();
    expect(current.messages).toEqual([result.userMessage, ...result.assistantMessages]);
  } finally {
    await app.close();
  }
});

it('serializes concurrent edits, deletion and a new turn without losing session writes', async () => {
  const { app, session, result } = await fixture();
  try {
    const responses = await Promise.all([
      app.inject({
        method: 'PATCH',
        url: `/api/sessions/${session.id}/messages/${result.assistantMessages[0]!.id}`,
        payload: { content: 'Edited assistant' },
      }),
      app.inject({ method: 'DELETE', url: `/api/sessions/${session.id}/messages/${result.userMessage!.id}` }),
      app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/messages`,
        payload: { content: 'Next turn' },
      }),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 204, 200]);
    const current = (await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })).json();
    expect(current.messages.map((message: { content: string }) => message.content)).toEqual([
      'Edited assistant',
      'Next turn',
      'Next turn',
    ]);
  } finally {
    await app.close();
  }
});

it('runs an empty send on the history as it is, without storing a user message', async () => {
  const { app, session } = await fixture();
  try {
    const count = async () =>
      apiContract.getSession.response
        .parse((await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })).json())
        .messages.filter((message) => message.role === 'user').length;
    expect(await count()).toBe(1);
    for (const payload of [{ content: '  ' }, {}]) {
      const response = await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, payload });
      expect(response.statusCode).toBe(200);
      const body = apiContract.sendMessage.response.parse(response.json());
      expect(body.userMessage).toBeUndefined();
      expect(body.execution.status).toBe('completed');
    }
    expect(await count()).toBe(1);
  } finally {
    await app.close();
  }
});

it('still rejects editing a stored message to empty', async () => {
  const { app, session, result } = await fixture();
  try {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${session.id}/messages/${result.userMessage!.id}`,
      payload: { content: '   ' },
    });
    expect(response.statusCode).toBe(400);
  } finally {
    await app.close();
  }
});
