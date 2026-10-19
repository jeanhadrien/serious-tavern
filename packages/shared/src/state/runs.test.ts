import { describe, expect, it } from 'vitest';
import { POST_ERROR_LIMIT, POST_INTERRUPTED_MESSAGE } from './post-run.js';
import { effectiveRuns, postOfEntry, withRunSettled } from './runs.js';
import { addWrite, item, setWrite, turnEntry } from './test-fixtures.js';
import { readTurnEntries, withTurnEntry, type TurnRun } from './writes.js';

const run = (
  executionId: string,
  part: 'reply' | 'post',
  status: TurnRun['status'],
  over: Partial<TurnRun> = {},
): TurnRun => ({
  executionId,
  workflowId: `wf-${executionId}`,
  part,
  status,
  ...over,
});
const stateWith = (...runs: TurnRun[]) =>
  withTurnEntry({ turns: [] }, turnEntry('t', [setWrite('tension', 1)], { replies: 1, runs }));
const entryOf = (state: unknown) => readTurnEntries(state)[0]!;

describe('withRunSettled', () => {
  it('appends a reply run: its record, replies, and writes after everything earlier', () => {
    const state = withRunSettled(stateWith(run('t', 'reply', 'completed')), 't', {
      run: run('r2', 'reply', 'completed'),
      writes: [addWrite('log', item('i1'))],
      replies: 2,
    });
    const entry = entryOf(state);
    expect(entry.runs!.map((item) => item.executionId)).toEqual(['t', 'r2']);
    expect(entry.replies).toBe(3);
    expect(entry.writes.map((write) => write.op)).toEqual(['set', 'add']);
    expect(entry.completed).toBe(true);
  });

  it('replaces the record of a run the entry already lists (an announced after-reply run), keeping the order', () => {
    const state = withRunSettled(
      stateWith(run('t', 'reply', 'completed'), run('p', 'post', 'running'), run('q', 'post', 'running')),
      't',
      {
        run: run('p', 'post', 'error', { error: 'x'.repeat(POST_ERROR_LIMIT + 50) }),
        writes: [setWrite('mood', 'tense')],
      },
    );
    const entry = entryOf(state);
    expect(entry.runs!.map((item) => [item.executionId, item.status])).toEqual([
      ['t', 'completed'],
      ['p', 'error'],
      ['q', 'running'],
    ]);
    expect(entry.runs![1]!.error).toHaveLength(POST_ERROR_LIMIT);
    expect(entry.writes.map((write) => write.op)).toEqual(['set', 'set']);
    expect(entry.replies).toBe(1);
  });

  it('keeps an error only for the status error', () => {
    const state = withRunSettled(stateWith(run('t', 'reply', 'completed'), run('p', 'post', 'running')), 't', {
      run: run('p', 'post', 'stopped', { error: 'ignored' }),
      writes: [],
    });
    expect(entryOf(state).runs![1]).not.toHaveProperty('error');
  });

  it.each<[string, TurnRun[], TurnRun, boolean]>([
    [
      'a reply run that failed ends the turn as not completed',
      [run('t', 'reply', 'completed')],
      run('r2', 'reply', 'error', { error: 'boom' }),
      false,
    ],
    ['a stopped reply run too', [run('t', 'reply', 'completed')], run('r2', 'reply', 'stopped'), false],
    ['an earlier failure stays', [run('t', 'reply', 'error')], run('r2', 'reply', 'completed'), false],
    ['all reply runs completed', [run('t', 'reply', 'completed')], run('r2', 'reply', 'completed'), true],
    [
      'a post run never changes it',
      [run('t', 'reply', 'completed'), run('p', 'post', 'running')],
      run('p', 'post', 'error'),
      true,
    ],
  ])('completed: %s', (_, earlier, settled, expected) => {
    expect(entryOf(withRunSettled(stateWith(...earlier), 't', { run: settled, writes: [] })).completed).toBe(expected);
  });

  it('a regenerate that replied nowhere is not completed, and becomes completed when a later run replies', () => {
    const none = withTurnEntry(
      { turns: [] },
      turnEntry('t', [], { replies: 0, completed: false, runs: [run('t', 'reply', 'completed')] }),
    );
    const still = withRunSettled(none, 't', { run: run('r2', 'reply', 'completed'), writes: [], needsReply: true });
    expect(entryOf(still)).toMatchObject({ completed: false, replies: 0 });
    const replied = withRunSettled(none, 't', {
      run: run('r2', 'reply', 'completed'),
      writes: [],
      replies: 1,
      needsReply: true,
    });
    expect(entryOf(replied)).toMatchObject({ completed: true, replies: 1 });
  });

  it('announces later runs as given, after the run record', () => {
    const entry = entryOf(
      withRunSettled(stateWith(run('t', 'reply', 'completed')), 't', {
        run: run('r2', 'reply', 'completed'),
        writes: [],
        announce: [run('p1', 'post', 'running'), run('p2', 'post', 'running')],
      }),
    );
    expect(entry.runs!.map((item) => item.executionId)).toEqual(['t', 'r2', 'p1', 'p2']);
  });

  it('appends link warnings within the entry limits', () => {
    const state = withRunSettled(stateWith(run('t', 'reply', 'completed')), 't', {
      run: run('r2', 'reply', 'completed'),
      writes: [],
      linkWarnings: ['a', 'b', 'c', 'd', 'e', 'f'].map((text) => text.repeat(400)),
    });
    const warnings = entryOf(state).linkWarnings!;
    expect(warnings).toHaveLength(5);
    expect(warnings[0]).toHaveLength(300);
  });

  it('keeps what it cannot read: other entries, unknown keys, raw runs', () => {
    const odd = { executionId: 'x', note: 'keep me', runs: ['junk'] };
    const state = { turns: [odd, turnEntry('t', [], { runs: [run('t', 'reply', 'completed')] })], extra: 1 };
    const next = withRunSettled(state, 't', { run: run('r2', 'reply', 'completed'), writes: [] }) as unknown as {
      turns: unknown[];
      extra: number;
    };
    expect(next.extra).toBe(1);
    expect(next.turns[0]).toBe(odd);
  });

  it('returns the state unchanged when the turn has no entry, and never changes its input', () => {
    const state = stateWith(run('t', 'reply', 'completed'));
    const copy = structuredClone(state);
    expect(withRunSettled(state, 'missing', { run: run('r', 'reply', 'completed'), writes: [] })).toBe(state);
    withRunSettled(state, 't', { run: run('r2', 'reply', 'completed'), writes: [setWrite('mood', 'x')] });
    expect(state).toEqual(copy);
  });
});

describe('effectiveRuns', () => {
  const entry = { runs: [run('t', 'reply', 'completed'), run('p', 'post', 'running'), run('q', 'post', 'running')] };

  it('reads a running run the server does not hold as an error that says so', () => {
    expect(effectiveRuns(entry, (id) => id === 'p')!.map(({ status, error }) => [status, error])).toEqual([
      ['completed', undefined],
      ['running', undefined],
      ['error', POST_INTERRUPTED_MESSAGE],
    ]);
  });

  it('is undefined for a legacy entry', () => {
    expect(effectiveRuns({}, () => true)).toBeUndefined();
  });
});

describe('postOfEntry', () => {
  const post = (...statuses: [TurnRun['status'], string?][]) => ({
    runs: [
      run('t', 'reply', 'completed'),
      ...statuses.map(([status, error], index) => run(`p${index}`, 'post', status, error ? { error } : {})),
    ],
  });
  const live = () => true;

  it.each<[string, ReturnType<typeof post>, unknown]>([
    ['no post run', { runs: [run('t', 'reply', 'completed')] }, undefined],
    ['one completed', post(['completed']), { status: 'completed', executionId: 'p0' }],
    ['any running wins', post(['error', 'x'], ['running']), { status: 'running', executionId: 'p0' }],
    [
      'the first error, with its text',
      post(['completed'], ['error', 'first'], ['error', 'second']),
      { status: 'error', executionId: 'p0', error: 'first' },
    ],
    [
      'an error over a stop',
      post(['stopped'], ['error', 'boom']),
      { status: 'error', executionId: 'p0', error: 'boom' },
    ],
    ['a stop when nothing failed', post(['completed'], ['stopped']), { status: 'stopped', executionId: 'p0' }],
    ['an error without text', post(['error']), { status: 'error', executionId: 'p0' }],
  ])('%s', (_, entry, expected) => {
    expect(postOfEntry(entry, live)).toEqual(expected);
  });

  it('applies the restart rule per run', () => {
    expect(postOfEntry(post(['running'], ['completed']), () => false)).toEqual({
      status: 'error',
      executionId: 'p0',
      error: POST_INTERRUPTED_MESSAGE,
    });
  });

  it('reads a legacy entry as it says, with the restart rule', () => {
    const legacy = { postExecutionId: 'p', postStatus: 'running' as const };
    expect(postOfEntry(legacy, (id) => id === 'p')).toEqual({ status: 'running', executionId: 'p' });
    expect(postOfEntry(legacy, () => false)).toMatchObject({ status: 'error', error: POST_INTERRUPTED_MESSAGE });
    expect(postOfEntry({}, live)).toBeUndefined();
  });
});
