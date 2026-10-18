import { afterEach, describe, expect, it } from 'vitest';
import { fingerprintMessages, readTurnEntries } from '@st/shared';
import { gateNode, stateView, waitForPostRun } from './test-support/post.js';
import { deleteMessage, readExecution, send } from './test-support/story.js';
import { holdStarted, linkHarness, patchMessage, say, storedItems } from './test-support/links.js';

// The check happens at settle time, under the session lock, against the chat as it is THEN.

const harness = linkHarness('links-commit');
let gate: ReturnType<typeof gateNode> | undefined;
afterEach(async () => {
  gate?.dispose();
  gate = undefined;
  await harness.cleanup();
});

const DROPPED_EDITED =
  'memory.summaries: the item "stale summary" was not saved: a message it links to was edited while it was being written.';
const DROPPED_GONE =
  'memory.summaries: the item "stale summary" was not saved: a message it links to is not in the chat any more.';
const turnsOf = async (app: Parameters<typeof storedItems>[0], sessionId: string) =>
  (await stateView(app, sessionId)).turns;

describe('a linked item whose messages changed while it was being written', () => {
  it.each(['edited', 'deleted'] as const)(
    'after the reply, %s: is dropped, the run completes, and its log and the turn say so',
    async (change) => {
      gate = gateNode();
      const { app, session } = await harness.chat({ via: { type: 'post-gate-test', id: 'gate' } });
      await say(app, session, 'u1');
      await say(app, session, 'u2');
      // Turn 3's after-reply run plans the chunk m1 m2 and waits at the gate.
      expect((await send(app, session.id, 'u3')).statusCode).toBe(200);
      await gate.started;
      const first = (await storedItems(app, session.id)).session.messages[0]!.id;
      const changed =
        change === 'edited'
          ? await patchMessage(app, session.id, first, 'u1 changed')
          : await deleteMessage(app, session.id, first);
      expect(changed.statusCode).toBe(change === 'edited' ? 200 : 204);
      gate.release('stale summary');
      const done = await waitForPostRun(app, session.id, 'completed');
      expect((await storedItems(app, session.id)).items).toEqual([]);
      const warning = change === 'edited' ? DROPPED_EDITED : DROPPED_GONE;
      expect((await readExecution(app, done.postExecutionId!)).warnings).toEqual([warning]);
      expect((await turnsOf(app, session.id)).at(-1)!.linkWarnings).toEqual([warning]);
    },
  );

  it('in the reply: is dropped, and the warning is in the response, the stored log and the turn', async () => {
    gate = gateNode();
    const { app, session } = await harness.chat({ inReply: true, via: { type: 'post-gate-test', id: 'gate' } });
    gate.release('s');
    for (const text of ['u1', 'u2']) expect((await send(app, session.id, text)).statusCode).toBe(200);
    // From now on every run waits for a new gate.
    gate.dispose();
    gate = gateNode();
    const pending = send(app, session.id, 'u3');
    await gate.started;
    const { session: held } = await storedItems(app, session.id);
    await patchMessage(app, session.id, held.messages[1]!.id, 'changed while summarizing');
    gate.release('stale summary');
    const response = await pending;
    expect(response.statusCode).toBe(200);
    const result = response.json();
    expect(result.execution.warnings).toContain(DROPPED_EDITED);
    expect((await readExecution(app, result.execution.id)).warnings).toContain(DROPPED_EDITED);
    expect((await storedItems(app, session.id)).items.map((item) => item.text)).not.toContain('stale summary');
    expect((await turnsOf(app, session.id)).at(-1)!.linkWarnings).toEqual([DROPPED_EDITED]);
  });

  it('is not dropped by an edit of a message outside the chunk', async () => {
    gate = gateNode();
    const { app, session } = await harness.chat({ via: { type: 'post-gate-test', id: 'gate' } });
    await say(app, session, 'u1');
    await say(app, session, 'u2');
    await send(app, session.id, 'u3');
    await gate.started;
    const { session: held } = await storedItems(app, session.id);
    expect((await patchMessage(app, session.id, held.messages[2]!.id, 'outside the chunk')).statusCode).toBe(200);
    gate.release('kept summary');
    await waitForPostRun(app, session.id, 'completed');
    expect((await storedItems(app, session.id)).items.map((item) => item.text)).toEqual(['kept summary']);
  });
});

describe('linking to the messages of the turn itself', () => {
  it('takes the fingerprint at commit time: the post run links to its own reply by id alone', async () => {
    const { app, session } = await harness.chat({ linkToReplies: true });
    for (const text of ['u1', 'u2', 'u3']) await say(app, session, text);
    const { session: stored, items } = await storedItems(app, session.id);
    const reply = stored.messages.filter((message) => message.executionId === stored.state!.turns[2]!.executionId);
    const assistant = reply.find((message) => message.role === 'assistant')!;
    expect(items).toHaveLength(1);
    expect(items[0]!.messages).toEqual({ ids: [assistant.id], fingerprint: fingerprintMessages([assistant]) });
  });

  it('drops it when that reply is gone by the time the run settles', async () => {
    gate = gateNode();
    const { app, session } = await harness.chat({
      linkToReplies: true,
      via: { type: 'post-gate-test', id: 'gate' },
    });
    await say(app, session, 'u1');
    await say(app, session, 'u2');
    await send(app, session.id, 'u3');
    await gate.started;
    const { session: held } = await storedItems(app, session.id);
    const lastReply = held.messages.filter((message) => message.role === 'assistant').at(-1)!;
    await deleteMessage(app, session.id, lastReply.id);
    gate.release('stale summary');
    await waitForPostRun(app, session.id, 'completed');
    expect((await storedItems(app, session.id)).items).toEqual([]);
    expect((await turnsOf(app, session.id)).at(-1)!.linkWarnings).toEqual([DROPPED_GONE]);
  });
});

describe('linked items written in the reply part', () => {
  it('are committed with the turn, before the next message', async () => {
    const { app, session } = await harness.chat({ inReply: true });
    for (const text of ['u1', 'u2', 'u3']) await say(app, session, text, false);
    const { items, session: stored } = await storedItems(app, session.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      text: 'S[user: u1]',
      messages: { ids: stored.messages.slice(0, 2).map((message) => message.id) },
    });
    expect(items[0]!.messages!.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(readTurnEntries(stored.state).at(-1)!.writes).toHaveLength(1);
  });
});

describe('a failed or stopped run', () => {
  it('keeps the linked item a completed State Write stored when the reply turn fails', async () => {
    const { app, session } = await harness.chat({ inReply: true, failAfterSave: true });
    for (const text of ['u1', 'u2']) await say(app, session, text, false);
    const failed = await send(app, session.id, 'u3');
    expect(failed.statusCode).toBe(500);
    expect(failed.body).toContain('the failer failed');
    expect((await storedItems(app, session.id)).items.map((item) => item.text)).toEqual(['S[user: u1]']);
  });

  it('keeps it when the turn is stopped after State Write completed', async () => {
    const { app, session } = await harness.chat({ inReply: true, holdAfterSave: true });
    const held = holdStarted();
    for (const text of ['u1', 'u2'])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/sessions/${session.id}/messages`,
            payload: { content: text },
          })
        ).statusCode,
      ).toBe(200);
    const turn = app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages/stream`,
      payload: { content: 'u3' },
    });
    await held;
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/stop` })).statusCode).toBe(204);
    expect((await turn).body).toContain('TURN_STOPPED');
    expect((await storedItems(app, session.id)).items.map((item) => item.text)).toEqual(['S[user: u1]']);
  });

  it('keeps it when the after-reply run fails after State Write completed', async () => {
    const { app, session } = await harness.chat({ failAfterSave: true });
    for (const text of ['u1', 'u2']) await say(app, session, text);
    await send(app, session.id, 'u3');
    const failed = await waitForPostRun(app, session.id, 'error');
    expect(failed.postError).toContain('the failer failed');
    expect((await storedItems(app, session.id)).items.map((item) => item.text)).toEqual(['S[user: u1]']);
  });
});
