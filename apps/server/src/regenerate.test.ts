import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { activeMessages, alternativesOfLastTurn, apiContract } from '@st/shared';
import { parseEventStream } from './test-support/event-stream.js';
import { altHarness, altRows, counterN, regenerate, regenerateStream, swipe } from './test-support/alternatives.js';
import { entriesOf, readSession, send, turn } from './test-support/story.js';

const harness = altHarness('regenerate');
afterEach(() => harness.cleanup());

describe('regenerate', () => {
  it('shows the new replies, keeps the old ones inactive and stores no user message', async () => {
    const { app, session } = await harness.setup();
    expect(await turn(app, session.id, 'hello')).toEqual(['alt=1 n=0 turn=1 msg=hello hist=0']);
    const first = await readSession(app, session.id);
    const rootId = first.messages[1]!.executionId!;

    const response = await regenerate(app, session.id);
    expect(response.statusCode, response.body).toBe(200);
    const result = apiContract.regenerate.response.parse(response.json());
    // The turn runs again on the same input: n is back to what the turn started from, the turn number is the same.
    expect(result.userMessage).toBeUndefined();
    expect(result.assistantMessages.map((message) => message.content)).toEqual(['alt=2 n=0 turn=1 msg=hello hist=0']);

    const saved = await readSession(app, session.id);
    expect(saved.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'assistant']);
    expect(altRows(saved)).toEqual([
      { content: 'alt=1 n=0 turn=1 msg=hello hist=0', executionId: rootId, alternativeOf: undefined, inactive: true },
      {
        content: 'alt=2 n=0 turn=1 msg=hello hist=0',
        executionId: result.execution.id,
        alternativeOf: rootId,
        inactive: undefined,
      },
    ]);
    expect(saved.messages[1]).toHaveProperty('inactive', true);
    expect(saved.messages[2]).not.toHaveProperty('inactive');
    expect(activeMessages(saved.messages)).toHaveLength(2);
    // Both turns have an entry; only the shown alternative's writes apply.
    expect(entriesOf(saved).map((entry) => [entry.executionId, entry.replies])).toEqual([
      [rootId, 1],
      [result.execution.id, 1],
    ]);
    expect(await counterN(app, session.id)).toBe(2);
    expect(saved.updatedAt >= first.updatedAt).toBe(true);
    const listed = (await app.inject({ method: 'GET', url: '/api/sessions' })).json();
    expect(listed[0].messageCount).toBe(2);

    // A third alternative: the shown one is always the newest, and the group keeps all of them.
    await regenerate(app, session.id);
    const third = await readSession(app, session.id);
    expect(alternativesOfLastTurn(third.messages)).toMatchObject({
      rootId,
      activeIndex: 2,
      alternatives: [{ executionId: rootId }, { executionId: result.execution.id }, {}],
    });
    expect(altRows(third).map((row) => row.inactive)).toEqual([true, true, undefined]);
    expect(await counterN(app, session.id)).toBe(3);
  });

  it('runs on the history before the turn, with the state without the last turn and the same turn number', async () => {
    const { app, session } = await harness.setup();
    await turn(app, session.id, 'one');
    expect(await turn(app, session.id, 'two')).toEqual(['alt=2 n=1 turn=2 msg=two hist=2']);
    const result = apiContract.regenerate.response.parse((await regenerate(app, session.id)).json());
    // n is still 1 (the written 2 belongs to the turn being regenerated), the history has the first exchange only.
    expect(result.assistantMessages.map((message) => message.content)).toEqual(['alt=3 n=1 turn=2 msg=two hist=2']);
    const saved = await readSession(app, session.id);
    expect(saved.messages.map((message) => [message.role, message.inactive === true])).toEqual([
      ['user', false],
      ['assistant', false],
      ['user', false],
      ['assistant', true],
      ['assistant', false],
    ]);
    // Only the last turn can be regenerated again, and the first turn's reply is still the first turn's.
    expect(await counterN(app, session.id)).toBe(3);
  });

  it('regenerates a turn that was an empty send with an empty message', async () => {
    const { app, session } = await harness.setup();
    expect(await turn(app, session.id, '')).toEqual(['alt=1 n=0 turn=1 msg= hist=0']);
    const result = apiContract.regenerate.response.parse((await regenerate(app, session.id)).json());
    expect(result.assistantMessages.map((message) => message.content)).toEqual(['alt=2 n=0 turn=1 msg= hist=0']);
    expect((await readSession(app, session.id)).messages.map((message) => message.role)).toEqual([
      'assistant',
      'assistant',
    ]);
  });

  it('streams the same events as a message, from turn.start to turn.complete', async () => {
    const { app, session } = await harness.setup();
    await turn(app, session.id, 'hello');
    const response = await regenerateStream(app, session.id);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    const events = parseEventStream(response.body).map(({ data }) => apiContract.streamRegenerate.response.parse(data));
    expect(events[0]!.type).toBe('turn.start');
    const done = events.at(-1)!;
    expect(done).toMatchObject({
      type: 'turn.complete',
      assistantMessages: [{ content: expect.stringContaining('alt=2') }],
    });
    expect(done).not.toHaveProperty('userMessage');
    expect(altRows(await readSession(app, session.id)).map((row) => row.inactive)).toEqual([true, undefined]);
  });

  it('answers 409 NOTHING_TO_REGENERATE as plain JSON when there is no reply to regenerate', async () => {
    const { app, session } = await harness.setup();
    for (const request of [regenerate, regenerateStream]) {
      const response = await request(app, session.id);
      expect(response.statusCode).toBe(409);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.json().error.code).toBe('NOTHING_TO_REGENERATE');
    }
    expect((await regenerate(app, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await readSession(app, session.id)).messages).toEqual([]);
    expect(entriesOf(await readSession(app, session.id))).toEqual([]);
  });

  it('treats an old session (no alternative fields, a reply without execution) as before', async () => {
    const { app, session, directory } = await harness.setup();
    // Stored before replies kept their execution: there is no turn to run again, but the chat works as ever.
    const old = {
      ...session,
      messages: [
        { id: 'a', role: 'user', content: 'hi', createdAt: '2024-01-01T00:00:00.000Z' },
        { id: 'b', role: 'assistant', content: 'hello', createdAt: '2024-01-01T00:00:01.000Z' },
      ],
    };
    await writeFile(join(directory, 'sessions', `${session.id}.json`), JSON.stringify(old));
    const refused = await regenerate(app, session.id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('NOTHING_TO_REGENERATE');
    expect(await turn(app, session.id, 'next')).toEqual(['alt=1 n=0 turn=1 msg=next hist=2']);
    // From that turn on, it can be regenerated: the old messages are the history it runs on.
    const result = apiContract.regenerate.response.parse((await regenerate(app, session.id)).json());
    expect(result.assistantMessages[0]!.content).toBe('alt=2 n=0 turn=1 msg=next hist=2');
    expect((await app.inject({ method: 'GET', url: '/api/sessions' })).json()[0].messageCount).toBe(4);
  });

  it('keeps swipes out of the way of a message sent after: only the shown alternative stays in the chat', async () => {
    const { app, session } = await harness.setup();
    await turn(app, session.id, 'one');
    await regenerate(app, session.id);
    // The hidden alternative is not in the chat: the next turn's history is the user message and the shown reply.
    expect(await turn(app, session.id, 'two')).toEqual(['alt=3 n=2 turn=2 msg=two hist=2']);
    const saved = await readSession(app, session.id);
    expect(alternativesOfLastTurn(saved.messages)?.alternatives).toHaveLength(1);
    // The turn that was regenerated is no longer the last one: its alternatives cannot be shown any more.
    const old = altRows(saved)[0]!;
    expect((await swipe(app, session.id, old.executionId!)).statusCode).toBe(400);
    expect((await regenerate(app, session.id)).statusCode).toBe(200);
    expect(await send(app, session.id, 'three').then((r) => r.statusCode)).toBe(200);
  });
});
