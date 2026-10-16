import { afterEach, describe, expect, it } from 'vitest';
import { apiContract } from '@st/shared';
import {
  assistantRows,
  counting,
  define,
  edge,
  entriesOf,
  makeSession,
  makeWorkflow,
  node,
  readSession,
  send,
  tempApps,
  turn,
} from './test-support/story.js';

// Turns that produce no reply, or no message at all, still count and still write.

const apps = tempApps('story-turns');
afterEach(() => apps.cleanup());

describe('turns without a reply', () => {
  it('counts a completed turn whose Chat Output was skipped, and keeps its writes', async () => {
    const { app } = await apps.open();
    try {
      const definition = await define(app);
      const workflow = await makeWorkflow(
        app,
        [
          node('input', 'chat-input'),
          node('bump', 'state-write', { definitionId: definition.id, key: 'n', op: 'increment' }),
          node('gate', 'condition', { left: '{{input.value}}', operator: 'equals', right: 'yes' }),
          node('output', 'chat-output', { template: 'n={{state.counter.n}} turn={{trigger.turn}}' }),
        ],
        [edge('input', 'message', 'gate', 'value'), edge('gate', 'true', 'output', 'value')],
      );
      const session = await makeSession(app, workflow.id);

      const silent = await send(app, session.id, 'no');
      expect(silent.statusCode).toBe(200);
      expect(apiContract.sendMessage.response.parse(silent.json()).assistantMessages).toEqual([]);
      const saved = await readSession(app, session.id);
      expect(assistantRows(saved)).toEqual([]);
      expect(entriesOf(saved)).toMatchObject([
        { completed: true, replies: 0, writes: [{ op: 'set', nodeId: 'bump', value: 1 }] },
      ]);

      // The silent turn counts as turn 1 and its write stands.
      expect(await turn(app, session.id, 'yes')).toEqual(['n=1 turn=2']);
      const state = apiContract.getSessionState.response.parse(
        (await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/state` })).json(),
      );
      expect(state.turns.map((item) => [item.turnNumber, item.replies])).toEqual([
        [1, 0],
        [2, 1],
      ]);
    } finally {
      await app.close();
    }
  });

  it('runs an empty send as a turn: no user message, but an entry that counts', async () => {
    const { app } = await apps.open();
    try {
      const definition = await define(app);
      const { nodes, edges } = counting(definition.id);
      const session = await makeSession(app, (await makeWorkflow(app, nodes, edges)).id);
      expect(await turn(app, session.id, '')).toEqual(['n=0 turn=1']);
      const saved = await readSession(app, session.id);
      expect(saved.messages.map((message) => message.role)).toEqual(['assistant']);
      expect(entriesOf(saved)).toMatchObject([{ completed: true, replies: 1 }]);
      expect(await turn(app, session.id, 'hello')).toEqual(['n=1 turn=2']);
    } finally {
      await app.close();
    }
  });
});
