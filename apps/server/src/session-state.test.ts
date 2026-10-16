import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { apiContract, foldStoryState, oldestFirst, type Collection, type StateDefinition } from '@st/shared';
import {
  assistantRows,
  counting,
  define,
  deleteMessage,
  edge,
  makeSession,
  makeWorkflow,
  node,
  putWorkflow,
  readSession,
  tempApps,
  turn,
  type App,
} from './test-support/story.js';

const apps = tempApps('session-state');
afterEach(() => apps.cleanup());

const view = async (app: App, sessionId: string) => {
  const response = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/state` });
  expect(response.statusCode).toBe(200);
  return apiContract.getSessionState.response.parse(response.json());
};

/** `counter` with a workflow that bumps `n` and logs each message into `log`. */
async function logging(app: App) {
  const definition = await define(app);
  const { nodes, edges } = counting(definition.id);
  const workflow = await makeWorkflow(
    app,
    [...nodes, node('note', 'state-write', { definitionId: definition.id, key: 'log', op: 'add' })],
    [...edges, edge('input', 'message', 'note', 'value')],
  );
  return { definition, workflow, session: await makeSession(app, workflow.id) };
}
const counter = (state: Awaited<ReturnType<typeof view>>) => state.definitions.find((item) => item.name === 'counter')!;

describe('GET /api/sessions/:id/state', () => {
  it('shows every definition at its defaults for a chat that has not started', async () => {
    const { app } = await apps.open();
    try {
      const { definition, session } = await logging(app);
      const state = await view(app, session.id);
      expect(state.turn).toBe(1);
      expect(state.turns).toEqual([]);
      expect(state.nodes).toEqual([]);
      expect(state.definitions).toHaveLength(1);
      expect(state.definitions[0]).toEqual({
        definitionId: definition.id,
        name: 'counter',
        values: { n: 0, mood: 'calm', log: [] },
        meta: {
          n: { written: false, turnsSinceWrite: 1, writtenAtTurn: null },
          mood: { written: false, turnsSinceWrite: 1, writtenAtTurn: null },
          log: { written: false, turnsSinceWrite: 1, writtenAtTurn: null, count: 0, droppedByCap: 0 },
        },
        history: { n: [], mood: [], log: [] },
        warnings: [],
      });
    } finally {
      await app.close();
    }
  });

  it('shows the values, meta and history after turns, and the turn the next message will be', async () => {
    const { app } = await apps.open();
    try {
      const { session } = await logging(app);
      for (const message of ['one', 'two', 'three', 'four']) await turn(app, session.id, message);
      const state = await view(app, session.id);
      const { values, meta, history } = counter(state);
      expect(state.turn).toBe(5);
      expect(values.n).toBe(4);
      // Newest first, cut to the cap of 3.
      expect((values.log as Array<{ text: string }>).map((item) => item.text)).toEqual(['four', 'three', 'two']);
      expect(meta.n).toEqual({ written: true, turnsSinceWrite: 1, writtenAtTurn: 4 });
      expect(meta.log).toEqual({ written: true, turnsSinceWrite: 1, writtenAtTurn: 4, count: 3, droppedByCap: 1 });
      expect(meta.mood).toEqual({ written: false, turnsSinceWrite: 5, writtenAtTurn: null });
      expect(history.n).toEqual([1, 2, 3, 4].map((value, index) => ({ turn: index + 1, value })));
      // A collection's history is how many items it kept after each turn.
      expect(history.log).toEqual([1, 2, 3, 3].map((value, index) => ({ turn: index + 1, value })));
      expect(history.mood).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('lists every stored turn with what it wrote, named after the current definition and node', async () => {
    const { app } = await apps.open();
    try {
      const { definition, session } = await logging(app);
      await turn(app, session.id, 'one');
      const [entry] = (await view(app, session.id)).turns;
      expect(entry).toMatchObject({ turnNumber: 1, completed: true, replies: 1 });
      expect(entry!.writes).toHaveLength(2);
      expect(entry!.writes).toEqual(
        expect.arrayContaining([
          {
            write: expect.objectContaining({ op: 'set', nodeId: 'bump', value: 1 }),
            definitionName: 'counter',
            nodeLabel: 'State Write #1 (state-write)',
          },
          {
            write: expect.objectContaining({
              op: 'add',
              nodeId: 'note',
              item: expect.objectContaining({ text: 'one' }),
            }),
            definitionName: 'counter',
            nodeLabel: 'State Write #2 (state-write)',
          },
        ]),
      );
      // A renamed definition shows under its new name; a deleted node has no name any more.
      await app.inject({
        method: 'PUT',
        url: `/api/state-definitions/${definition.id}`,
        payload: { name: 'counter', keys: { n: { type: 'number' } } },
      });
      const { nodes, edges } = counting(definition.id, false);
      await putWorkflow(app, session.workflowId, nodes, edges);
      const after = (await view(app, session.id)).turns[0]!;
      expect(after.writes.map((item) => item.nodeLabel)).toEqual([undefined, undefined]);
      expect(after.writes.map((item) => item.definitionName)).toEqual(['counter', 'counter']);
    } finally {
      await app.close();
    }
  });

  it('numbers the turns that still count and marks the ones whose replies were deleted', async () => {
    const { app } = await apps.open();
    try {
      const { session } = await logging(app);
      for (let index = 0; index < 3; index++) await turn(app, session.id);
      const rows = assistantRows(await readSession(app, session.id));
      await deleteMessage(app, session.id, rows[1]!.id);
      let state = await view(app, session.id);
      expect(state.turns.map((item) => item.turnNumber)).toEqual([1, null, 2]);
      expect(state.turn).toBe(3);
      // The stored writes of the hidden turn are still listed; they just no longer count.
      expect(state.turns[1]!.writes).toHaveLength(2);
      expect(counter(state).values.n).toBe(3);
      // Deleting the last reply rewinds the values.
      await deleteMessage(app, session.id, rows[2]!.id);
      state = await view(app, session.id);
      expect(state.turns.map((item) => item.turnNumber)).toEqual([1, null, null]);
      expect(counter(state).values.n).toBe(1);
      expect(counter(state).meta.n).toEqual({ written: true, turnsSinceWrite: 1, writtenAtTurn: 1 });
      expect(state.turn).toBe(2);
    } finally {
      await app.close();
    }
  });

  it('does not change when only a user message is deleted', async () => {
    const { app } = await apps.open();
    try {
      const { session } = await logging(app);
      await turn(app, session.id);
      await turn(app, session.id);
      const before = await view(app, session.id);
      const [user] = (await readSession(app, session.id)).messages;
      await deleteMessage(app, session.id, user!.id);
      expect(await view(app, session.id)).toEqual(before);
    } finally {
      await app.close();
    }
  });

  it('reports a stored value that no longer fits as the default with a warning, without touching the data', async () => {
    const { app } = await apps.open();
    try {
      const { definition, session } = await logging(app);
      await turn(app, session.id);
      await turn(app, session.id);
      const stored = (await readSession(app, session.id)).state;
      await app.inject({
        method: 'PUT',
        url: `/api/state-definitions/${definition.id}`,
        payload: {
          name: 'counter',
          keys: { n: { type: 'number', min: 0, max: 1, default: 1 }, log: { type: 'text' } },
        },
      });
      const state = await view(app, session.id);
      expect(counter(state).values).toEqual({ n: 1, log: '' });
      expect(counter(state).warnings).toEqual([
        { definition: 'counter', key: 'n', message: 'Stored value 2 is above max 1; using default 1' },
        {
          definition: 'counter',
          key: 'log',
          message: '2 stored writes were made for another key type and are ignored',
        },
      ]);
      expect((await readSession(app, session.id)).state).toEqual(stored);
    } finally {
      await app.close();
    }
  });

  it("shows a node's own state with the node's name, and drops the name when the node is gone", async () => {
    const { app } = await apps.open();
    try {
      const deck = (
        await app.inject({
          method: 'POST',
          url: '/api/collections',
          payload: { name: 'Deck', entries: [{ text: 'storm' }, { text: 'fog' }] },
        })
      ).json() as Collection;
      const workflow = await makeWorkflow(
        app,
        [
          node('input', 'chat-input'),
          node('pick', 'draw', { collectionIds: [deck.id], avoidRecent: 1 }),
          node('output', 'chat-output'),
        ],
        [edge('pick', 'text', 'output', 'value')],
      );
      const session = await makeSession(app, workflow.id);
      const first = (await turn(app, session.id))[0]!;
      const second = (await turn(app, session.id))[0]!;
      const state = await view(app, session.id);
      expect(state.definitions).toEqual([]);
      expect(state.nodes).toHaveLength(1);
      const [pick] = state.nodes;
      expect(pick).toMatchObject({ nodeId: 'pick', label: 'Draw #1 (draw)' });
      expect((pick!.values.draws as Array<{ text: string }>).map((item) => item.text)).toEqual([second, first]);
      expect(pick!.meta.draws).toMatchObject({ written: true, count: 2, writtenAtTurn: 2 });
      expect(pick!.history.draws).toEqual([
        { turn: 1, value: 1 },
        { turn: 2, value: 2 },
      ]);
      expect(state.turns[0]!.writes[0]).toMatchObject({ nodeLabel: 'Draw #1 (draw)' });
      expect(state.turns[0]!.writes[0]!.definitionName).toBeUndefined();
      // The node is removed from the workflow: its state stays, nameless.
      await putWorkflow(
        app,
        workflow.id,
        [node('input', 'chat-input'), node('output', 'chat-output')],
        [edge('input', 'message', 'output', 'value')],
      );
      const nameless = (await view(app, session.id)).nodes[0]!;
      expect(nameless.nodeId).toBe('pick');
      expect(nameless.label).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('agrees with the shared fold of the stored session', async () => {
    const { app } = await apps.open();
    try {
      const { session } = await logging(app);
      for (const message of ['a', 'b', 'c']) await turn(app, session.id, message);
      const rows = assistantRows(await readSession(app, session.id));
      await deleteMessage(app, session.id, rows[1]!.id);
      const stored = await readSession(app, session.id);
      const definitions = oldestFirst(
        (await app.inject({ method: 'GET', url: '/api/state-definitions' })).json() as StateDefinition[],
      );
      const story = foldStoryState({ definitions, messages: stored.messages, state: stored.state });
      const state = await view(app, session.id);
      expect(state.turn).toBe(story.turn);
      expect(state.turns.map((item) => item.turnNumber)).toEqual(story.turns.map((item) => item.turn));
      expect(counter(state).values).toEqual(
        Object.fromEntries(Object.entries(story.definitions[0]!.keys).map(([key, folded]) => [key, folded.value])),
      );
    } finally {
      await app.close();
    }
  });

  it('answers 404 for an unknown chat and 400 for a malformed id', async () => {
    const { app } = await apps.open();
    try {
      const missing = await app.inject({ method: 'GET', url: `/api/sessions/${randomUUID()}/state` });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.code).toBe('NOT_FOUND');
      const malformed = await app.inject({ method: 'GET', url: '/api/sessions/not-an-id/state' });
      expect(malformed.statusCode).toBe(400);
      expect(malformed.json().error.code).toBe('VALIDATION_ERROR');
    } finally {
      await app.close();
    }
  });
});
