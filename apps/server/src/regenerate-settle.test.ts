import { afterEach, describe, expect, it } from 'vitest';
import { apiContract } from '@st/shared';
import { altHarness, altRows, counterN, regenerate, REPLY } from './test-support/alternatives.js';
import { edge, entriesOf, node, readSession, send, turn } from './test-support/story.js';

const harness = altHarness('regenerate-settle');
afterEach(() => harness.cleanup());

describe('a regenerate that leaves no reply row', () => {
  it('keeps the shown alternative when it is stopped, and its entry does not count', async () => {
    const { app, session, alt } = await harness.setup();
    await turn(app, session.id, 'hello');
    const started = alt.hold();
    const running = regenerate(app, session.id);
    await started;
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/stop` })).statusCode).toBe(204);
    const stopped = await running;
    expect(stopped.statusCode).toBe(409);
    expect(stopped.json().error).toMatchObject({
      code: 'TURN_STOPPED',
      details: { aborted: 'user', assistantMessages: [] },
    });
    const saved = await readSession(app, session.id);
    // The messages are as they were, and the entry exists (as for every settled turn) but is not present.
    expect(altRows(saved).map((row) => [row.alternativeOf, row.inactive])).toEqual([[undefined, undefined]]);
    expect(entriesOf(saved).map((entry) => [entry.replies, entry.completed])).toEqual([
      [1, true],
      [0, false],
    ]);
    expect(await counterN(app, session.id)).toBe(1);
    // Nothing is left half done: the chat regenerates and carries on as usual.
    const again = apiContract.regenerate.response.parse((await regenerate(app, session.id)).json());
    expect(again.assistantMessages[0]!.content).toBe('alt=3 n=0 turn=1 msg=hello hist=0');
    expect(await turn(app, session.id, 'next')).toEqual(['alt=4 n=3 turn=2 msg=next hist=2']);
  });

  it('keeps the shown alternative when it completes without a reply', async () => {
    // The output only replies for the first run (alt = 1).
    const { app, session } = await harness.setup((definitionId) => ({
      nodes: [
        node('input', 'chat-input'),
        node('alt', 'alt-test'),
        node('write', 'state-write', { definitionId, key: 'n', op: 'set' }),
        node('gate', 'condition', { left: '{{input.value}}', operator: 'equals', right: '1' }),
        node('output', 'chat-output', { template: REPLY }),
      ],
      edges: [
        edge('alt', 'value', 'write', 'value'),
        edge('alt', 'value', 'gate', 'value'),
        edge('gate', 'true', 'output', 'value'),
      ],
    }));
    expect(await turn(app, session.id, 'hello')).toHaveLength(1);
    const result = apiContract.regenerate.response.parse((await regenerate(app, session.id)).json());
    expect(result.assistantMessages).toEqual([]);
    const saved = await readSession(app, session.id);
    expect(altRows(saved)).toHaveLength(1);
    expect(altRows(saved)[0]!.inactive).toBeUndefined();
    // A turn that completed without a reply would count; this one must not, or the old reply's turn would count twice.
    expect(entriesOf(saved).map((entry) => [entry.replies, entry.completed])).toEqual([
      [1, true],
      [0, false],
    ]);
    expect(await counterN(app, session.id)).toBe(1);
    expect((await send(app, session.id, 'next')).statusCode).toBe(200);
  });
});
