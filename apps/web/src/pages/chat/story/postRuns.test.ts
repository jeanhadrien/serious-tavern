import { describe, expect, it } from 'vitest';
import type { PostStatus } from '@st/shared';
import { buildView, entry, reply, userMessage } from './test-fixtures.js';
import { nextAlerts, postRunOf, runningPostRun, type AlertMemory } from './postRuns.js';
import { postFailureToast } from './postRunText.js';

const turn = (id: string, post?: { status: PostStatus; error?: string; executionId?: string }) => ({
  ...entry(id),
  ...(post && {
    postStatus: post.status,
    postExecutionId: post.executionId ?? `post-${id}`,
    ...(post.error && { postError: post.error }),
  }),
});
const viewOf = (...entries: ReturnType<typeof turn>[]) =>
  buildView({ messages: [userMessage(), ...entries.map((item) => reply(item.executionId))], entries });

describe('runningPostRun', () => {
  it('is the newest turn whose after-reply run is running', () => {
    const view = viewOf(turn('e1', { status: 'running' }), turn('e2', { status: 'running' }));
    expect(runningPostRun(view)).toEqual({ status: 'running', turnNumber: 2, executionId: 'post-e2' });
  });

  it.each<[string, Parameters<typeof turn>[1]]>([
    ['completed', { status: 'completed' }],
    ['stopped', { status: 'stopped' }],
    ['failed', { status: 'error', error: 'boom' }],
    ['absent', undefined],
  ])('ignores a run that is %s', (_name, post) => {
    expect(runningPostRun(viewOf(turn('e1', post)))).toBeUndefined();
  });

  it('is undefined without a view', () => {
    expect(runningPostRun(undefined)).toBeUndefined();
  });

  it('reports a run of a turn that no longer counts without a turn number', () => {
    const view = buildView({ messages: [], entries: [turn('e1', { status: 'running' })] });
    expect(runningPostRun(view)).toMatchObject({ status: 'running', turnNumber: null });
  });
});

describe('postRunOf', () => {
  it('keeps the error and the execution id only when the view has them', () => {
    const [first, second] = viewOf(turn('e1', { status: 'error', error: 'boom' }), turn('e2')).turns;
    expect(postRunOf(first!)).toEqual({ status: 'error', turnNumber: 1, executionId: 'post-e1', error: 'boom' });
    expect(postRunOf(second!)).toBeUndefined();
  });
});

describe('nextAlerts', () => {
  const failed = (id: string, error = 'boom') => turn(id, { status: 'error', error });
  const second = (memory: AlertMemory, ...entries: ReturnType<typeof turn>[]) =>
    nextAlerts(memory, 's', viewOf(...entries));

  it('treats the first view of a chat as the baseline: failures it already holds never toast', () => {
    const { failures, memory } = nextAlerts(undefined, 's', viewOf(failed('e1')));
    expect(failures).toEqual([]);
    expect([...memory.seen]).toEqual(['post-e1']);
  });

  it('toasts a new failure exactly once, then not again on the next views', () => {
    const base = nextAlerts(undefined, 's', viewOf(turn('e1', { status: 'completed' }))).memory;
    const first = second(base, turn('e1', { status: 'completed' }), failed('e2', 'HTTP 500'));
    expect(first.failures).toMatchObject([{ turnNumber: 2, error: 'HTTP 500' }]);
    const again = second(first.memory, turn('e1', { status: 'completed' }), failed('e2', 'HTTP 500'));
    expect(again.failures).toEqual([]);
  });

  it('toasts a failure that was never seen running (a fast one)', () => {
    const base = nextAlerts(undefined, 's', viewOf()).memory;
    expect(second(base, failed('e1')).failures).toHaveLength(1);
  });

  it('toasts when a run seen as running fails', () => {
    const running = nextAlerts(undefined, 's', viewOf(turn('e0', { status: 'completed' }))).memory;
    const during = second(running, turn('e0', { status: 'completed' }), turn('e1', { status: 'running' }));
    expect(during.failures).toEqual([]);
    expect(second(during.memory, turn('e0', { status: 'completed' }), failed('e1')).failures).toHaveLength(1);
  });

  it.each<[string, PostStatus]>([
    ['completes', 'completed'],
    ['is stopped', 'stopped'],
  ])('never toasts for a run that %s', (_name, status) => {
    const base = nextAlerts(undefined, 's', viewOf(turn('e1', { status: 'running' }))).memory;
    expect(second(base, turn('e1', { status })).failures).toEqual([]);
  });

  it('starts a new baseline when the chat changes', () => {
    const base = nextAlerts(undefined, 's', viewOf()).memory;
    const other = nextAlerts(base, 'other', viewOf(failed('e1')));
    expect(other.failures).toEqual([]);
    expect(other.memory.sessionId).toBe('other');
  });

  it('toasts a run cut short by a restart that shows up after the baseline', () => {
    const base = nextAlerts(undefined, 's', viewOf(turn('e1', { status: 'completed' }))).memory;
    const interrupted = { ...turn('e2', { status: 'error', error: 'The run was interrupted by a server restart.' }) };
    expect(second(base, turn('e1', { status: 'completed' }), interrupted).failures).toHaveLength(1);
  });

  it('tells two failures of one view apart and keys a run without an id by its turn', () => {
    const base = nextAlerts(undefined, 's', viewOf()).memory;
    const noId = { ...failed('e2'), postExecutionId: undefined };
    const result = second(base, failed('e1'), noId as never);
    expect(result.failures).toHaveLength(2);
    expect([...result.memory.seen].sort()).toEqual(['e2', 'post-e1']);
  });
});

describe('postFailureToast', () => {
  it.each([
    [{ status: 'error', turnNumber: 3, error: 'HTTP 500' }, 'After-reply steps failed on turn 3: HTTP 500'],
    [{ status: 'error', turnNumber: null, error: 'HTTP 500' }, 'After-reply steps failed: HTTP 500'],
    [{ status: 'error', turnNumber: 1 }, 'After-reply steps failed on turn 1: unknown error'],
  ] as const)('words %j', (run, text) => {
    expect(postFailureToast(run)).toBe(text);
  });
});
