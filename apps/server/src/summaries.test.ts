import { afterEach, describe, expect, it } from 'vitest';
import { apiContract } from '@st/shared';
import { stateView } from './test-support/post.js';
import { deleteMessage, readSession } from './test-support/story.js';
import { patchMessage, say, storedSummaries, summaryHarness } from './test-support/summaries.js';

// End to end: Memory shows what Next Chunk / Save Summary stored, and an edit or delete sends the chat back to raw
// messages until the chunk is summarized again.

const harness = summaryHarness('summaries');
afterEach(harness.cleanup);

describe('the summary chain after the reply', () => {
  it('summarizes one chunk per turn, once it is outside the raw window, and Memory uses it', async () => {
    const { app, session } = await harness.chat();
    expect(await say(app, session, 'u1')).toBe('H[]');
    expect(await say(app, session, 'u2')).toBe('H[user: u1\nassistant: H[]]');
    expect((await storedSummaries(app, session.id)).summaries).toEqual([]);

    // Turn 3's history is 4 messages: m1 m2 are outside the raw window of 2, so its after-reply run summarizes them.
    await say(app, session, 'u3');
    const first = await storedSummaries(app, session.id);
    expect(first.summaries).toHaveLength(1);
    const [m1, m2] = first.session.messages;
    expect(first.summaries[0]).toMatchObject({
      messageIds: [m1!.id, m2!.id],
      text: 'S[user: u1]',
      executionId: first.session.state!.turns.at(-1)!.postExecutionId,
    });

    // Turn 4 reads it: the summary stands for m1 m2, m3 m4 are raw only because they are not summarized yet.
    const fourth = await say(app, session, 'u4');
    expect(fourth.split('\n').slice(0, 3)).toEqual(['H[Summary: S[user: u1]', 'user: u2', 'assistant: H[user: u1']);
    // ... and its after-reply run summarized the next chunk, which turn 5 reads.
    const second = await storedSummaries(app, session.id);
    expect(second.summaries.map((summary) => summary.text)).toEqual(['S[user: u1]', 'S[user: u2]']);
    const fifth = await say(app, session, 'u5');
    expect(fifth.split('\n').slice(0, 2)).toEqual(['H[Summary: S[user: u1]', 'Summary: S[user: u2]']);
  });

  it('shows the summaries in the chat state view, in chat order, with positions', async () => {
    const { app, session } = await harness.chat();
    for (const text of ['u1', 'u2', 'u3', 'u4']) await say(app, session, text);
    const { session: stored, summaries } = await storedSummaries(app, session.id);
    const view = (await stateView(app, session.id)).summaries;
    expect(view).toEqual([
      {
        set: 'main',
        summaries: [
          expect.objectContaining({
            id: summaries[0]!.id,
            text: 'S[user: u1]',
            valid: true,
            covered: 2,
            missing: 0,
            firstIndex: 1,
            lastIndex: 2,
            firstMessageId: stored.messages[0]!.id,
            lastMessageId: stored.messages[1]!.id,
          }),
          expect.objectContaining({ valid: true, firstIndex: 3, lastIndex: 4 }),
        ],
      },
    ]);
    expect(apiContract.getSessionState.response.safeParse(await stateView(app, session.id)).success).toBe(true);
  });

  it('is not turn state: deleting the replies of the turn that wrote a summary keeps it', async () => {
    const { app, session } = await harness.chat();
    for (const text of ['u1', 'u2', 'u3']) await say(app, session, text);
    const before = (await storedSummaries(app, session.id)).summaries;
    expect(before).toHaveLength(1);
    const last = (await readSession(app, session.id)).messages.at(-1)!;
    expect((await deleteMessage(app, session.id, last.id)).statusCode).toBe(204);
    const after = await storedSummaries(app, session.id);
    expect(after.summaries).toEqual(before);
    expect((await stateView(app, session.id)).summaries[0]!.summaries[0]!.valid).toBe(true);
  });

  it('an edited covered message makes the summary invalid, Memory falls back to raw, and the chunk is summarized again', async () => {
    const { app, session } = await harness.chat();
    for (const text of ['u1', 'u2', 'u3', 'u4']) await say(app, session, text);
    const stored = await storedSummaries(app, session.id);
    const old = stored.summaries[0]!;
    expect((await patchMessage(app, session.id, old.messageIds[0]!, 'u1 edited')).statusCode).toBe(200);

    // Nothing is removed: the view just reports it as invalid, with all its messages still there.
    const [first, second] = (await stateView(app, session.id)).summaries[0]!.summaries;
    expect(first).toMatchObject({ id: old.id, valid: false, missing: 0, firstIndex: 1, lastIndex: 2 });
    expect(second!.valid).toBe(true);
    expect((await storedSummaries(app, session.id)).summaries[0]).toEqual(old);

    // The next turn reads raw messages for the chunk (the other summary is still used) and re-plans the first one.
    const reply = await say(app, session, 'u5');
    expect(reply.split('\n').slice(0, 3)).toEqual([
      'H[user: u1 edited',
      `assistant: ${stored.session.messages[1]!.content}`,
      'Summary: S[user: u2]',
    ]);
    const after = await storedSummaries(app, session.id);
    expect(after.summaries.map((summary) => summary.text).sort()).toEqual(['S[user: u1 edited]', 'S[user: u2]']);
    const replaced = after.summaries.find((summary) => summary.text === 'S[user: u1 edited]')!;
    expect(replaced.messageIds).toEqual(old.messageIds);
    expect(replaced.fingerprint).not.toBe(old.fingerprint);
    expect(after.summaries.some((summary) => summary.id === old.id)).toBe(false);
    expect((await stateView(app, session.id)).summaries[0]!.summaries.every((summary) => summary.valid)).toBe(true);
  });

  it('a deleted covered message: the summary is invalid until it is re-planned over the messages that are left', async () => {
    const { app, session } = await harness.chat();
    for (const text of ['u1', 'u2', 'u3', 'u4']) await say(app, session, text);
    const old = (await storedSummaries(app, session.id)).summaries[0]!;
    await deleteMessage(app, session.id, old.messageIds[1]!);
    const [first] = (await stateView(app, session.id)).summaries[0]!.summaries;
    expect(first).toMatchObject({ id: old.id, valid: false, covered: 2, missing: 1, firstIndex: 1, lastIndex: 1 });
    await say(app, session, 'u5');
    const after = (await storedSummaries(app, session.id)).summaries;
    expect(after.some((summary) => summary.id === old.id)).toBe(false);
    expect(after.find((summary) => summary.messageIds.length === 1)?.messageIds).toEqual([old.messageIds[0]]);
  });

  it('a chunk whose messages are all deleted stays listed (invalid, no position) until the set saves its next summary', async () => {
    const { app, session } = await harness.chat();
    for (const text of ['u1', 'u2', 'u3', 'u4']) await say(app, session, text);
    const old = (await storedSummaries(app, session.id)).summaries[0]!;
    for (const id of old.messageIds) await deleteMessage(app, session.id, id);
    const [gone] = (await stateView(app, session.id)).summaries[0]!.summaries.slice(-1);
    expect(gone).toMatchObject({ id: old.id, valid: false, missing: 2 });
    expect(gone).not.toHaveProperty('firstIndex');
    await say(app, session, 'u5');
    const after = (await storedSummaries(app, session.id)).summaries;
    expect(after.length).toBeGreaterThan(0);
    expect(after.some((summary) => summary.id === old.id)).toBe(false);
  });

  it('lists chats without their summaries', async () => {
    const { app, session } = await harness.chat();
    for (const text of ['u1', 'u2', 'u3']) await say(app, session, text);
    const list = apiContract.listSessions.response.parse(
      (await app.inject({ method: 'GET', url: '/api/sessions' })).json(),
    );
    expect(list[0]).not.toHaveProperty('summaries');
  });
});
