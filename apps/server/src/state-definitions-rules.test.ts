import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  errorEnvelopeSchema,
  stateDefinitionInUseDetailsSchema,
  type StateDefinition,
  type StateWrite,
  type TurnEntry,
} from '@st/shared';
import { createApp } from './app.js';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'state-rules-test-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const open = async () => createApp(directory, { seed: false });
type App = Awaited<ReturnType<typeof open>>;
const call = (app: App, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, payload });
const body = { name: 'scene', keys: { tension: { type: 'number', min: 0, max: 10 } } };
const date = '2026-01-01T00:00:00.000Z';

async function define(app: App, name = 'scene'): Promise<StateDefinition> {
  return (await call(app, 'POST', '/api/state-definitions', { ...body, name })).json() as StateDefinition;
}

/** Writes a session file as an earlier run would have left it: one turn that wrote `tension` of the definition. */
async function chat(
  title: string,
  definitionId: string,
  options: { reply?: boolean; completed?: boolean; writes?: StateWrite[] } = {},
) {
  const { reply = true, completed = true } = options;
  const id = randomUUID();
  const executionId = randomUUID();
  const replyId = randomUUID();
  const write: StateWrite = {
    op: 'set',
    target: { kind: 'definition', definitionId, key: 'tension' },
    nodeId: 'writer',
    value: 5,
  };
  const entry: TurnEntry = {
    executionId,
    at: date,
    completed,
    replies: reply ? 1 : 0,
    writes: options.writes ?? [write],
  };
  const messages = [
    { id: randomUUID(), role: 'user', content: 'hi', createdAt: date, executionId },
    ...(reply ? [{ id: replyId, role: 'assistant', content: 'hello', createdAt: date, executionId }] : []),
  ];
  await mkdir(join(directory, 'sessions'), { recursive: true });
  await writeFile(
    join(directory, 'sessions', `${id}.json`),
    JSON.stringify({
      id,
      title,
      workflowId: randomUUID(),
      messages,
      state: { turns: [entry] },
      createdAt: date,
      updatedAt: date,
    }),
  );
  return { id, replyId };
}

const refusal = (response: { statusCode: number; json(): unknown }) => {
  expect(response.statusCode).toBe(409);
  const { error } = errorEnvelopeSchema.parse(response.json());
  expect(error.code).toBe('STATE_DEFINITION_IN_USE');
  return { message: error.message, details: stateDefinitionInUseDetailsSchema.parse(error.details) };
};

describe('story state in use', () => {
  it('refuses a rename while a chat holds state under the name, naming the chat', async () => {
    const app = await open();
    try {
      const definition = await define(app);
      const { id } = await chat('Winter inn', definition.id);
      await chat('Another chat', randomUUID());
      const { message, details } = refusal(
        await call(app, 'PUT', `/api/state-definitions/${definition.id}`, { ...body, name: 'mood' }),
      );
      expect(message).toBe(
        '"scene" can\'t be renamed: story state under that name is stored in these chats: Winter inn. Templates use the name; duplicate the definition to use another one.',
      );
      expect(details).toEqual({ sessions: [{ id, title: 'Winter inn' }], workflows: [] });
      // A letter-case change is a rename too: templates are case-sensitive.
      refusal(await call(app, 'PUT', `/api/state-definitions/${definition.id}`, { ...body, name: 'Scene' }));
      expect(((await call(app, 'GET', `/api/state-definitions/${definition.id}`)).json() as StateDefinition).name).toBe(
        'scene',
      );
    } finally {
      await app.close();
    }
  });

  it('refuses a delete while a chat holds state, and lists every chat in the details', async () => {
    const app = await open();
    try {
      const definition = await define(app);
      const titles = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
      for (const title of titles) await chat(title, definition.id);
      const { message, details } = refusal(await call(app, 'DELETE', `/api/state-definitions/${definition.id}`));
      expect(details.sessions.map((session) => session.title)).toEqual(titles);
      expect(details.workflows).toEqual([]);
      expect(message).toMatch(
        /^"scene" can't be deleted: story state is stored in these chats: (\w, ){4}\w and 2 more\.$/,
      );
      expect((await call(app, 'GET', `/api/state-definitions/${definition.id}`)).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('lets keys and types change freely while data exists, never touching the chats', async () => {
    const app = await open();
    try {
      const definition = await define(app);
      const { id } = await chat('Winter inn', definition.id);
      const edits = [
        { ...body, keys: { tension: { type: 'text' } } },
        { ...body, keys: { other: { type: 'collection', cap: 3 } } },
        { ...body, description: 'edited', keys: {} },
        { ...body, keys: { tension: { type: 'number', max: 3 } } },
      ];
      for (const edit of edits) {
        const response = await call(app, 'PUT', `/api/state-definitions/${definition.id}`, edit);
        expect(response.statusCode).toBe(200);
      }
      const session = (await call(app, 'GET', `/api/sessions/${id}`)).json() as { state: { turns: TurnEntry[] } };
      expect(session.state.turns[0]?.writes).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('stops counting a chat once the reply of the writing turn is deleted', async () => {
    const app = await open();
    try {
      const definition = await define(app);
      const { id, replyId } = await chat('Winter inn', definition.id);
      refusal(await call(app, 'PUT', `/api/state-definitions/${definition.id}`, { ...body, name: 'mood' }));
      refusal(await call(app, 'DELETE', `/api/state-definitions/${definition.id}`));

      expect((await call(app, 'DELETE', `/api/sessions/${id}/messages/${replyId}`)).statusCode).toBe(204);
      expect(
        (await call(app, 'PUT', `/api/state-definitions/${definition.id}`, { ...body, name: 'mood' })).statusCode,
      ).toBe(200);
      expect((await call(app, 'DELETE', `/api/state-definitions/${definition.id}`)).statusCode).toBe(204);
    } finally {
      await app.close();
    }
  });

  it.each([
    ['a turn that made no reply and did not complete', { reply: false, completed: false }, false],
    ['a turn that made no reply but completed', { reply: false, completed: true }, true],
    ['a failed turn that kept a partial reply', { reply: true, completed: false }, true],
    ['a turn that wrote nothing', { writes: [] }, false],
    ['a turn that wrote another definition', { writes: 'other' }, false],
  ] as const)('%s', async (_, options, blocks) => {
    const app = await open();
    try {
      const definition = await define(app);
      const { writes, ...rest } = options as { writes?: 'other' | never[]; reply?: boolean; completed?: boolean };
      await chat('Chat', definition.id, {
        ...rest,
        writes:
          writes === 'other'
            ? [{ op: 'delete', target: { kind: 'definition', definitionId: randomUUID(), key: 'x' }, nodeId: 'n' }]
            : writes,
      });
      const response = await call(app, 'PUT', `/api/state-definitions/${definition.id}`, { ...body, name: 'mood' });
      expect(response.statusCode).toBe(blocks ? 409 : 200);
    } finally {
      await app.close();
    }
  });

  it('ignores sessions that have no readable state', async () => {
    const app = await open();
    try {
      const definition = await define(app);
      await mkdir(join(directory, 'sessions'), { recursive: true });
      for (const state of [undefined, 'x', { turns: 'x' }, { turns: [null, 5] }]) {
        const id = randomUUID();
        await writeFile(
          join(directory, 'sessions', `${id}.json`),
          JSON.stringify({
            id,
            title: 'Old',
            workflowId: randomUUID(),
            messages: [],
            ...(state !== undefined && { state }),
            createdAt: date,
            updatedAt: date,
          }),
        );
      }
      expect(
        (await call(app, 'PUT', `/api/state-definitions/${definition.id}`, { ...body, name: 'mood' })).statusCode,
      ).toBe(200);
    } finally {
      await app.close();
    }
  });
});

describe('workflows that use a definition', () => {
  const workflow = async (app: App, name: string, type: string, definitionId: string) =>
    (
      await call(app, 'POST', '/api/workflows', {
        name,
        nodes: [{ id: 'n', type, position: { x: 0, y: 0 }, config: { definitionId, key: 'tension' } }],
        edges: [],
      })
    ).json() as { id: string };

  it('blocks a delete (not a rename) while a State Read or State Write node uses it, naming the workflows', async () => {
    const app = await open();
    try {
      const definition = await define(app);
      const reader = await workflow(app, 'Reader', 'state-read', definition.id);
      const writer = await workflow(app, 'Writer', 'state-write', definition.id);
      // Another node type with the same config key, and another definition, do not count.
      await workflow(app, 'Unrelated', 'merge', definition.id);
      await workflow(app, 'Elsewhere', 'state-read', randomUUID());

      const { message, details } = refusal(await call(app, 'DELETE', `/api/state-definitions/${definition.id}`));
      expect(details.sessions).toEqual([]);
      expect(details.workflows).toEqual(['Reader', 'Writer']);
      expect(message).toContain('these workflows use it: Reader, Writer');
      expect(
        (await call(app, 'PUT', `/api/state-definitions/${definition.id}`, { ...body, name: 'mood' })).statusCode,
      ).toBe(200);

      await call(app, 'DELETE', `/api/workflows/${reader.id}`);
      refusal(await call(app, 'DELETE', `/api/state-definitions/${definition.id}`));
      await call(app, 'DELETE', `/api/workflows/${writer.id}`);
      expect((await call(app, 'DELETE', `/api/state-definitions/${definition.id}`)).statusCode).toBe(204);
    } finally {
      await app.close();
    }
  });

  it('reports chats and workflows together', async () => {
    const app = await open();
    try {
      const definition = await define(app);
      await workflow(app, 'Writer', 'state-write', definition.id);
      await chat('Winter inn', definition.id);
      const { message, details } = refusal(await call(app, 'DELETE', `/api/state-definitions/${definition.id}`));
      expect(details.sessions).toHaveLength(1);
      expect(details.workflows).toEqual(['Writer']);
      expect(message).toBe(
        '"scene" can\'t be deleted: story state is stored in these chats: Winter inn; these workflows use it: Writer.',
      );
    } finally {
      await app.close();
    }
  });
});
