import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangeHub } from './services/change-events.js';
import { postHarness, stateView, waitForPostRun } from './test-support/post.js';
import { assistantRows, entriesOf, readSession, send } from './test-support/story.js';

// What happens to a post run when the chat changes under it, and when the server shuts down.

const harness = postHarness('post-turn-edge');
const { setup } = harness;
afterEach(async () => {
  vi.restoreAllMocks();
  await harness.cleanup();
});

describe('a chat changed during its post run', () => {
  it('is not resurrected when it was deleted: the settle is a no-op', async () => {
    const { app, directory, session, gate } = await setup();
    await send(app, session.id);
    await gate.started;
    expect((await app.inject({ method: 'DELETE', url: `/api/sessions/${session.id}` })).statusCode).toBe(204);
    const publish = vi.spyOn(ChangeHub.prototype, 'publish');
    gate.release();
    // The next message waits for the post run to end, then finds no chat.
    expect((await send(app, session.id)).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })).statusCode).toBe(404);
    expect(await readdir(join(directory, 'sessions'))).toEqual([]);
    expect(publish.mock.calls.filter(([event]) => event.type === 'sessions.changed')).toEqual([]);
  });

  it('still records the run when a reply was deleted, but the turn no longer counts', async () => {
    const { app, session, gate } = await setup();
    await send(app, session.id);
    await gate.started;
    const [reply] = assistantRows(await readSession(app, session.id));
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/sessions/${session.id}/messages/${reply!.id}` })).statusCode,
    ).toBe(204);
    gate.release();
    await waitForPostRun(app, session.id, 'completed');
    const entry = entriesOf(await readSession(app, session.id))[0]!;
    expect(entry.writes.map((write) => write.nodeId)).toEqual(['bump', 'postBump', 'postAdd']);
    const view = await stateView(app, session.id);
    expect(view.turns[0]).toMatchObject({ turnNumber: null, postStatus: 'completed' });
    expect(view.definitions[0]!.values).toMatchObject({ n: 0, log: [] });
  });
});

describe('closing the app', () => {
  it('stops a running post run and records it before returning', async () => {
    const { app, directory, session, gate } = await setup();
    await send(app, session.id);
    await gate.started;
    await app.close();
    const stored = JSON.parse(await readFile(join(directory, 'sessions', `${session.id}.json`), 'utf8'));
    expect(stored.state.turns[0]).toMatchObject({ completed: true, postStatus: 'stopped' });
    const log = JSON.parse(
      await readFile(join(directory, 'executions', `${stored.state.turns[0].postExecutionId}.json`), 'utf8'),
    );
    expect(log.warnings).toContain('The after-reply run ended because the server shut down before it finished.');
  });
});
