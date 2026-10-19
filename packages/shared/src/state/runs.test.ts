import { describe, expect, it } from 'vitest';
import { effectiveRuns, POST_ERROR_LIMIT, POST_INTERRUPTED_MESSAGE, postOfEntry, withRunSettled } from './runs.js';
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

  it('replaces the record of a run the entry already lists (an announced run of the after section), keeping the order', () => {
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

describe('withRunSettled placing runs that finish out of order', () => {
  // The entry of a turn of three runs listed a, b, c: whichever settles first creates it, the others settle into it.
  const create = (settled: TurnRun, writes: ReturnType<typeof setWrite>[]) =>
    withTurnEntry(
      { turns: [] },
      turnEntry(
        't',
        writes.map((write) => ({ ...write, runId: settled.executionId })),
        {
          replies: 1,
          runs: [settled],
        },
      ),
    );
  const at = (executionId: string, position: number, status: TurnRun['status'] = 'completed') =>
    run(executionId, 'reply', status, { position });
  const settle = (state: unknown, settled: TurnRun, writes: ReturnType<typeof setWrite>[]) =>
    withRunSettled(state, 't', { run: settled, writes, replies: 1 });
  const values = (state: unknown) =>
    entryOf(state).writes.map((write) => [write.runId, (write as { value?: unknown }).value]);

  it('places records and writes in list order whatever the order they settle in', () => {
    // c settles first, then a, then b: the entry reads a, b, c.
    let state = create(at('c', 2), [setWrite('n', 3)]);
    state = settle(state, at('a', 0), [setWrite('n', 1)]);
    state = settle(state, at('b', 1), [setWrite('n', 2), setWrite('mood', 'tense')]);
    expect(entryOf(state).runs!.map((item) => item.executionId)).toEqual(['a', 'b', 'c']);
    expect(values(state)).toEqual([
      ['a', 1],
      ['b', 2],
      ['b', 'tense'],
      ['c', 3],
    ]);
    expect(entryOf(state).replies).toBe(3);
  });

  it("tags the writes it stores with their run, and keeps the order of a run's own writes", () => {
    const state = settle(create(at('a', 0), []), at('b', 1), [setWrite('n', 1), setWrite('n', 2)]);
    expect(values(state)).toEqual([
      ['b', 1],
      ['b', 2],
    ]);
  });

  it('counts a write whose run is not recorded (older data), and a run without a position, as listed above everything', () => {
    const legacy = withTurnEntry(
      { turns: [] },
      turnEntry('t', [setWrite('n', 0)], { replies: 1, runs: [run('t', 'reply', 'completed')] }),
    );
    // No positions anywhere: the order runs settled in, as before runs were concurrent.
    const state = settle(legacy, run('x', 'reply', 'completed'), [setWrite('n', 1)]);
    expect(entryOf(state).runs!.map((item) => item.executionId)).toEqual(['t', 'x']);
    expect(values(state)).toEqual([
      [undefined, 0],
      ['x', 1],
    ]);
    // A run without a position counts as listed above everything, so a positioned run goes after it.
    const placed = settle(state, at('p', 0), [setWrite('n', 2)]);
    expect(values(placed)).toEqual([
      [undefined, 0],
      ['x', 1],
      ['p', 2],
    ]);
  });

  it('settles an announced run of the after section in place, after the reply runs and by position among its own', () => {
    const state = withTurnEntry(
      { turns: [] },
      turnEntry('t', [], {
        replies: 1,
        runs: [at('a', 0), run('p', 'post', 'running', { position: 1 }), run('q', 'post', 'running', { position: 2 })],
      }),
    );
    const afterQ = withRunSettled(state, 't', {
      run: run('q', 'post', 'completed', { position: 2 }),
      writes: [setWrite('n', 2)],
    });
    const afterP = withRunSettled(afterQ, 't', {
      run: run('p', 'post', 'completed', { position: 1 }),
      writes: [setWrite('n', 1)],
    });
    expect(entryOf(afterP).runs!.map((item) => [item.executionId, item.status])).toEqual([
      ['a', 'completed'],
      ['p', 'completed'],
      ['q', 'completed'],
    ]);
    expect(values(afterP)).toEqual([
      ['p', 1],
      ['q', 2],
    ]);
  });

  it('recomputes completed over the runs recorded so far', () => {
    const state = settle(create(at('b', 1), []), at('a', 0, 'error'), []);
    expect(entryOf(state).completed).toBe(false);
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

  it('is undefined for an entry without runs', () => {
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

  it('is undefined for an entry without runs', () => {
    expect(postOfEntry({}, live)).toBeUndefined();
  });
});
