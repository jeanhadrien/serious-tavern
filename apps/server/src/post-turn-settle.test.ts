import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangeHub } from './services/change-events.js';
import { JsonRepository } from './storage/repository.js';
import { postHarness, stateView, waitFor, waitForPostRun } from './test-support/post.js';
import { entriesOf, readSession, send, turn } from './test-support/story.js';

// The write that records a post run's result can fail: the run's outcome must not be lost to "interrupted".

const harness = postHarness('post-turn-settle');
afterEach(async () => {
  vi.restoreAllMocks();
  await harness.cleanup();
});

/** Makes the next `times` repository updates fail, then lets them through. */
function failUpdates(times: number) {
  const original = JsonRepository.prototype.update;
  let left = times;
  return vi.spyOn(JsonRepository.prototype, 'update').mockImplementation(function (this: unknown, ...args: unknown[]) {
    if (left-- > 0) return Promise.reject(new Error('disk full'));
    return (original as (...rest: unknown[]) => Promise<never>).apply(this, args);
  } as never);
}

async function heldRun() {
  const context = await harness.setup();
  await send(context.app, context.session.id);
  await context.gate.started;
  return context;
}

describe('a failing settle write', () => {
  it('is tried once more, and the outcome and its writes are kept', async () => {
    const { app, session, gate } = await heldRun();
    const publish = vi.spyOn(ChangeHub.prototype, 'publish');
    failUpdates(1);
    gate.release();
    await waitForPostRun(app, session.id, 'completed');
    expect(entriesOf(await readSession(app, session.id))[0]!.writes.map((write) => write.nodeId)).toEqual([
      'bump',
      'postBump',
      'postAdd',
    ]);
    expect(publish.mock.calls.filter(([event]) => event.type === 'sessions.changed')).toHaveLength(1);
  });

  it('is recorded as an error that says so, without the writes, when the retry fails too', async () => {
    const { app, session, gate } = await heldRun();
    failUpdates(2);
    gate.release();
    const failed = await waitForPostRun(app, session.id, 'error');
    expect(failed.postError).toBe('The result of the after-reply run could not be saved: disk full');
    const [entry] = entriesOf(await readSession(app, session.id));
    expect(entry).toMatchObject({ completed: true, replies: 1, postStatus: 'error' });
    expect(entry!.writes.map((write) => write.nodeId)).toEqual(['bump']);
    expect(await turn(app, session.id)).toEqual(['n=1 turn=2']);
  });

  it('only warns when even the minimal write fails, and the entry then reads as interrupted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, session, gate } = await heldRun();
    failUpdates(3);
    gate.release();
    // The next message waits for the post run to end; its own updates are past the three failures.
    expect(await turn(app, session.id)).toEqual(['n=1 turn=2']);
    const view = await waitFor(async () => {
      const turns = (await stateView(app, session.id)).turns;
      return turns[0]?.postStatus === 'error' ? turns[0] : undefined;
    });
    expect(view.postError).toMatch(/interrupted by a server restart/);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not record the after-reply run'),
      expect.any(Error),
    );
  });
});
