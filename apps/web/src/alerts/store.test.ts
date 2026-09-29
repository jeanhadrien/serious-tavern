import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertStore } from './store.js';

let store: AlertStore;
beforeEach(() => { vi.useFakeTimers(); store = new AlertStore(); });
afterEach(() => { store.clear(); vi.useRealTimers(); });
describe('alert store', () => {
  it('adds and dismisses alerts, notifying subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const id = store.error('Failed', { title: 'Error', details: 'trace' });
    expect(store.getSnapshot()[0]).toMatchObject({ id, level: 'error', title: 'Error', details: 'trace', count: 1, timeoutMs: 0 });
    vi.advanceTimersByTime(60_000);
    expect(store.getSnapshot()).toHaveLength(1);
    store.dismiss(id);
    expect(store.getSnapshot()).toHaveLength(0);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
  it('deduplicates close alerts and retains a stable id', () => {
    const id = store.warning('Same warning');
    vi.advanceTimersByTime(500);
    expect(store.warning('Same warning')).toBe(id);
    expect(store.getSnapshot()).toMatchObject([{ count: 2 }]);
    vi.advanceTimersByTime(2100);
    expect(store.warning('Same warning')).not.toBe(id);
    expect(store.getSnapshot()).toHaveLength(2);
  });
  it('auto-dismisses timed alerts and pauses while hovered', () => {
    const id = store.success('Saved');
    vi.advanceTimersByTime(1000);
    store.pause(id);
    vi.advanceTimersByTime(5000);
    expect(store.getSnapshot()).toHaveLength(1);
    store.resume(id);
    vi.advanceTimersByTime(2999);
    expect(store.getSnapshot()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot()).toHaveLength(0);
  });
  it('caps the visible alerts at five', () => {
    for (let i = 0; i < 7; i++) store.info(`Message ${i}`);
    expect(store.getSnapshot().map(item => item.message)).toEqual(['Message 2', 'Message 3', 'Message 4', 'Message 5', 'Message 6']);
    store.clear();
    expect(store.getSnapshot()).toHaveLength(0);
  });
});
