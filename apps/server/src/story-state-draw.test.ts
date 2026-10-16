import { afterEach, describe, expect, it } from 'vitest';
import type { Collection } from '@st/shared';
import {
  assistantRows,
  deleteMessage,
  edge,
  entriesOf,
  makeSession,
  makeWorkflow,
  node,
  readSession,
  tempApps,
  turn,
  type App,
} from './test-support/story.js';

const apps = tempApps('story-draw');
afterEach(() => apps.cleanup());

describe('Draw avoiding recent draws, end to end', () => {
  // One Chat Output per listed Draw output, in that order.
  async function drawing(app: App, texts: string[], outputs: string[], avoidRecent = 1) {
    const deck = (
      await app.inject({
        method: 'POST',
        url: '/api/collections',
        payload: { name: 'Deck', entries: texts.map((text) => ({ text })) },
      })
    ).json() as Collection;
    const workflow = await makeWorkflow(
      app,
      [
        node('input', 'chat-input'),
        node('pick', 'draw', { collectionIds: [deck.id], avoidRecent }),
        ...outputs.map((output, order) => node(`out-${output}`, 'chat-output', { order })),
      ],
      outputs.map((output) => edge('pick', output, `out-${output}`, 'value')),
    );
    return makeSession(app, workflow.id);
  }

  it('skips the entry drawn last turn, and forgets it when that reply is deleted', async () => {
    const { app } = await apps.open();
    try {
      const session = await drawing(app, ['storm'], ['reason']);
      expect(await turn(app, session.id)).toEqual(['drew 1 of 1 eligible']);
      expect(await turn(app, session.id)).toEqual(['no eligible entry among 1 (1 recent excluded)']);
      const first = assistantRows(await readSession(app, session.id))[0]!;
      await deleteMessage(app, session.id, first.id);
      expect(await turn(app, session.id)).toEqual(['drew 1 of 1 eligible']);
      // The draw is remembered under the node's own key.
      const entry = entriesOf(await readSession(app, session.id)).at(-1)!;
      expect(entry.writes).toMatchObject([
        { op: 'add', target: { kind: 'node', nodeId: 'pick', key: 'draws' }, item: { text: 'storm' } },
      ]);
    } finally {
      await app.close();
    }
  });

  it('alternates between two entries for six turns, whatever the seed', async () => {
    const { app } = await apps.open();
    try {
      const session = await drawing(app, ['storm', 'fog'], ['text', 'reason']);
      const rows: string[][] = [];
      for (let index = 0; index < 6; index++) rows.push(await turn(app, session.id));
      // Whatever the seed: the first turn has both entries to choose from, every later one only the other.
      expect(rows.map(([, reason]) => reason)).toEqual([
        'drew 1 of 2 eligible',
        ...Array(5).fill('drew 1 of 1 eligible (1 recent excluded)'),
      ]);
      const texts = rows.map(([text]) => text!);
      for (let index = 1; index < texts.length; index++) expect(texts[index]).not.toBe(texts[index - 1]);
      expect(new Set(texts)).toEqual(new Set(['storm', 'fog']));
    } finally {
      await app.close();
    }
  });
});
