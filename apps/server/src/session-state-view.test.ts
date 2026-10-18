import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { apiContract, NODE_ITEMS_LIMIT, WRITE_PREVIEW_LIMIT } from '@st/shared';
import {
  assistantRows,
  define,
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

// The shape and size of GET /api/sessions/:id/state; the values themselves are in session-state.test.ts.

const apps = tempApps('session-state-view');
afterEach(() => apps.cleanup());

const view = async (app: App, sessionId: string) => {
  const response = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/state` });
  expect(response.statusCode).toBe(200);
  return apiContract.getSessionState.response.parse(response.json());
};

const DATE = '2026-01-01T00:00:00.000Z';
const BIG = 5000;

/** Writes a session file by hand, as an older or edited installation would have it. */
async function stored(directory: string, extra: object) {
  const id = randomUUID();
  await mkdir(join(directory, 'sessions'), { recursive: true });
  await writeFile(
    join(directory, 'sessions', `${id}.json`),
    JSON.stringify({
      id,
      title: 'Old',
      workflowId: randomUUID(),
      messages: [],
      createdAt: DATE,
      updatedAt: DATE,
      ...extra,
    }),
  );
  return id;
}

describe('the size of the state view', () => {
  it('keeps no text in the history and cuts long text in the write summaries', async () => {
    const { app } = await apps.open();
    try {
      const definition = await define(app, {
        name: 'memo',
        keys: { summary: { type: 'text' }, level: { type: 'number' } },
      });
      const write = (key: string, op: string) => ({ definitionId: definition.id, key, op });
      const workflow = await makeWorkflow(
        app,
        [
          node('input', 'chat-input'),
          node('keep', 'state-write', write('summary', 'set')),
          node('bump', 'state-write', write('level', 'increment')),
          node('output', 'chat-output', { template: 'ok' }),
        ],
        [edge('input', 'message', 'output', 'value'), edge('input', 'message', 'keep', 'value')],
      );
      const session = await makeSession(app, workflow.id);
      const messages = ['a', 'b', 'c'].map((letter) => letter.repeat(BIG));
      for (const message of messages) await turn(app, session.id, message);

      const state = await view(app, session.id);
      const memo = state.definitions[0]!;
      // The current value is whole; its history has the turns and no values; the number keeps its values.
      expect(memo.values.summary).toBe(messages[2]);
      expect(memo.history.summary).toStrictEqual([{ turn: 1 }, { turn: 2 }, { turn: 3 }]);
      expect(memo.history.level).toEqual([1, 2, 3].map((value, index) => ({ turn: index + 1, value })));

      // Every turn is listed; the long text in its writes is a preview, flagged.
      expect(state.turns).toHaveLength(3);
      const kept = state.turns[2]!.writes.find((item) => item.write.nodeId === 'keep')!;
      expect(kept.truncated).toBe(true);
      expect(kept.write).toMatchObject({ op: 'set', value: 'c'.repeat(WRITE_PREVIEW_LIMIT) });
      const bumped = state.turns[2]!.writes.find((item) => item.write.nodeId === 'bump')!;
      expect(bumped.truncated).toBeUndefined();
      expect(bumped.write).toMatchObject({ op: 'set', value: 3 });
      expect(JSON.stringify(state).length).toBeLessThan(BIG + 3000);

      // The stored data is whole.
      const [first] = entriesOf(await readSession(app, session.id));
      expect(first!.writes.find((item) => item.nodeId === 'keep')).toMatchObject({ value: messages[0] });
    } finally {
      await app.close();
    }
  });
});

describe('the shape of the state view', () => {
  it('lists definitions oldest first, whatever their file names are', async () => {
    const { app, directory } = await apps.open();
    try {
      const folder = join(directory, 'state', 'definitions');
      await mkdir(folder, { recursive: true });
      // File-name order is a, b, c; creation order is c, a, b.
      for (const [name, createdAt] of [
        ['a', '2026-02-01'],
        ['b', '2026-03-01'],
        ['c', '2026-01-01'],
      ] as const)
        await writeFile(
          join(folder, `${name}.yaml`),
          `name: def_${name}\nkeys:\n  k:\n    type: number\nid: ${randomUUID()}\ncreatedAt: ${createdAt}T00:00:00.000Z\nupdatedAt: ${createdAt}T00:00:00.000Z\n`,
        );
      const session = await makeSession(app, (await makeWorkflow(app, [], [])).id);
      expect((await view(app, session.id)).definitions.map((item) => item.name)).toEqual(['def_c', 'def_a', 'def_b']);
    } finally {
      await app.close();
    }
  });

  it('gives each turn the execution it came from and when it settled', async () => {
    const { app } = await apps.open();
    try {
      const definition = await define(app);
      const workflow = await makeWorkflow(
        app,
        [
          node('input', 'chat-input'),
          node('bump', 'state-write', { definitionId: definition.id, key: 'n', op: 'increment' }),
          node('output', 'chat-output'),
        ],
        [edge('input', 'message', 'output', 'value')],
      );
      const session = await makeSession(app, workflow.id);
      const before = Date.now();
      await turn(app, session.id);
      await turn(app, session.id);
      const after = Date.now();
      const saved = await readSession(app, session.id);
      const turns = (await view(app, session.id)).turns;
      expect(turns.map((item) => item.executionId)).toEqual(assistantRows(saved).map((row) => row.executionId));
      expect(turns.map((item) => item.at)).toEqual(entriesOf(saved).map((entry) => entry.at));
      for (const { at } of turns) expect(Date.parse(at)).toBeGreaterThanOrEqual(before);
      for (const { at } of turns) expect(Date.parse(at)).toBeLessThanOrEqual(after);
    } finally {
      await app.close();
    }
  });

  it('sends the newest items of a node collection and says how many it left out', async () => {
    const { app, directory } = await apps.open();
    try {
      const chatWithDraws = (count: number) => {
        const turns = Array.from({ length: count }, (_, index) => `x${index + 1}`);
        return stored(directory, {
          messages: turns.map((executionId) => ({
            id: randomUUID(),
            role: 'assistant',
            content: 'hi',
            createdAt: DATE,
            executionId,
          })),
          state: {
            turns: turns.map((executionId) => ({
              executionId,
              at: DATE,
              completed: true,
              replies: 1,
              writes: [
                {
                  op: 'add',
                  target: { kind: 'node', nodeId: 'draw-1', key: 'draws' },
                  nodeId: 'draw-1',
                  item: { id: `${executionId}:draw-1:1`, text: `card ${executionId}`, entryKey: `k-${executionId}` },
                },
              ],
            })),
          },
        });
      };

      const long = (await view(app, await chatWithDraws(NODE_ITEMS_LIMIT + 10))).nodes[0]!;
      const items = long.values.draws as Array<{ id: string }>;
      expect(items).toHaveLength(NODE_ITEMS_LIMIT);
      // Newest first: the last turn's draw leads, and the oldest ten are the ones left out.
      expect(items[0]!.id).toBe(`x${NODE_ITEMS_LIMIT + 10}:draw-1:1`);
      expect(items.at(-1)!.id).toBe('x11:draw-1:1');
      expect(long.omitted).toEqual({ draws: 10 });
      expect(long.meta.draws!.count).toBe(NODE_ITEMS_LIMIT + 10);

      // At the limit nothing is cut and nothing is reported.
      const exact = (await view(app, await chatWithDraws(NODE_ITEMS_LIMIT))).nodes[0]!;
      expect(exact.values.draws).toHaveLength(NODE_ITEMS_LIMIT);
      expect(exact.omitted).toEqual({});
    } finally {
      await app.close();
    }
  });

  it('shows a chat saved before story state as a fresh one', async () => {
    const { app, directory } = await apps.open();
    try {
      await define(app);
      const id = await stored(directory, {
        messages: [{ id: randomUUID(), role: 'assistant', content: 'hi', createdAt: DATE, executionId: 'old' }],
      });
      const state = await view(app, id);
      expect(state).toMatchObject({ turn: 1, turns: [], nodes: [] });
      expect(state.definitions[0]!.meta.n).toEqual({ written: false, turnsSinceWrite: 1, writtenAtTurn: null });
    } finally {
      await app.close();
    }
  });

  it('names no nodes for a chat whose workflow is gone, and still shows what they wrote', async () => {
    const { app, directory } = await apps.open();
    try {
      const drawn = { op: 'add', target: { kind: 'node', nodeId: 'draw-1', key: 'draws' }, nodeId: 'draw-1' };
      const id = await stored(directory, {
        messages: [{ id: randomUUID(), role: 'assistant', content: 'hi', createdAt: DATE, executionId: 'x' }],
        state: {
          turns: [
            {
              executionId: 'x',
              at: DATE,
              completed: true,
              replies: 1,
              writes: [{ ...drawn, item: { id: 'x:draw-1:1', text: 'a card', entryKey: 'k' } }],
            },
          ],
        },
      });
      const state = await view(app, id);
      expect(state.nodes).toHaveLength(1);
      expect(state.nodes[0]).toMatchObject({ nodeId: 'draw-1', meta: { draws: { count: 1 } } });
      expect(state.nodes[0]!.label).toBeUndefined();
      expect(state.turns[0]!.turnNumber).toBe(1);
      expect(state.turns[0]!.writes[0]!.nodeLabel).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
