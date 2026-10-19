import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { apiContract, type Session } from '@st/shared';
import {
  assistantRows,
  counting,
  define,
  deleteMessage,
  edge,
  entriesOf,
  makeSession,
  makeWorkflow,
  node,
  putWorkflow,
  readExecution,
  readSession,
  send,
  tempApps,
  turn,
} from './test-support/story.js';

const apps = tempApps('story-state');
afterEach(() => apps.cleanup());

async function started(bump = true) {
  const { app, directory } = await apps.open();
  const definition = await define(app);
  const { nodes, edges } = counting(definition.id, bump);
  const workflow = await makeWorkflow(app, nodes, edges);
  const session = await makeSession(app, workflow.id);
  return { app, directory, definition, workflow, session };
}

describe('turns with story state', () => {
  it('stores one entry per settled turn: the post-value, clamped, with the writing node', async () => {
    const { app, definition, session } = await started();
    try {
      const texts: string[] = [];
      for (let index = 0; index < 7; index++) texts.push((await turn(app, session.id))[0]!);
      expect(texts).toEqual([
        'n=0 turn=1',
        'n=1 turn=2',
        'n=2 turn=3',
        'n=3 turn=4',
        'n=4 turn=5',
        'n=5 turn=6',
        'n=5 turn=7',
      ]);
      const entries = entriesOf(await readSession(app, session.id));
      expect(entries).toHaveLength(7);
      // Each write is tagged with the run that made it (a chat of one workflow: the run is the turn).
      expect(entries.map((entry) => entry.writes)).toEqual(
        [1, 2, 3, 4, 5, 5, 5].map((value, index) => [
          {
            op: 'set',
            target: { kind: 'definition', definitionId: definition.id, key: 'n' },
            nodeId: 'bump',
            runId: entries[index]!.executionId,
            value,
          },
        ]),
      );
      for (const entry of entries) expect(entry).toMatchObject({ completed: true, replies: 1 });
      expect(entries.map((entry) => entry.executionId)).toEqual(
        (await readSession(app, session.id)).messages.filter((m) => m.role === 'assistant').map((m) => m.executionId),
      );
    } finally {
      await app.close();
    }
  });

  it('appends an entry for a turn without writes, and counts it', async () => {
    const { app, session } = await started(false);
    try {
      expect(await turn(app, session.id)).toEqual(['n=0 turn=1']);
      expect(await turn(app, session.id)).toEqual(['n=0 turn=2']);
      const entries = entriesOf(await readSession(app, session.id));
      expect(entries.map((entry) => [entry.completed, entry.replies, entry.writes])).toEqual([
        [true, 1, []],
        [true, 1, []],
      ]);
    } finally {
      await app.close();
    }
  });

  describe('deleting messages', () => {
    // Three turns: the chat shows n=2 turn=3 on the last one, and each turn wrote n+1.
    async function threeTurns() {
      const fixture = await started();
      for (let index = 0; index < 3; index++) await turn(fixture.app, fixture.session.id);
      return { ...fixture, saved: await readSession(fixture.app, fixture.session.id) };
    }
    const replyOf = (saved: Session, index: number) => assistantRows(saved)[index]!;

    it('rewinds when the last reply is deleted: the value and the turn number come back', async () => {
      const { app, session, saved } = await threeTurns();
      try {
        expect((await deleteMessage(app, session.id, replyOf(saved, 2).id)).statusCode).toBe(204);
        // Turn 3 again, and n is what turn 2 stored.
        expect(await turn(app, session.id)).toEqual(['n=2 turn=3']);
      } finally {
        await app.close();
      }
    });

    it('keeps later values when a middle reply is deleted, and renumbers the turns', async () => {
      const { app, session, saved } = await threeTurns();
      try {
        await deleteMessage(app, session.id, replyOf(saved, 1).id);
        // Turn 3 stored n=3 and still counts as a turn, now the second; the next one is turn 3.
        expect(await turn(app, session.id)).toEqual(['n=3 turn=3']);
      } finally {
        await app.close();
      }
    });

    it('does not undo anything when only the user message of a turn is deleted', async () => {
      const { app, session, saved } = await threeTurns();
      try {
        const user = saved.messages.filter((message) => message.role === 'user');
        for (const message of user) expect((await deleteMessage(app, session.id, message.id)).statusCode).toBe(204);
        expect(await turn(app, session.id)).toEqual(['n=3 turn=4']);
      } finally {
        await app.close();
      }
    });

    it('does not rewrite the stored entries', async () => {
      const { app, session, saved } = await threeTurns();
      try {
        await deleteMessage(app, session.id, replyOf(saved, 2).id);
        expect(entriesOf(await readSession(app, session.id))).toEqual(entriesOf(saved));
      } finally {
        await app.close();
      }
    });

    it('brings a turn back as a turn only through new replies, never through its old entry', async () => {
      const { app, session, saved } = await threeTurns();
      try {
        for (const row of assistantRows(saved)) await deleteMessage(app, session.id, row.id);
        expect(await turn(app, session.id)).toEqual(['n=0 turn=1']);
        expect(entriesOf(await readSession(app, session.id))).toHaveLength(4);
      } finally {
        await app.close();
      }
    });

    it('undoes a turn with several replies only when all of them are deleted', async () => {
      const { app, definition } = await started();
      try {
        const workflow = await makeWorkflow(
          app,
          [
            node('input', 'chat-input'),
            node('bump', 'state-write', { definitionId: definition.id, key: 'n', op: 'increment' }),
            node('first', 'chat-output', { order: 0, template: 'A n={{state.counter.n}}' }),
            node('second', 'chat-output', { order: 1, template: 'B turn={{trigger.turn}}' }),
          ],
          [edge('input', 'message', 'first', 'value'), edge('input', 'message', 'second', 'value')],
          'Two replies',
        );
        const session = await makeSession(app, workflow.id);
        expect(await turn(app, session.id)).toEqual(['A n=0', 'B turn=1']);
        expect(await turn(app, session.id)).toEqual(['A n=1', 'B turn=2']);
        const second = assistantRows(await readSession(app, session.id)).slice(2);
        expect(second).toHaveLength(2);
        expect(entriesOf(await readSession(app, session.id))[1]).toMatchObject({ replies: 2 });
        await deleteMessage(app, session.id, second[0]!.id);
        // One reply of turn 2 is left: the turn is still there.
        expect(await turn(app, session.id)).toEqual(['A n=2', 'B turn=3']);
        const third = assistantRows(await readSession(app, session.id)).slice(-2);
        for (const row of third) await deleteMessage(app, session.id, row.id);
        // Both replies of turn 3 are gone: what it wrote (n=3) is undone and its number is free again.
        expect(await turn(app, session.id)).toEqual(['A n=2', 'B turn=3']);
      } finally {
        await app.close();
      }
    });
  });

  it('keeps chats apart and numbers the turns of one chat in order, even when sends overlap', async () => {
    const { app, workflow, session } = await started();
    try {
      const other = await makeSession(app, workflow.id);
      const [first, second, elsewhere] = await Promise.all([
        send(app, session.id),
        send(app, session.id),
        send(app, other.id),
      ]);
      const text = (response: { json(): unknown }) =>
        apiContract.sendMessage.response.parse(response.json()).assistantMessages[0]!.content;
      expect([text(first), text(second)]).toEqual(['n=0 turn=1', 'n=1 turn=2']);
      expect(text(elsewhere)).toBe('n=0 turn=1');
    } finally {
      await app.close();
    }
  });
});

describe('definition edits', () => {
  it('reads a value that no longer fits as the default, warns, and never rewrites the stored data', async () => {
    const { app, definition, workflow, session } = await started();
    try {
      await turn(app, session.id);
      await turn(app, session.id);
      // Reading only from now on: the same chat, a workflow without the State Write.
      const reading = counting(definition.id, false);
      await putWorkflow(app, workflow.id, reading.nodes, reading.edges);
      const before = (await readSession(app, session.id)).state;
      const edit = (keys: object) =>
        app.inject({
          method: 'PUT',
          url: `/api/state-definitions/${definition.id}`,
          payload: { name: 'counter', keys },
        });
      // Lower the maximum below the stored value (2).
      expect((await edit({ n: { type: 'number', min: 0, max: 1, default: 1 } })).statusCode).toBe(200);
      expect((await readSession(app, session.id)).state).toEqual(before);
      const response = await send(app, session.id);
      const result = apiContract.sendMessage.response.parse(response.json());
      expect(result.assistantMessages[0]!.content).toBe('n=1 turn=3');
      expect((await readExecution(app, result.execution!.id)).warnings).toEqual([
        'State "counter.n": Stored value 2 is above max 1; using default 1.',
      ]);
      // Another type altogether: the number key is now an enum.
      await edit({ n: { type: 'enum', options: ['low', 'high'] } });
      expect(await turn(app, session.id)).toEqual(['n=low turn=4']);
      // Back to the original declaration: the stored value is there again.
      await edit({ n: { type: 'number', min: 0, max: 5 } });
      expect(await turn(app, session.id)).toEqual(['n=2 turn=5']);
      expect(entriesOf(await readSession(app, session.id)).slice(0, 2)).toEqual(
        entriesOf({ state: before } as Session),
      );
    } finally {
      await app.close();
    }
  });
});

describe('older and damaged sessions', () => {
  // The stored file is returned as it is, so a damaged `state` is not a valid session body.
  const rawSession = async (app: Awaited<ReturnType<typeof started>>['app'], id: string) =>
    (await app.inject({ method: 'GET', url: `/api/sessions/${id}` })).json() as {
      state: { turns: unknown[]; extra?: string };
    };

  async function stored(directory: string, workflowId: string, extra: object) {
    const id = randomUUID();
    const date = '2026-01-01T00:00:00.000Z';
    await mkdir(join(directory, 'sessions'), { recursive: true });
    await writeFile(
      join(directory, 'sessions', `${id}.json`),
      JSON.stringify({ id, title: 'Old', workflowId, messages: [], createdAt: date, updatedAt: date, ...extra }),
    );
    return id;
  }

  it('runs a session saved before story state as turn 1, and starts its state', async () => {
    const { app, directory, workflow } = await started();
    try {
      const date = '2026-01-01T00:00:00.000Z';
      // Earlier turns exist as messages but have no entries: they are not counted.
      const id = await stored(directory, workflow.id, {
        messages: [
          { id: randomUUID(), role: 'user', content: 'hi', createdAt: date, executionId: 'old' },
          { id: randomUUID(), role: 'assistant', content: 'hello', createdAt: date, executionId: 'old' },
        ],
      });
      expect(await turn(app, id)).toEqual(['n=0 turn=1']);
      const saved = await readSession(app, id);
      expect(saved.messages).toHaveLength(4);
      expect(entriesOf(saved)).toHaveLength(1);
      expect(await turn(app, id)).toEqual(['n=1 turn=2']);
    } finally {
      await app.close();
    }
  });

  it.each([
    ['text', 'x'],
    ['a list', []],
    ['turns that are not a list', { turns: {} }],
    ['entries that are not entries', { turns: ['x', 1, { executionId: 3 }] }],
    ['null', null],
  ])('runs a turn when the stored state is %s', async (_, state) => {
    const { app, directory, workflow } = await started();
    try {
      const id = await stored(directory, workflow.id, { state });
      expect(await turn(app, id)).toEqual(['n=0 turn=1']);
      expect(entriesOf((await rawSession(app, id)) as unknown as Session)).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('keeps entries it cannot read in the file when it appends', async () => {
    const { app, directory, workflow } = await started();
    try {
      const id = await stored(directory, workflow.id, { state: { turns: [{ weird: true }], extra: 'kept' } });
      await turn(app, id);
      const saved = await rawSession(app, id);
      expect(saved.state.turns).toHaveLength(2);
      expect(saved.state.turns[0]).toEqual({ weird: true });
      expect(saved.state.extra).toBe('kept');
    } finally {
      await app.close();
    }
  });
});
