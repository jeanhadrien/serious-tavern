import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonRepository } from './storage/repository.js';
import { isRepository, postHarness, postRunOf, stateView, watchSettles } from './test-support/post.js';
import { entriesOf, readSession, send, turn } from './test-support/story.js';

// The write that records the result of a run after the reply can fail: the run's outcome must not be lost to "interrupted".

const harness = postHarness('after-section-settle');
afterEach(async () => {
  vi.restoreAllMocks();
  await harness.cleanup();
});

/** Makes the next `times` updates of this chat's session file fail, then lets them through. Nothing else counts. */
function failUpdates(directory: string, sessionId: string, times: number) {
  const original = JsonRepository.prototype.update;
  let left = times;
  return vi.spyOn(JsonRepository.prototype, 'update').mockImplementation(function (this: unknown, ...args: unknown[]) {
    if (isRepository(this, directory, 'sessions') && args[0] === sessionId && left-- > 0)
      return Promise.reject(new Error('disk full'));
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
    const { app, directory, session, gate } = await heldRun();
    const settles = watchSettles(session.id);
    failUpdates(directory, session.id, 1);
    gate.release();
    await settles.first;
    expect(entriesOf(await readSession(app, session.id))[0]!.writes.map((write) => write.nodeId)).toEqual([
      'bump',
      'postBump',
      'postAdd',
    ]);
    expect(settles.count()).toBe(1);
  });

  it('is recorded as an error that says so, without the writes, when the retry fails too', async () => {
    const { app, directory, session, gate } = await heldRun();
    const settles = watchSettles(session.id);
    failUpdates(directory, session.id, 2);
    gate.release();
    // The settle is announced once, after the minimal write that follows the two failures.
    await settles.first;
    const failed = await postRunOf(app, session.id);
    expect(failed.postError).toBe('The result of the run could not be saved: disk full');
    const [entry] = entriesOf(await readSession(app, session.id));
    expect(entry).toMatchObject({ completed: true, replies: 1 });
    expect(entry!.runs!.find((run) => run.part === 'post')).toMatchObject({ status: 'error' });
    expect(entry!.writes.map((write) => write.nodeId)).toEqual(['bump']);
    expect(await turn(app, session.id)).toEqual(['n=1 turn=2']);
  });

  it('only warns when even the minimal write fails, and the entry then reads as interrupted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, directory, session, gate } = await heldRun();
    failUpdates(directory, session.id, 3);
    gate.release();
    // The next message waits for the run after the reply to end; its own updates are past the three failures.
    expect(await turn(app, session.id)).toEqual(['n=1 turn=2']);
    const [view] = (await stateView(app, session.id)).turns;
    expect(view).toMatchObject({ postStatus: 'error' });
    expect(view!.postError).toMatch(/interrupted by a server restart/);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not record a run after the reply'),
      expect.any(Error),
    );
  });
});
