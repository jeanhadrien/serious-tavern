import { afterEach, expect, it, vi } from 'vitest';
import { chatRuns } from './chatRuns.js';

afterEach(() => chatRuns.publish(new Map()));

it('holds the latest run id per workflow, and tells listeners only of a change', () => {
  const listener = vi.fn();
  chatRuns.subscribe(listener);
  chatRuns.publish(new Map([['w1', 'e1']]));
  chatRuns.publish(new Map([['w1', 'e1']]));
  expect(listener).toHaveBeenCalledTimes(1);
  expect(chatRuns.getSnapshot().get('w1')).toBe('e1');
  chatRuns.publish(new Map([['w1', 'e2']]));
  expect(listener).toHaveBeenCalledTimes(2);
  chatRuns.publish(new Map());
  expect(chatRuns.getSnapshot().size).toBe(0);
});
