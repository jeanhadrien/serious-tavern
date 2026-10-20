import { describe, expect, it } from 'vitest';
import type { RunStatus } from '@st/shared';
import { afterRun, buildView, entry, reply, userMessage } from './test-fixtures.js';
import { nextAlerts, postFailures, postRunOf, runningPostRun, type AlertMemory } from './postRuns.js';
import { postFailureSubject, postFailureToast } from './postRunText.js';

const turn = (id: string, post?: { status: RunStatus; error?: string; executionId?: string }) => ({
  ...entry(id),
  ...(post && afterRun(post.status, { executionId: post.executionId ?? `post-${id}`, error: post.error })),
});
const viewOf = (...entries: ReturnType<typeof turn>[]) =>
  buildView({ messages: [userMessage(), ...entries.map((item) => reply(item.executionId))], entries });

describe('runningPostRun', () => {
  it('is the newest turn whose run after the reply is running', () => {
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

  it.each<[string, RunStatus]>([
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

  it('tells two failures of one view apart, keyed by the failing run', () => {
    const base = nextAlerts(undefined, 's', viewOf()).memory;
    const result = second(base, failed('e1'), failed('e2'));
    expect(result.failures).toHaveLength(2);
    expect([...result.memory.seen].sort()).toEqual(['post-e1', 'post-e2']);
  });
});

describe('postFailureToast', () => {
  it.each([
    [
      { executionId: 'p', status: 'error', turnNumber: 3, error: 'HTTP 500' },
      'A workflow failed after the reply on turn 3: HTTP 500',
    ],
    [
      { executionId: 'p', status: 'error', turnNumber: null, error: 'HTTP 500' },
      'A workflow failed after the reply: HTTP 500',
    ],
    [
      { executionId: 'p', status: 'error', turnNumber: 1 },
      'A workflow failed after the reply on turn 1: unknown error',
    ],
  ] as const)('words %j', (run, text) => {
    expect(postFailureToast(run)).toBe(text);
  });
});

describe('postFailures', () => {
  const failed = (id: string, error = 'boom', replies = 1) => ({ ...turn(id, { status: 'error', error }), replies });

  it('lists the failed and interrupted runs, newest first, and nothing else', () => {
    const view = viewOf(
      failed('e1'),
      turn('e2', { status: 'completed' }),
      turn('e3', { status: 'stopped' }),
      failed('e4', 'HTTP 500'),
      turn('e5', { status: 'running' }),
    );
    expect(postFailures(view).map((item) => [item.turnNumber, item.error])).toEqual([
      [4, 'HTTP 500'],
      [1, 'boom'],
    ]);
  });

  it('keeps the newest three', () => {
    const view = viewOf(failed('e1'), failed('e2'), failed('e3'), failed('e4'));
    expect(postFailures(view).map((item) => item.turnNumber)).toEqual([4, 3, 2]);
  });

  it('is empty without a view or without failures', () => {
    expect(postFailures(undefined)).toEqual([]);
    expect(postFailures(viewOf(turn('e1', { status: 'completed' })))).toEqual([]);
  });

  it('carries what is needed to say which turn it was: one without a reply, one whose replies are gone', () => {
    const noReply = buildView({ messages: [], entries: [{ ...failed('e1', 'boom', 0) }] });
    expect(postFailures(noReply)[0]).toMatchObject({ turnNumber: 1, replies: 0 });
    const gone = buildView({ messages: [], entries: [failed('e1')] });
    expect(postFailures(gone)[0]).toMatchObject({ turnNumber: null, replies: 1 });
  });
});

describe('postFailureSubject', () => {
  it.each([
    [{ turnNumber: 3, replies: 1 }, 'Turn 3'],
    [{ turnNumber: 2, replies: 0 }, 'Turn 2 (no reply)'],
    [{ turnNumber: null, replies: 1 }, 'A turn whose replies were deleted'],
  ])('names %j', (turnRef, text) => {
    expect(postFailureSubject(turnRef)).toBe(text);
  });
});

describe('a turn with runs (a chat that lists several workflows)', () => {
  type Part = 'reply' | 'post';
  const run = (executionId: string, workflowId: string, part: Part, status: RunStatus, error?: string) => ({
    executionId,
    workflowId,
    part,
    status,
    ...(error && { error }),
  });
  const withRuns = (id: string, runs: ReturnType<typeof run>[]) => ({ ...entry(id), runs });
  const names = { a: 'Narrator', b: 'Memory' };
  const viewWith = (...entries: ReturnType<typeof withRuns>[]) =>
    buildView({
      messages: [userMessage(), ...entries.map((item) => reply(item.executionId))],
      entries,
      workflowNames: names,
    });
  const replies = [run('e1', 'a', 'reply', 'completed'), run('r2', 'b', 'reply', 'completed')];

  it('names the workflow running after the reply now: the first run still running', () => {
    const view = viewWith(
      withRuns('e1', [
        ...replies,
        run('p-a', 'a', 'post', 'completed'),
        run('p-b', 'b', 'post', 'running'),
        run('p-c', 'c', 'post', 'running'),
      ]),
    );
    expect(runningPostRun(view)).toEqual({
      status: 'running',
      turnNumber: 1,
      executionId: 'p-b',
      workflowName: 'Memory',
    });
  });

  it('points at the run that failed, not the first run after the reply the derived fields name', () => {
    const view = viewWith(
      withRuns('e1', [...replies, run('p-a', 'a', 'post', 'completed'), run('p-b', 'b', 'post', 'error', 'boom')]),
    );
    const [turn] = view.turns;
    expect(turn?.postExecutionId).toBe('p-a');
    expect(postRunOf(turn!)).toEqual({
      status: 'error',
      turnNumber: 1,
      executionId: 'p-b',
      error: 'boom',
      workflowName: 'Memory',
    });
    expect(postFailures(view).map((failure) => failure.executionId)).toEqual(['p-b']);
  });

  it('has no run after the reply when the turn ran reply runs only', () => {
    const view = viewWith(withRuns('e1', replies));
    expect(postRunOf(view.turns[0]!)).toBeUndefined();
    expect(runningPostRun(view)).toBeUndefined();
  });

  it.each<[RunStatus, RunStatus[]]>([
    ['running', ['completed', 'running']],
    ['error', ['completed', 'error', 'stopped']],
    ['stopped', ['completed', 'stopped']],
    ['completed', ['completed', 'completed']],
  ])('reads %s exactly as the view derives it', (expected, statuses) => {
    const view = viewWith(
      withRuns('e1', [
        ...replies,
        ...statuses.map((status, i) => run(`p${i}`, 'a', 'post', status, status === 'error' ? 'x' : undefined)),
      ]),
    );
    const [turn] = view.turns;
    expect(turn?.postStatus).toBe(expected);
    expect(postRunOf(turn!)?.status).toBe(expected);
  });

  it('toasts a failure once, keyed by the failing run, and says whose steps failed', () => {
    const failed = viewWith(withRuns('e1', [...replies, run('p-b', 'b', 'post', 'error', 'boom')]));
    const next = nextAlerts({ sessionId: 's', seen: new Set() }, 's', failed);
    expect(next.failures.map(postFailureToast)).toEqual(['Workflow Memory failed after the reply on turn 1: boom']);
    expect(nextAlerts(next.memory, 's', failed).failures).toEqual([]);
  });
});
