import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangeHub } from './services/change-events.js';
import { TurnRegistry } from './services/turns.js';
import { JsonRepository } from './storage/repository.js';
import { isRepository, postHarness, stateView, waitFor, waitForPostRun } from './test-support/post.js';
import { assistantRows, entriesOf, readSession, send, turn } from './test-support/story.js';

// What happens to a post run when the chat changes under it, and when the server shuts down.

const harness = postHarness('post-turn-edge');
const { setup } = harness;
afterEach(async () => {
  vi.restoreAllMocks();
  await harness.cleanup();
});

describe('a chat changed during its post run', () => {
  it('is not resurrected when it was deleted: the run is stopped and its settle is a no-op', async () => {
    const { app, directory, session, gate } = await setup();
    await send(app, session.id);
    await gate.started;
    const publish = vi.spyOn(ChangeHub.prototype, 'publish');
    expect((await app.inject({ method: 'DELETE', url: `/api/sessions/${session.id}` })).statusCode).toBe(204);
    publish.mockClear();
    // The gate is never released: deleting the chat stopped the run, which is why the next message gets through.
    expect((await send(app, session.id)).statusCode).toBe(404);
    expect(gate.runs).toBe(1);
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
  it('stops a running post run and records it, as an interrupted run, before returning', async () => {
    const { app, directory, session, gate } = await setup();
    await send(app, session.id);
    await gate.started;
    await app.close();
    const stored = JSON.parse(await readFile(join(directory, 'sessions', `${session.id}.json`), 'utf8'));
    // Like a restart that cut it short, not like a Stop: nothing says the steps should be run again otherwise.
    expect(stored.state.turns[0]).toMatchObject({
      completed: true,
      postStatus: 'error',
      postError: 'The run was interrupted by a server restart.',
    });
    const log = JSON.parse(
      await readFile(join(directory, 'executions', `${stored.state.turns[0].postExecutionId}.json`), 'utf8'),
    );
    expect(log.warnings).toContain('The after-reply run ended because the server shut down before it finished.');
  });
});

describe('the state view while a post run settles', () => {
  it('never reports a run that finished just after the view read the chat as interrupted', async () => {
    const { app, directory, session, gate } = await setup();
    await send(app, session.id);
    await gate.started;
    // What a read a moment before the settle sees: the entry still says running.
    const stale = await readSession(app, session.id);
    gate.release();
    await waitForPostRun(app, session.id, 'completed');
    // The next message waits for the server to let go of the run, so it is no longer held when the view reads.
    await turn(app, session.id);
    const original = JsonRepository.prototype.get;
    let served = false;
    vi.spyOn(JsonRepository.prototype, 'get').mockImplementation(function (this: unknown, ...args: unknown[]) {
      if (!served && isRepository(this, directory, 'sessions') && args[0] === session.id) {
        served = true;
        return Promise.resolve(stale as never);
      }
      return (original as (...rest: unknown[]) => Promise<never>).apply(this, args);
    } as never);
    expect((await stateView(app, session.id)).turns[0]).toMatchObject({ postStatus: 'completed' });
    expect(served).toBe(true);
  });

  it('judges which runs are live when it reads the chat, not later while it builds the view', async () => {
    const { app, session, gate } = await setup();
    await send(app, session.id);
    await gate.started;
    const postExecutionId = entriesOf(await readSession(app, session.id))[0]!.postExecutionId!;
    // The registry that holds the run, picked up from the view's own question to it.
    let registry: TurnRegistry | undefined;
    const held = TurnRegistry.prototype.hasPostRun;
    vi.spyOn(TurnRegistry.prototype, 'hasPostRun').mockImplementation(function (this: TurnRegistry, ...args) {
      registry = this;
      return held.apply(this, args);
    });
    const original = JsonRepository.prototype.get;
    let released = false;
    vi.spyOn(JsonRepository.prototype, 'get').mockImplementation(async function (this: unknown, ...args: unknown[]) {
      const result = await (original as (...rest: unknown[]) => Promise<never>).apply(this, args);
      // The view has read the chat (the run is held) and moves on to the workflow: the run now finishes, and the
      // server lets go of it, before the view is done.
      if (registry && !released && args[0] === session.workflowId) {
        released = true;
        gate.release();
        await waitFor(async () => (registry?.hasPostRun(session.id, postExecutionId) ? undefined : true));
      }
      return result;
    } as never);
    const [first] = (await stateView(app, session.id)).turns;
    expect(released).toBe(true);
    // Running when it was read: not "interrupted by a server restart" because the run ended a moment later.
    expect(first).toMatchObject({ postStatus: 'running' });
    expect(first!.postError).toBeUndefined();
  });
});
