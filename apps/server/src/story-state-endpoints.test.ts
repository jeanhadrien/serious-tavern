import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { apiContract } from '@st/shared';
import {
  assistantRows,
  counting,
  define,
  deleteMessage,
  makeSession,
  makeWorkflow,
  readSession,
  tempApps,
  turn,
  type App,
} from './test-support/story.js';

// What the message, session and preset endpoints do with story state.

const apps = tempApps('story-endpoints');
afterEach(() => apps.cleanup());

const edit = (app: App, sessionId: string, messageId: string, content: string) =>
  app.inject({ method: 'PATCH', url: `/api/sessions/${sessionId}/messages/${messageId}`, payload: { content } });

describe('editing messages', () => {
  it('stamps editedAt when the content changes, moves it on a second edit, and leaves the state alone', async () => {
    const { app } = await apps.open();
    try {
      const definition = await define(app);
      const { nodes, edges } = counting(definition.id);
      const session = await makeSession(app, (await makeWorkflow(app, nodes, edges)).id);
      await turn(app, session.id);
      const saved = await readSession(app, session.id);
      const [user, reply] = saved.messages;
      expect(user!.editedAt).toBeUndefined();
      const first = apiContract.updateMessage.response.parse(
        (await edit(app, session.id, user!.id, 'new words')).json(),
      );
      expect(first.editedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(Number.isNaN(Date.parse(first.editedAt!))).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = apiContract.updateMessage.response.parse(
        (await edit(app, session.id, user!.id, 'other words')).json(),
      );
      expect(second.editedAt! > first.editedAt!).toBe(true);
      // Assistant replies are stamped too. Editing is display only: nothing is recomputed.
      const edited = apiContract.updateMessage.response.parse(
        (await edit(app, session.id, reply!.id, 'my reply')).json(),
      );
      expect(edited.editedAt).toEqual(expect.any(String));
      const after = await readSession(app, session.id);
      expect(after.state).toEqual(saved.state);
      expect(await turn(app, session.id)).toEqual(['n=1 turn=2']);
    } finally {
      await app.close();
    }
  });

  it('does not stamp an edit that changes nothing, whitespace aside', async () => {
    const { app } = await apps.open();
    try {
      const definition = await define(app);
      const { nodes, edges } = counting(definition.id);
      const session = await makeSession(app, (await makeWorkflow(app, nodes, edges)).id);
      await turn(app, session.id, 'same words');
      const [user] = (await readSession(app, session.id)).messages;
      for (const content of ['same words', '  same words \n']) {
        const result = apiContract.updateMessage.response.parse(
          (await edit(app, session.id, user!.id, content)).json(),
        );
        expect(result.editedAt).toBeUndefined();
      }
      expect((await readSession(app, session.id)).messages[0]!.editedAt).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});

describe('session records', () => {
  it('creates sessions with an empty state, and lists them without it', async () => {
    const { app } = await apps.open();
    try {
      const definition = await define(app);
      const { nodes, edges } = counting(definition.id);
      const workflow = await makeWorkflow(app, nodes, edges);
      const session = await makeSession(app, workflow.id);
      expect(session.state).toEqual({ turns: [] });
      await turn(app, session.id);
      const list = apiContract.listSessions.response.parse(
        (await app.inject({ method: 'GET', url: '/api/sessions' })).json(),
      );
      expect(list).toHaveLength(1);
      expect(list[0]).not.toHaveProperty('state');
      expect(list[0]).not.toHaveProperty('messages');
      expect(list[0]!.messageCount).toBe(2);
      expect((await readSession(app, session.id)).state?.turns).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});

describe('previewing a preset', () => {
  const preset = {
    id: randomUUID(),
    name: 'P',
    createdAt: '',
    updatedAt: '',
    inputs: [],
    entries: [
      {
        id: 'e',
        displayName: 'E',
        kind: 'message',
        role: 'system',
        enabled: true,
        content: 'n={{state.counter.n}} mood={{state.counter.mood}} turn={{trigger.turn}}',
      },
    ],
  };

  it("shows a chat's next turn, and the defaults at turn 1 without a chat", async () => {
    const { app } = await apps.open();
    try {
      const definition = await define(app);
      const { nodes, edges } = counting(definition.id);
      const session = await makeSession(app, (await makeWorkflow(app, nodes, edges)).id);
      await turn(app, session.id);
      await turn(app, session.id);
      const preview = async (sessionId?: string) =>
        (await app.inject({ method: 'POST', url: '/api/presets/preview', payload: { preset, sessionId } })).json()
          .messages;
      expect(await preview(session.id)).toEqual([{ role: 'system', content: 'n=2 mood=calm turn=3' }]);
      expect(await preview()).toEqual([{ role: 'system', content: 'n=0 mood=calm turn=1' }]);
      // Deleting the last reply rewinds the preview as it rewinds the next turn.
      await deleteMessage(app, session.id, assistantRows(await readSession(app, session.id))[1]!.id);
      expect(await preview(session.id)).toEqual([{ role: 'system', content: 'n=1 mood=calm turn=2' }]);
    } finally {
      await app.close();
    }
  });
});
