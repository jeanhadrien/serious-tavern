import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Collection } from '@st/shared';
import { stateView } from './test-support/post.js';
import {
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
import { bumpingWorkflow, makeListSession, sendTurn } from './test-support/triggers.js';

// What a chat of several workflows keeps in a node's own state, and that a chat of one reads exactly as it did.

const apps = tempApps('triggers-state');
afterEach(() => apps.cleanup());

const DATE = '2026-01-01T00:00:00.000Z';

/** input -> Draw `pick` (avoidRecent 1, one entry) -> its reason, plus a second output telling `n` and the turn. */
async function drawingWorkflow(app: App, deckId: string, name: string, extra: object[] = []) {
  return makeWorkflow(
    app,
    [
      node('input', 'chat-input'),
      node('pick', 'draw', { collectionIds: [deckId], avoidRecent: 1 }),
      node('output', 'chat-output', { order: 0 }),
      node('told', 'chat-output', { order: 1, template: 'n={{state.counter.n}} turn={{trigger.turn}}' }),
      ...extra,
    ],
    [edge('pick', 'reason', 'output', 'value'), edge('input', 'message', 'told', 'value')],
    name,
  );
}
const makeDeck = async (app: App) =>
  (
    await app.inject({
      method: 'POST',
      url: '/api/collections',
      payload: { name: 'Deck', entries: [{ text: 'storm' }] },
    })
  ).json() as Collection;

describe('node-private state in a chat of two workflows', () => {
  it('keeps two nodes with the same id apart, each under its own workflow, in the folded state and the view', async () => {
    const { app } = await apps.open();
    try {
      await define(app);
      const deck = await makeDeck(app);
      const one = await drawingWorkflow(app, deck.id, 'One');
      const two = await drawingWorkflow(app, deck.id, 'Two');
      const session = await makeListSession(app, [{ workflowId: one.id }, { workflowId: two.id }]);
      const first = (await sendTurn(app, session.id)).assistantMessages.map((message) => message.content);
      // The second workflow's `pick` has not drawn yet: the first one's draw is not its memory.
      expect(first.filter((text) => text.startsWith('drew') || text.startsWith('no eligible'))).toEqual([
        'drew 1 of 1 eligible',
        'drew 1 of 1 eligible',
      ]);
      const second = (await sendTurn(app, session.id)).assistantMessages.map((message) => message.content);
      expect(second.filter((text) => text.startsWith('no eligible'))).toHaveLength(2);

      // Each write is stored under its workflow.
      const [entry] = entriesOf(await readSession(app, session.id));
      expect(entry!.writes.map((write) => write.target)).toEqual([
        { kind: 'node', nodeId: 'pick', key: 'draws', workflowId: one.id },
        { kind: 'node', nodeId: 'pick', key: 'draws', workflowId: two.id },
      ]);
      // The view lists them apart and names each node in its own workflow.
      const view = await stateView(app, session.id);
      // (Listed by node id, then workflow id.)
      expect(
        view.nodes.map((item) => [item.nodeId, item.workflowId, item.label]).sort((a, b) => a[1]!.localeCompare(b[1]!)),
      ).toEqual(
        [
          ['pick', one.id, 'Draw #1 (draw)'],
          ['pick', two.id, 'Draw #1 (draw)'],
        ].sort((a, b) => a[1]!.localeCompare(b[1]!)),
      );
      expect(view.turns[0]!.writes.map((write) => write.nodeLabel)).toEqual(['Draw #1 (draw)', 'Draw #1 (draw)']);
    } finally {
      await app.close();
    }
  });

  it('names a node write by its own workflow when the workflows have different nodes under the same id', async () => {
    const { app } = await apps.open();
    try {
      const deck = await makeDeck(app);
      const one = await drawingWorkflow(app, deck.id, 'One');
      // The first workflow of the list has a Random node called `pick`, and no Draw.
      const two = await makeWorkflow(
        app,
        [node('input', 'chat-input'), node('pick', 'random'), node('output', 'chat-output', { template: 'x' })],
        [edge('input', 'message', 'output', 'value')],
        'Two',
      );
      const session = await makeListSession(app, [{ workflowId: two.id }, { workflowId: one.id }]);
      await sendTurn(app, session.id);
      const view = await stateView(app, session.id);
      expect(view.nodes.map((item) => [item.workflowId, item.label])).toEqual([[one.id, 'Draw #1 (draw)']]);
    } finally {
      await app.close();
    }
  });
});

describe('a chat as it was before several workflows', () => {
  /** A chat of one workflow that played a turn, then rewritten the way an older version stored it. */
  async function legacyChat() {
    const { app, directory } = await apps.open();
    const definition = await define(app);
    const deck = await makeDeck(app);
    const workflow = await drawingWorkflow(app, deck.id, 'Old', [
      node('bump', 'state-write', { definitionId: definition.id, key: 'n', op: 'increment' }),
    ]);
    const session = await makeSession(app, workflow.id);
    expect((await turn(app, session.id)).at(0)).toBe('drew 1 of 1 eligible');
    const path = join(directory, 'sessions', `${session.id}.json`);
    const stored = JSON.parse(await readFile(path, 'utf8'));
    for (const write of stored.state.turns[0].writes) if (write.target.kind === 'node') delete write.target.workflowId;
    delete stored.triggers;
    // The entry as it was stored before entries listed their runs.
    delete stored.state.turns[0].runs;
    await writeFile(path, JSON.stringify(stored));
    return { app, workflow, session, path, before: stored.state.turns[0] };
  }

  it('reads as it did: no runs, its node’s state under no workflow', async () => {
    const { app, session, path } = await legacyChat();
    try {
      const before = await readFile(path);
      const view = await stateView(app, session.id);
      expect(view.turns[0]).not.toHaveProperty('runs');
      expect(view.turns[0]).not.toHaveProperty('postStatus');
      expect(view.nodes.map((item) => [item.nodeId, item.workflowId, item.label])).toEqual([
        ['pick', undefined, 'Draw #1 (draw)'],
      ]);
      expect((await readFile(path)).equals(before)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('runs on its workflowId, seeing the writes made before workflow ids existed, and leaves the old entry as it is', async () => {
    const { app, session, workflow, path, before } = await legacyChat();
    try {
      const result = await sendTurn(app, session.id);
      expect(result.assistantMessages.map((message) => message.content)).toEqual([
        // The old draw has no workflow id: it is this node's memory.
        'no eligible entry among 1 (1 recent excluded)',
        'n=1 turn=2',
      ]);
      expect(result.executions!.map((log) => log.workflowId)).toEqual([workflow.id]);
      const stored = JSON.parse(await readFile(path, 'utf8'));
      expect(stored.state.turns[0]).toEqual(before);
      expect(stored.state.turns[1].runs).toMatchObject([
        { workflowId: workflow.id, part: 'reply', status: 'completed' },
      ]);
      expect(stored.state.turns[1]).not.toHaveProperty('postStatus');
      // The old entry has no runs to show next to the new entry's.
      const view = await stateView(app, session.id);
      expect(view.turns.map((item) => item.runs?.length)).toEqual([undefined, 1]);
    } finally {
      await app.close();
    }
  });

  it('shows a post run stored as running that nothing holds as an error, per run', async () => {
    const { app, directory } = await apps.open();
    try {
      const id = randomUUID();
      await mkdir(join(directory, 'sessions'), { recursive: true });
      const run = (executionId: string, part: string, status: string) => ({
        executionId,
        workflowId: 'w',
        part,
        status,
      });
      await writeFile(
        join(directory, 'sessions', `${id}.json`),
        JSON.stringify({
          id,
          title: 'Stored',
          workflowId: 'w',
          messages: [],
          state: {
            turns: [
              {
                executionId: 'x',
                at: DATE,
                completed: true,
                replies: 0,
                writes: [],
                runs: [run('x', 'reply', 'completed'), run('p1', 'post', 'completed'), run('p2', 'post', 'running')],
              },
            ],
          },
          createdAt: DATE,
          updatedAt: DATE,
        }),
      );
      const [turnView] = (await stateView(app, id)).turns;
      expect(turnView!.runs!.map((item) => item.status)).toEqual(['completed', 'completed', 'error']);
      expect(turnView).toMatchObject({
        postStatus: 'error',
        postExecutionId: 'p1',
        postError: expect.stringContaining('interrupted by a server restart'),
      });
      // The workflow `w` does not exist: the run has no name, and nothing else is affected.
      expect(turnView!.runs![0]).not.toHaveProperty('workflowName');
    } finally {
      await app.close();
    }
  });
});

describe('the counter across two workflows', () => {
  it('carries on across turns: later turns see every run’s writes', async () => {
    const { app } = await apps.open();
    try {
      const definition = await define(app);
      const one = await bumpingWorkflow(app, definition.id, 'One', 'one n={{state.counter.n}}');
      const two = await bumpingWorkflow(app, definition.id, 'Two', 'two n={{state.counter.n}}');
      const session = await makeListSession(app, [{ workflowId: one.id }, { workflowId: two.id }]);
      expect(await turn(app, session.id)).toEqual(['one n=0', 'two n=1']);
      expect(await turn(app, session.id)).toEqual(['one n=2', 'two n=3']);
    } finally {
      await app.close();
    }
  });
});
