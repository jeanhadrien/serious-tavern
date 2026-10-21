import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LINGER_MS, runActivity } from './runActivity.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  runActivity.clear();
  vi.useRealTimers();
});

it('is idle until a run starts, and ignores node events before that', () => {
  expect(runActivity.getSnapshot()).toEqual({ nodes: {} });
  runActivity.setNode('a', 'running');
  expect(runActivity.getSnapshot()).toEqual({ nodes: {} });
});

it('tracks the nodes of the run, and the next run starts clean', () => {
  const listener = vi.fn();
  runActivity.subscribe(listener);
  runActivity.startRun('w1');
  runActivity.setNode('a', 'running');
  runActivity.setNode('a', 'completed');
  runActivity.setNode('b', 'skipped');
  expect(runActivity.getSnapshot()).toEqual({ workflowId: 'w1', nodes: { a: 'completed', b: 'skipped' } });
  runActivity.startRun('w2');
  expect(runActivity.getSnapshot()).toEqual({ workflowId: 'w2', nodes: {} });
  expect(listener).toHaveBeenCalled();
});

it('keeps the marks for a moment after the turn ends, then clears them', () => {
  runActivity.startRun('w');
  runActivity.setNode('a', 'error');
  runActivity.finish();
  vi.advanceTimersByTime(LINGER_MS - 1);
  expect(runActivity.getSnapshot().nodes).toEqual({ a: 'error' });
  vi.advanceTimersByTime(1);
  expect(runActivity.getSnapshot()).toEqual({ nodes: {} });
});

it('a new run cancels the pending clear', () => {
  runActivity.startRun('w');
  runActivity.finish();
  runActivity.startRun('w');
  runActivity.setNode('a', 'running');
  vi.advanceTimersByTime(LINGER_MS * 2);
  expect(runActivity.getSnapshot().nodes).toEqual({ a: 'running' });
});
