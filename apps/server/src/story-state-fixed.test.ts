import { afterEach, describe, expect, it } from 'vitest';
import {
  assistantRows,
  define,
  deleteMessage,
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

// A State Write with a fixed `value` setting stores it every turn with nothing connected.

const apps = tempApps('story-fixed');
afterEach(() => apps.cleanup());

describe('State Write with a fixed value', () => {
  it('stores constants every turn, replays them with the replies and rejects one that does not fit', async () => {
    const { app } = await apps.open();
    try {
      const definition = await define(app);
      const write = (key: string, op: string, value: unknown) => ({ definitionId: definition.id, key, op, value });
      const workflow = await makeWorkflow(
        app,
        [
          node('input', 'chat-input'),
          node('mood', 'state-write', write('mood', 'set', 'tense')),
          node('bump', 'state-write', write('n', 'increment', 2)),
          node('note', 'state-write', write('log', 'add', { text: 'a storm', level: 2 })),
          node('output', 'chat-output', {
            template: 'n={{state.counter.n}} mood={{state.counter.mood}} turn={{trigger.turn}}',
          }),
        ],
        [edge('input', 'message', 'output', 'value')],
      );
      const session = await makeSession(app, workflow.id);

      expect(await turn(app, session.id)).toEqual(['n=0 mood=calm turn=1']);
      expect(await turn(app, session.id)).toEqual(['n=2 mood=tense turn=2']);
      expect(await turn(app, session.id)).toEqual(['n=4 mood=tense turn=3']);
      // Clamped at the key's max of 5.
      expect(await turn(app, session.id)).toEqual(['n=5 mood=tense turn=4']);

      const saved = await readSession(app, session.id);
      // In node id order, the same on every run.
      expect(entriesOf(saved)[0]!.writes).toEqual([
        expect.objectContaining({ op: 'set', nodeId: 'bump', value: 2 }),
        expect.objectContaining({ op: 'set', nodeId: 'mood', value: 'tense' }),
        expect.objectContaining({
          op: 'add',
          nodeId: 'note',
          item: expect.objectContaining({ text: 'a storm', level: 2 }),
        }),
      ]);

      // Deleting the replies of turns 3 and 4 undoes their constants like any other write: back to turn 2's values.
      for (const row of assistantRows(saved).slice(-2)) await deleteMessage(app, session.id, row.id);
      expect(await turn(app, session.id)).toEqual(['n=4 mood=tense turn=3']);
    } finally {
      await app.close();
    }
  });

  it('fails the turn, naming the key, when the fixed value does not fit it', async () => {
    const { app } = await apps.open();
    try {
      const definition = await define(app);
      const workflow = await makeWorkflow(
        app,
        [
          node('input', 'chat-input'),
          node('mood', 'state-write', { definitionId: definition.id, key: 'mood', op: 'set', value: 'sad' }),
          node('output', 'chat-output', { template: 'ok' }),
        ],
        [edge('input', 'message', 'output', 'value')],
      );
      const session = await makeSession(app, workflow.id);
      const response = await send(app, session.id);
      expect(response.statusCode).toBe(500);
      expect(response.json().error.message).toContain('counter.mood must be one of: calm, tense; got "sad"');
    } finally {
      await app.close();
    }
  });
});
