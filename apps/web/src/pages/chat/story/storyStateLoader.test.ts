import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ChangeEvent, SessionStateView } from '@st/shared';
import { startStoryLoader, type StoryLoad } from './storyStateLoader.js';

const view = (turn: number): SessionStateView => ({ turn, definitions: [], nodes: [], turns: [] });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const listeners = new Set<(event: ChangeEvent) => void>();
  let turn = 0;
  const pending: { resolve(v: SessionStateView): void; reject(e: unknown): void }[] = [];
  const fetch = vi.fn((_id: string) => {
    const call = ++turn;
    return new Promise<SessionStateView>((resolve, reject) => {
      pending.push({ resolve: () => resolve(view(call)), reject });
    });
  });
  const results: StoryLoad[] = [];
  const loader = startStoryLoader(
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
  const settle = async () => {
    pending.shift()?.resolve(view(0));
    await vi.advanceTimersByTimeAsync(0);
  };
  return { loader, fetch, results, emit, settle, pending, listeners };
}

it('loads at once and delivers the view', async () => {
  const { fetch, results, settle } = setup();
  expect(fetch).toHaveBeenCalledExactlyOnceWith('s1');
  await settle();
  expect(results).toEqual([{ view: view(1) }]);
});

it('reloads after this chat changed, but not after another chat', async () => {
  const { fetch, emit, settle } = setup();
  await settle();
  emit({ type: 'sessions.changed', id: 'other' });
  await vi.advanceTimersByTimeAsync(500);
  expect(fetch).toHaveBeenCalledTimes(1);
  emit({ type: 'sessions.changed', id: 's1' });
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('reloads on a change without an id (the connect snapshot) and on definition changes', async () => {
  const { fetch, emit, settle } = setup();
  await settle();
  emit({ type: 'sessions.changed' });
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch).toHaveBeenCalledTimes(2);
  await settle();
  emit({ type: 'stateDefinitions.changed', invalidFiles: [] });
  await vi.advanceTimersByTimeAsync(300);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('turns the two announcements of a saved definition into one fetch', async () => {
  const { fetch, emit, settle } = setup();
  await settle();
  emit({ type: 'stateDefinitions.changed', invalidFiles: [] });
  await vi.advanceTimersByTimeAsync(180);
  emit({ type: 'stateDefinitions.changed', invalidFiles: [] });
  await vi.advanceTimersByTimeAsync(500);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('ignores events that cannot change the story', async () => {
  const { fetch, emit, settle } = setup();
  await settle();
  emit({ type: 'workflows.changed', id: 'w1' });
  emit({ type: 'presets.changed', invalidFiles: [] });
  emit({ type: 'characters.changed' });
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('turns five events within 50 ms into one fetch', async () => {
  const { fetch, emit, settle } = setup();
  await settle();
  for (let i = 0; i < 5; i++) {
    emit({ type: 'sessions.changed', id: 's1' });
    await vi.advanceTimersByTimeAsync(10);
  }
  await vi.advanceTimersByTimeAsync(200);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('fetches exactly once more for an event during a fetch, and drops the answer that may predate it', async () => {
  const { fetch, results, emit, settle } = setup();
  emit({ type: 'sessions.changed', id: 's1' });
  emit({ type: 'sessions.changed', id: 's1' });
  await settle();
  // The first answer was requested before the event: not delivered; one reload follows.
  expect(results).toEqual([]);
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch).toHaveBeenCalledTimes(2);
  await settle();
  expect(results).toEqual([{ view: view(2) }]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('delivers nothing after stop, even for a fetch in flight, and stops listening', async () => {
  const { loader, fetch, results, emit, settle, listeners } = setup();
  loader.stop();
  expect(listeners.size).toBe(0);
  await settle();
  expect(results).toEqual([]);
  emit({ type: 'sessions.changed', id: 's1' });
  loader.reload();
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('cancels a pending reload on stop', async () => {
  const { loader, fetch, emit, settle } = setup();
  await settle();
  emit({ type: 'sessions.changed', id: 's1' });
  loader.stop();
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('reports a failed fetch, then a later success replaces it', async () => {
  const { loader, results, pending, fetch } = setup();
  pending.shift()?.reject(new Error('offline'));
  await vi.advanceTimersByTimeAsync(0);
  expect(results).toEqual([{ failed: true }]);
  loader.reload();
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch).toHaveBeenCalledTimes(2);
  pending.shift()?.resolve(view(0));
  await vi.advanceTimersByTimeAsync(0);
  expect(results).toEqual([{ failed: true }, { view: view(2) }]);
});

it('reload() is the same debounced path as an event', async () => {
  const { loader, fetch, settle } = setup();
  await settle();
  loader.reload();
  loader.reload();
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch).toHaveBeenCalledTimes(2);
});
