import { afterEach, describe, expect, it } from 'vitest';
import { fingerprintMessages, type ChatMessage } from '@st/shared';
import { gateNode } from './test-support/post.js';
import { postRunOf, waitForPostRun } from './test-support/post.js';
import { readExecution, send } from './test-support/story.js';
import { holdStarted, patchMessage, say, storedSummaries, summaryHarness } from './test-support/summaries.js';
import { summaryViews } from './services/summary-view.js';

// The commit happens at settle time, under the session lock, against the chat as it is THEN.

const harness = summaryHarness('summaries-commit');
let gate: ReturnType<typeof gateNode> | undefined;
afterEach(async () => {
  gate?.dispose();
  gate = undefined;
  await harness.cleanup();
});

describe('a summary whose messages changed while it was being written', () => {
  it.each(['edited', 'deleted'] as const)(
    'after the reply, %s: is dropped, the run completes, and its log says so',
    async (change) => {
      gate = gateNode();
      const { app, session } = await harness.chat({ via: { type: 'post-gate-test', id: 'gate' } });
      await say(app, session, 'u1');
      await say(app, session, 'u2');
      // Turn 3's after-reply run plans the chunk m1 m2 and waits at the gate.
      const response = await send(app, session.id, 'u3');
      expect(response.statusCode).toBe(200);
      await gate.started;
      const { session: held } = await storedSummaries(app, session.id);
      const first = held.messages[0]!.id;
      const changed =
        change === 'edited'
          ? await patchMessage(app, session.id, first, 'u1 changed')
          : await app.inject({ method: 'DELETE', url: `/api/sessions/${session.id}/messages/${first}` });
      expect(changed.statusCode).toBe(change === 'edited' ? 200 : 204);
      gate.release('a summary of the old u1');
      const done = await waitForPostRun(app, session.id, 'completed');
      expect((await storedSummaries(app, session.id)).summaries).toEqual([]);
      const log = await readExecution(app, done.postExecutionId!);
      expect(log.status).toBe('completed');
      expect(log.warnings).toEqual([
        'The summary for set "main" was not saved: a message it covers was edited or deleted while it was being written.',
      ]);
    },
  );

  it('in the reply: is dropped, and the warning is in the reply log, the response and the stored log', async () => {
    gate = gateNode();
    const { app, session } = await harness.chat({ inReply: true, via: { type: 'post-gate-test', id: 'gate' } });
    gate.release('s');
    for (const text of ['u1', 'u2']) expect((await send(app, session.id, text)).statusCode).toBe(200);
    // From now on every run waits for a new gate.
    gate.dispose();
    gate = gateNode();
    const pending = send(app, session.id, 'u3');
    await gate.started;
    const { session: held } = await storedSummaries(app, session.id);
    await patchMessage(app, session.id, held.messages[1]!.id, 'changed while summarizing');
    gate.release('stale summary');
    const response = await pending;
    expect(response.statusCode).toBe(200);
    const warning =
      'The summary for set "main" was not saved: a message it covers was edited or deleted while it was being written.';
    const result = response.json();
    expect(result.execution.warnings).toContain(warning);
    expect((await readExecution(app, result.execution.id)).warnings).toContain(warning);
    expect((await storedSummaries(app, session.id)).summaries.map((s) => s.text)).not.toContain('stale summary');
  });
});

describe('summaries written in the reply part', () => {
  it('are committed with the turn, before the next message', async () => {
    const { app, session } = await harness.chat({ inReply: true });
    for (const text of ['u1', 'u2', 'u3']) await say(app, session, text, false);
    const { summaries, session: stored } = await storedSummaries(app, session.id);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      text: 'S[user: u1]',
      messageIds: stored.messages.slice(0, 2).map((m) => m.id),
    });
    expect(summaries[0]!.executionId).toBe(stored.state!.turns.at(-1)!.executionId);
    expect(await postRunOf(app, session.id)).toEqual({});
  });
});

describe('a failed or stopped reply turn', () => {
  it('keeps the summary a completed Save Summary node stored when the turn fails', async () => {
    const { app, session } = await harness.chat({ inReply: true, failAfterSave: true });
    for (const text of ['u1', 'u2']) await say(app, session, text, false);
    const failed = await send(app, session.id, 'u3');
    expect(failed.statusCode).toBe(500);
    expect(failed.body).toContain('the failer failed');
    expect((await storedSummaries(app, session.id)).summaries.map((s) => s.text)).toEqual(['S[user: u1]']);
  });

  it('keeps it when the turn is stopped after Save Summary completed', async () => {
    const { app, session } = await harness.chat({ inReply: true, holdAfterSave: true });
    const held = holdStarted();
    // The first chunk exists at turn 3; the holder only runs once a Save Summary has completed.
    for (const text of ['u1', 'u2']) {
      const turn = app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/messages`,
        payload: { content: text },
      });
      expect((await turn).statusCode).toBe(200);
    }
    const turn = app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages/stream`,
      payload: { content: 'u3' },
    });
    await held;
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/stop` })).statusCode).toBe(204);
    expect((await turn).body).toContain('TURN_STOPPED');
    expect((await storedSummaries(app, session.id)).summaries.map((s) => s.text)).toEqual(['S[user: u1]']);
  });
});

describe('summaries of a set whose covered messages are all gone', () => {
  it('are removed when the set stores its next summary, and not before', async () => {
    const { app, session } = await harness.chat({});
    for (const text of ['u1', 'u2', 'u3']) await say(app, session, text);
    const first = (await storedSummaries(app, session.id)).summaries;
    expect(first.map((s) => s.text)).toEqual(['S[user: u1]']);
    // Delete the whole covered chunk: the summary stays stored (and listed) until the set saves again.
    for (const id of first[0]!.messageIds)
      await app.inject({ method: 'DELETE', url: `/api/sessions/${session.id}/messages/${id}` });
    expect((await storedSummaries(app, session.id)).summaries).toHaveLength(1);
    for (const text of ['u4', 'u5', 'u6']) await say(app, session, text);
    const after = (await storedSummaries(app, session.id)).summaries;
    expect(after.length).toBeGreaterThan(0);
    expect(after.map((s) => s.id)).not.toContain(first[0]!.id);
  });
});

describe('a failed after-reply run', () => {
  it('keeps the summary a completed Save Summary node stored', async () => {
    const { app, session } = await harness.chat({ failAfterSave: true });
    for (const text of ['u1', 'u2']) await say(app, session, text);
    await send(app, session.id, 'u3');
    const failed = await waitForPostRun(app, session.id, 'error');
    expect(failed.postError).toContain('the failer failed');
    expect((await storedSummaries(app, session.id)).summaries.map((s) => s.text)).toEqual(['S[user: u1]']);
  });
});

describe('summaryViews', () => {
  const message = (id: string, content: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
    id,
    role: 'user',
    content,
    createdAt: '',
    ...over,
  });
  const messages = [message('a', 'one'), message('b', 'two'), message('c', 'three'), message('d', 'four')];
  const summary = (id: string, ids: string[], over: object = {}) => ({
    id,
    messageIds: ids,
    fingerprint: fingerprintMessages(ids.flatMap((x) => messages.find((m) => m.id === x) ?? [])),
    text: `text ${id}`,
    createdAt: '2026-01-01',
    executionId: 'e',
    ...over,
  });

  it('is empty without summaries or with an unreadable store', () => {
    expect(summaryViews(undefined, messages)).toEqual([]);
    expect(summaryViews('junk', messages)).toEqual([]);
    expect(summaryViews({ main: 'junk' }, messages)).toEqual([]);
  });
  it('orders each set by position and keeps the sets in stored order', () => {
    const views = summaryViews(
      { b: [summary('late', ['c', 'd']), summary('early', ['a', 'b'])], a: [summary('x', ['a'])] },
      messages,
    );
    expect(views.map((set) => set.set)).toEqual(['b', 'a']);
    expect(views[0]!.summaries.map((item) => item.id)).toEqual(['early', 'late']);
  });
  it.each(['constructor', '__proto__', 'toString'])('lists a set called %s like any other', (set) => {
    const stored: unknown = JSON.parse(`{ ${JSON.stringify(set)}: ${JSON.stringify([summary('s', ['a', 'b'])])} }`);
    const views = summaryViews(stored, messages);
    expect(views).toHaveLength(1);
    expect(views[0]!.set).toBe(set);
    expect(views[0]!.summaries[0]).toMatchObject({ id: 's', valid: true, firstIndex: 1, lastIndex: 2 });
  });
  it('does not count partial or streaming rows as positions', () => {
    const rows = [message('a', 'one'), message('p', 'half', { status: 'partial' }), message('b', 'two')];
    const [set] = summaryViews(
      { main: [{ ...summary('s', ['a', 'b']), fingerprint: fingerprintMessages([rows[0]!, rows[2]!]) }] },
      rows,
    );
    expect(set!.summaries[0]).toMatchObject({ valid: true, firstIndex: 1, lastIndex: 2 });
  });
  it('reports a deleted, an edited and a fully gone summary', () => {
    const edited = messages.map((m) => (m.id === 'b' ? { ...m, content: 'changed' } : m));
    const [set] = summaryViews(
      { main: [summary('ab', ['a', 'b']), summary('cd', ['c', 'd']), summary('gone', ['x'], { fingerprint: 'f' })] },
      edited.filter((m) => m.id !== 'd'),
    );
    expect(set!.summaries).toEqual([
      expect.objectContaining({ id: 'ab', valid: false, covered: 2, missing: 0, firstIndex: 1, lastIndex: 2 }),
      expect.objectContaining({
        id: 'cd',
        valid: false,
        covered: 2,
        missing: 1,
        firstIndex: 3,
        lastIndex: 3,
        firstMessageId: 'c',
        lastMessageId: 'c',
      }),
      {
        id: 'gone',
        text: 'text gone',
        createdAt: '2026-01-01',
        executionId: 'e',
        valid: false,
        covered: 1,
        missing: 1,
      },
    ]);
  });
});
