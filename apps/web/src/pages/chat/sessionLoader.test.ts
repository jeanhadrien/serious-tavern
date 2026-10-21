import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ChangeEvent } from '@st/shared';
import { startSessionLoader } from './sessionLoader.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// The shared debounce and coalescing rules are tested through the story loader (story/storyStateLoader.test.ts).
it('reloads on the events it was told about, and only on those', async () => {
  const listeners = new Set<(event: ChangeEvent) => void>();
  const fetch = vi.fn(async (_id: string) => 'answer');
  const results: unknown[] = [];
  startSessionLoader(
    's1',
    {
      fetch,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      alsoOn: { 'appSettings.changed': 0 },
    },
    (result) => results.push(result),
  );
  const emit = (event: ChangeEvent) => {
    for (const listener of listeners) listener(event);
  };
  await vi.advanceTimersByTimeAsync(0);
  expect(results).toEqual([{ value: 'answer' }]);
  emit({ type: 'stateDefinitions.changed', invalidFiles: [] });
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(1);
  emit({ type: 'appSettings.changed' });
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch).toHaveBeenCalledTimes(2);
});
