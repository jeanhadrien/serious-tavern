import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiContract, forkPoints, type Session } from '@st/shared';
import { altHarness, altRows, counterN, regenerate, swipe } from './test-support/alternatives.js';
import { postHarness, stateView, waitForPostRun } from './test-support/post.js';
import { ChangeHub } from './services/change-events.js';
import {
  counting,
  entriesOf,
  makeWorkflow,
  node,
  readExecution,
  readSession,
  send,
  turn,
  type App,
} from './test-support/story.js';
import { linkHarness, say, storedItems } from './test-support/links.js';
import { makeListSession, patchSession, sayingWorkflow, sendTurn } from './test-support/triggers.js';

// Forking a chat from a reply: the new chat holds the source up to that turn and continues from there.

const alt = altHarness('fork');
const post = postHarness('fork-post');
const links = linkHarness('fork-links');
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([alt.cleanup(), post.cleanup(), links.cleanup()]);
});

const NOT_FOUND = '00000000-0000-4000-8000-000000000000';

const fork = (app: App, sessionId: string, messageId: string) =>
  app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/fork`, payload: { messageId } });

/** Forks and parses the answer of a fork that succeeded. */
async function forkOf(app: App, sessionId: string, messageId: string): Promise<Session> {
  const response = await fork(app, sessionId, messageId);
  expect(response.statusCode, response.body).toBe(201);
  return apiContract.forkSession.response.parse(response.json());
}

const setKeepAlternatives = (app: App, value: boolean) =>
  app.inject({ method: 'PATCH', url: '/api/app-settings', payload: { forkKeepsAlternatives: value } });

const sessionCount = async (app: App) => (await app.inject({ method: 'GET', url: '/api/sessions' })).json().length;

/** Three turns on the alt workflow; `counter.n` is the number of the run that made the reply (1, 2, 3). */
async function threeTurns() {
  const context = await alt.setup();
  for (const text of ['one', 'two', 'three']) await turn(context.app, context.session.id, text);
  const source = await readSession(context.app, context.session.id);
  return { ...context, source, replies: source.messages.filter((message) => message.role === 'assistant') };
}

describe('fork', () => {
  it('copies the chat up to the chosen reply and leaves the source alone', async () => {
    const { app, directory, session, source, replies } = await threeTurns();
    // Keys this version does not own are copied raw, and nothing is validated (the character does not exist).
    const path = join(directory, 'sessions', `${session.id}.json`);
    const raw = { ...JSON.parse(await readFile(path, 'utf8')), extra: { keep: 1 }, characterId: randomUUID() };
    await writeFile(path, JSON.stringify(raw));
    const before = await readSession(app, session.id);

    const forked = await forkOf(app, session.id, replies[1]!.id);
    expect(forked.id).not.toBe(session.id);
    expect(forked.title).toBe(`${source.title} (fork)`);
    expect(forked.forkedFrom).toEqual({ sessionId: session.id, messageId: replies[1]!.id });
    expect(forked.messages).toEqual(source.messages.slice(0, 4));
    expect(forked).toMatchObject({
      workflowId: source.workflowId,
      settings: source.settings,
      extra: { keep: 1 },
      characterId: raw.characterId,
    });
    expect(forked.createdAt).toBe(forked.updatedAt);
    expect(forked.updatedAt >= source.updatedAt).toBe(true);
    // What was answered is what was stored, and the source did not change at all.
    expect(await readSession(app, forked.id)).toEqual(forked);
    expect(await readSession(app, session.id)).toEqual(before);
    expect(before.updatedAt).toBe(source.updatedAt);
    expect(entriesOf(forked).map((entry) => entry.executionId)).toEqual(
      entriesOf(source)
        .slice(0, 2)
        .map((entry) => entry.executionId),
    );
    const listed = apiContract.listSessions.response.parse(
      (await app.inject({ method: 'GET', url: '/api/sessions' })).json(),
    );
    expect(listed.find((item) => item.id === forked.id)?.messageCount).toBe(4);
  });

  it('continues where the source stood: the same state and the next turn number', async () => {
    const { app, session, replies } = await threeTurns();
    expect(await counterN(app, session.id)).toBe(3);
    const forked = await forkOf(app, session.id, replies[1]!.id);
    expect(await counterN(app, forked.id)).toBe(2);
    const view = await stateView(app, forked.id);
    expect(view.turns.map((item) => item.turnNumber)).toEqual([1, 2]);
    // The next message is turn 3 of the fork, on the state of turn 2.
    const next = await turn(app, forked.id, 'four');
    expect(next[0]).toContain('n=2 turn=3 msg=four hist=4');
    expect(await counterN(app, forked.id)).toBe(4);
    // The source did not notice.
    expect(await counterN(app, session.id)).toBe(3);
    expect((await readSession(app, session.id)).messages).toHaveLength(6);
  });

  it('opens the log of a forked reply', async () => {
    const { app, session, replies } = await threeTurns();
    const forked = await forkOf(app, session.id, replies[0]!.id);
    const reply = forked.messages.find((message) => message.role === 'assistant')!;
    expect(reply.id).toBe(replies[0]!.id);
    const log = await readExecution(app, (reply.runId ?? reply.executionId)!);
    expect(log.status).toBe('completed');
  });

  it('keeps the ids of a turn with two workflows and offers only its last reply', async () => {
    const { app } = await alt.setup();
    const first = await sayingWorkflow(app, 'First', 'a');
    const second = await sayingWorkflow(app, 'Second', 'b');
    const session = await makeListSession(app, [{ workflowId: first.id }, { workflowId: second.id }]);
    await sendTurn(app, session.id, 'hi');
    await sendTurn(app, session.id, 'again');
    const source = await readSession(app, session.id);
    const replies = source.messages.filter((message) => message.role === 'assistant');
    expect(replies).toHaveLength(4);
    expect(forkPoints(source.messages)).toEqual([replies[1]!.id, replies[3]!.id]);

    const refused = await fork(app, session.id, replies[0]!.id);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.code).toBe('NOT_A_FORK_POINT');
    const forked = await forkOf(app, session.id, replies[1]!.id);
    expect(forked.messages).toEqual(source.messages.slice(0, 3));
    expect(forked.triggers).toEqual(source.triggers);
    expect(forked.messages.map((message) => message.runId)).toEqual(source.messages.slice(0, 3).map((m) => m.runId));
  });

  it('applies a reply-less turn before the cut and not one after it', async () => {
    const { app, definition } = await alt.setup();
    const replying = counting(definition.id);
    const reply = await makeWorkflow(app, replying.nodes, replying.edges, 'Replying');
    const silent = await makeWorkflow(
      app,
      [
        node('input', 'chat-input'),
        node('bump', 'state-write', { definitionId: definition.id, key: 'n', op: 'increment' }),
      ],
      [],
      'Silent',
    );
    const session = await makeListSession(app, [{ workflowId: reply.id }]);
    const useList = (workflowId: string) =>
      patchSession(app, session.id, { triggers: { reply: [{ workflowId, enabled: true }] } });
    await sendTurn(app, session.id, 'one');
    await useList(silent.id);
    const quiet = await sendTurn(app, session.id, 'two');
    expect(quiet.assistantMessages).toEqual([]);
    await useList(reply.id);
    await sendTurn(app, session.id, 'three');
    expect(await counterN(app, session.id)).toBe(3);
    const source = await readSession(app, session.id);
    const replies = source.messages.filter((message) => message.role === 'assistant');
    expect(replies).toHaveLength(2);

    // Cut after turn 1: the reply-less turn 2 comes later and does not apply.
    const early = await forkOf(app, session.id, replies[0]!.id);
    expect(early.messages).toHaveLength(2);
    expect(await counterN(app, early.id)).toBe(1);
    // Cut after turn 3: turn 2 is before it and applies, and keeps its number.
    const late = await forkOf(app, session.id, replies[1]!.id);
    expect(late.messages).toHaveLength(5);
    expect(await counterN(app, late.id)).toBe(3);
    expect((await stateView(app, late.id)).turns.map((item) => item.turnNumber)).toEqual([1, 2, 3]);
  });

  it('keeps the alternatives of the forked turn, which the fork can swipe and regenerate', async () => {
    const { app, session } = await alt.setup();
    await turn(app, session.id, 'hello');
    await regenerate(app, session.id);
    const source = await readSession(app, session.id);
    const [hidden, shown] = source.messages.slice(1);
    expect(forkPoints(source.messages)).toEqual([shown!.id]);

    const forked = await forkOf(app, session.id, shown!.id);
    expect(forked.messages).toEqual(source.messages);
    expect(altRows(forked).map((row) => row.inactive)).toEqual([true, undefined]);
    expect(await counterN(app, forked.id)).toBe(2);
    const swiped = await swipe(app, forked.id, hidden!.executionId!);
    expect(swiped.statusCode, swiped.body).toBe(200);
    expect(await counterN(app, forked.id)).toBe(1);
    expect(await counterN(app, session.id)).toBe(2);
    expect((await regenerate(app, forked.id)).statusCode).toBe(200);
    expect(altRows(await readSession(app, forked.id))).toHaveLength(3);
    expect(altRows(await readSession(app, session.id))).toHaveLength(2);
  });

  it('drops every hidden alternative when the app setting is off', async () => {
    const { app, session } = await alt.setup();
    await turn(app, session.id, 'hello');
    await regenerate(app, session.id);
    await turn(app, session.id, 'again');
    await regenerate(app, session.id);
    const source = await readSession(app, session.id);
    expect(source.messages.filter((message) => message.inactive)).toHaveLength(2);
    expect((await setKeepAlternatives(app, false)).statusCode).toBe(200);

    const forked = await forkOf(app, session.id, forkPoints(source.messages)[0]!);
    expect(forked.messages.some((message) => message.inactive)).toBe(false);
    expect(forked.messages.map((message) => message.id)).toEqual(
      source.messages.filter((message, index) => index < 3 && !message.inactive).map((message) => message.id),
    );
    expect(await counterN(app, forked.id)).toBe(2);
    expect(altRows(forked)).toHaveLength(1);
    // Nothing to swipe to, and the turn can still be regenerated.
    expect((await swipe(app, forked.id, source.messages[1]!.executionId!)).statusCode).toBe(400);
    expect((await regenerate(app, forked.id)).statusCode).toBe(200);
    // The source keeps all of its own.
    expect((await readSession(app, session.id)).messages).toEqual(source.messages);
  });

  it('keeps a summary written before the cut intact', async () => {
    const { app, session } = await links.chat();
    for (const text of ['u1', 'u2', 'u3', 'u4']) await say(app, session, text);
    const source = (await storedItems(app, session.id)).session;
    const replies = source.messages.filter((message) => message.role === 'assistant');
    expect((await storedItems(app, session.id)).items.length).toBeGreaterThan(1);

    const forked = await forkOf(app, session.id, replies[2]!.id);
    const { items } = await storedItems(app, forked.id);
    expect(items.map((item) => item.text)).toEqual(['S[user: u1]']);
    expect(items[0]!.messages!.ids).toEqual(source.messages.slice(0, 2).map((message) => message.id));
    const view = await stateView(app, forked.id);
    const linked = view.definitions.find((definition) => definition.name === 'memory')!.values.summaries as {
      link?: { status: string };
    }[];
    expect(linked.map((item) => item.link?.status)).toEqual(['intact']);
  });

  it('announces the new chat once and nothing for the source', async () => {
    const { app, session, replies } = await threeTurns();
    const events: { type: string; id?: string }[] = [];
    const publish = ChangeHub.prototype.publish;
    vi.spyOn(ChangeHub.prototype, 'publish').mockImplementation(function (this: ChangeHub, event) {
      events.push(event as { type: string; id?: string });
      publish.call(this, event);
    });
    const forked = await forkOf(app, session.id, replies[0]!.id);
    expect(events).toEqual([{ type: 'sessions.changed', id: forked.id }]);
  });
});

describe('fork refusals', () => {
  it('answers 404 for an unknown chat, an unknown message and a hidden alternative', async () => {
    const { app, session } = await alt.setup();
    await turn(app, session.id, 'hello');
    await regenerate(app, session.id);
    const hidden = (await readSession(app, session.id)).messages.find((message) => message.inactive)!;
    expect((await fork(app, NOT_FOUND, hidden.id)).statusCode).toBe(404);
    expect((await fork(app, session.id, 'nothing')).statusCode).toBe(404);
    expect((await fork(app, session.id, hidden.id)).statusCode).toBe(404);
    expect((await fork(app, 'not-a-uuid', hidden.id)).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/fork`, payload: {} })).statusCode,
    ).toBe(400);
    expect(await sessionCount(app)).toBe(1);
  });

  it('answers 400 NOT_A_FORK_POINT for a user message', async () => {
    const { app, session } = await alt.setup();
    await turn(app, session.id, 'hello');
    const user = (await readSession(app, session.id)).messages[0]!;
    const response = await fork(app, session.id, user.id);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('NOT_A_FORK_POINT');
    expect(await sessionCount(app)).toBe(1);
  });

  it('answers 409 TURN_RUNNING while a run after the reply holds the chat, then forks once it is done', async () => {
    const { app, gate, session } = await post.setup();
    await sendTurn(app, session.id, 'hello');
    await gate.started;
    const reply = (await readSession(app, session.id)).messages[1]!;
    const refused = await fork(app, session.id, reply.id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('TURN_RUNNING');
    expect(await sessionCount(app)).toBe(1);

    gate.release();
    await waitForPostRun(app, session.id, 'completed');
    const forked = await forkOf(app, session.id, reply.id);
    // The finished run after the reply is part of the turn, and the fork holds it as completed.
    expect(entriesOf(forked)[0]!.runs!.map((run) => run.status)).toEqual(['completed', 'completed']);
    expect((await send(app, forked.id, 'next')).statusCode).toBe(200);
  });
});
