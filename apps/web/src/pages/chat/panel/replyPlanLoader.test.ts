import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ChangeEvent, ReplyPlan } from '@st/shared';
import { startReplyPlanLoader } from './replyPlanLoader.js';

const plan = (n: number): ReplyPlan => ({ entries: [{ workflowId: `w${n}`, waitsFor: [] }] });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const listeners = new Set<(event: ChangeEvent) => void>();
  let calls = 0;
  const pending: { resolve(): void; reject(): void }[] = [];
  const fetch = vi.fn(() => {
    const call = ++calls;
    return new Promise<ReplyPlan>((resolve, reject) => {
      pending.push({ resolve: () => resolve(plan(call)), reject: () => reject(new Error('no')) });
    });
  });
  const results: (ReplyPlan | undefined)[] = [];
  const loader = startReplyPlanLoader(
    's1',
    {
      fetch,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    (result) => results.push(result),
  );
  const emit = (event: ChangeEvent) => {
    for (const listener of [...listeners]) listener(event);
  };
  const settle = async (outcome: 'resolve' | 'reject' = 'resolve') => {
    pending.shift()?.[outcome]();
    await vi.advanceTimersByTimeAsync(0);
  };
  return { loader, fetch, results, emit, settle, listeners };
}

it('loads at once and delivers the plan', async () => {
  const { fetch, results, settle } = setup();
  expect(fetch).toHaveBeenCalledExactlyOnceWith('s1');
  await settle();
  expect(results).toEqual([plan(1)]);
});

it('reloads after what a plan depends on changes, once for changes that come close together', async () => {
  const { fetch, emit, settle } = setup();
  await settle();
  for (const type of ['workflows.changed', 'stateDefinitions.changed', 'presets.changed'] as const) emit({ type });
  await vi.advanceTimersByTimeAsync(500);
  expect(fetch).toHaveBeenCalledTimes(2);
  await settle();
  emit({ type: 'characters.changed' });
  await vi.advanceTimersByTimeAsync(500);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("does not reload for a chat's own turns", async () => {
  const { fetch, emit, settle } = setup();
  await settle();
  emit({ type: 'sessions.changed', id: 's1' });
  emit({ type: 'providers.changed', invalidFiles: [] });
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('fetches once more after a change that came during a fetch, and drops the answer that may predate it', async () => {
  const { fetch, emit, settle, results } = setup();
  emit({ type: 'workflows.changed' });
  await settle();
  expect(results).toEqual([]);
  await vi.advanceTimersByTimeAsync(500);
  expect(fetch).toHaveBeenCalledTimes(2);
  await settle();
  expect(results).toEqual([plan(2)]);
});

it('delivers nothing for a failed load, and nothing after stop', async () => {
  const { loader, fetch, emit, settle, results, listeners } = setup();
  await settle('reject');
  expect(results).toEqual([undefined]);
  emit({ type: 'workflows.changed' });
  loader.stop();
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(listeners.size).toBe(0);
});
