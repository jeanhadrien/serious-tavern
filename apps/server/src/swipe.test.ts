import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiContract, presetSchema } from '@st/shared';
import { watchSettles } from './test-support/post.js';
import { altHarness, altRows, counterN, regenerate, swipe } from './test-support/alternatives.js';
import { readSession, turn } from './test-support/story.js';

const harness = altHarness('swipe');
afterEach(async () => {
  vi.restoreAllMocks();
  await harness.cleanup();
});

const NOT_FOUND = '00000000-0000-4000-8000-000000000000';

describe('swipe', () => {
  it('shows another alternative, and the story state follows it', async () => {
    const { app, session } = await harness.setup();
    await turn(app, session.id, 'hello');
    const second = apiContract.regenerate.response.parse((await regenerate(app, session.id)).json()).execution.id;
    const saved = await readSession(app, session.id);
    const root = saved.messages[1]!.executionId!;
    expect(await counterN(app, session.id)).toBe(2);

    const settles = watchSettles(session.id);
    const back = await swipe(app, session.id, root);
    expect(back.statusCode, back.body).toBe(200);
    // The answer is the whole session, with the shown alternative flipped.
    const answered = apiContract.setAlternative.response.parse(back.json());
    expect(altRows(answered).map((row) => row.inactive)).toEqual([undefined, true]);
    expect(answered.messages[1]).not.toHaveProperty('inactive');
    expect(answered.updatedAt).toBe(saved.updatedAt);
    await settles.first;
    expect(settles.count()).toBe(1);
    expect(await counterN(app, session.id)).toBe(1);
    const view = apiContract.getSessionState.response.parse(
      (await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/state` })).json(),
    );
    expect(view.turns.map((item) => item.turnNumber)).toEqual([1, null]);

    const forward = await swipe(app, session.id, second);
    expect(altRows(apiContract.setAlternative.response.parse(forward.json())).map((row) => row.inactive)).toEqual([
      true,
      undefined,
    ]);
    expect(await counterN(app, session.id)).toBe(2);
    // The shown alternative again is a no-op that still answers.
    expect((await swipe(app, session.id, second)).statusCode).toBe(200);
    expect((await readSession(app, session.id)).updatedAt).toBe(saved.updatedAt);
  });

  it('refuses what is not an alternative of the last turn, an unknown chat and a bad body', async () => {
    const { app, session } = await harness.setup();
    const empty = await swipe(app, session.id, 'nothing');
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.code).toBe('NOT_AN_ALTERNATIVE');
    await turn(app, session.id, 'one');
    await regenerate(app, session.id);
    const oldTurn = (await readSession(app, session.id)).messages[1]!.executionId!;
    await turn(app, session.id, 'two');
    // A turn after the regenerated one: its alternatives are kept hidden, not swipeable.
    expect((await swipe(app, session.id, oldTurn)).json().error.code).toBe('NOT_AN_ALTERNATIVE');
    expect((await swipe(app, session.id, 'unknown')).statusCode).toBe(400);
    expect((await swipe(app, NOT_FOUND, oldTurn)).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'PATCH', url: `/api/sessions/${session.id}/alternative`, payload: {} })).statusCode,
    ).toBe(400);
    // Nothing changed.
    expect(altRows(await readSession(app, session.id)).map((row) => row.inactive)).toEqual([
      true,
      undefined,
      undefined,
    ]);
  });

  it('is refused with 409 TURN_RUNNING while a job runs, and works once it has been stopped', async () => {
    const { app, session, alt } = await harness.setup();
    await turn(app, session.id, 'hello');
    await regenerate(app, session.id);
    const root = (await readSession(app, session.id)).messages[1]!.executionId!;
    const started = alt.hold();
    const running = regenerate(app, session.id);
    await started;
    const refused = await swipe(app, session.id, root);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('TURN_RUNNING');
    await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/stop` });
    expect((await running).statusCode).toBe(409);
    expect((await swipe(app, session.id, root)).statusCode).toBe(200);
  });
});

describe('the chat is the active messages', () => {
  it('edits and deletes active messages only: an inactive reply is as good as unknown', async () => {
    const { app, session } = await harness.setup();
    await turn(app, session.id, 'hello');
    await regenerate(app, session.id);
    const [, hidden, shown] = (await readSession(app, session.id)).messages;
    const url = (id: string) => `/api/sessions/${session.id}/messages/${id}`;
    expect((await app.inject({ method: 'PATCH', url: url(hidden!.id), payload: { content: 'x' } })).statusCode).toBe(
      404,
    );
    expect((await app.inject({ method: 'DELETE', url: url(hidden!.id) })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'PATCH', url: url(shown!.id), payload: { content: 'edited' } })).statusCode,
    ).toBe(200);
    const after = await readSession(app, session.id);
    expect(after.messages.map((message) => message.content)).toEqual(['hello', hidden!.content, 'edited']);
  });

  it('previews a session by its active messages only', async () => {
    const { app, session } = await harness.setup();
    await turn(app, session.id, 'hello');
    await regenerate(app, session.id);
    const preset = presetSchema.parse({
      id: NOT_FOUND,
      name: 'Preview',
      createdAt: '',
      updatedAt: '',
      inputs: [{ id: 'history-input', key: 'history', dataType: 'messages' }],
      entries: [{ id: 'slot', displayName: 'History', kind: 'slot', enabled: true, inputKey: 'history' }],
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/presets/preview',
      payload: { preset, sessionId: session.id },
    });
    expect(response.statusCode, response.body).toBe(200);
    const { messages } = apiContract.previewPreset.response.parse(response.json());
    expect(messages.map((message) => message.content)).toEqual(['hello', 'alt=2 n=0 turn=1 msg=hello hist=0']);
  });
});
