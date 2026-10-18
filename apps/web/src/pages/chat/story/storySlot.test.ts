import { expect, it } from 'vitest';
import type { SessionStateView } from '@st/shared';
import { becameIdle, currentSlot, nextSlot, type Slot } from './storySlot.js';

const view = (turn: number): SessionStateView => ({ turn, definitions: [], nodes: [], turns: [] });

it('stores a loaded view for its chat', () => {
  expect(nextSlot(undefined, 's1', { view: view(1) })).toEqual({ sessionId: 's1', view: view(1), failed: false });
});

it('keeps the previous view of the same chat when a refresh fails', () => {
  const previous: Slot = { sessionId: 's1', view: view(1), failed: false };
  expect(nextSlot(previous, 's1', { failed: true })).toEqual({ sessionId: 's1', view: view(1), failed: true });
});

it('never carries the view of another chat into a failure', () => {
  const previous: Slot = { sessionId: 's1', view: view(1), failed: false };
  expect(nextSlot(previous, 's2', { failed: true })).toEqual({ sessionId: 's2', view: undefined, failed: true });
  expect(nextSlot(undefined, 's2', { failed: true })).toEqual({ sessionId: 's2', view: undefined, failed: true });
});

it('shows only the slot of the open chat', () => {
  const slot: Slot = { sessionId: 's1', view: view(1), failed: false };
  expect(currentSlot(slot, 's1')).toBe(slot);
  expect(currentSlot(slot, 's2')).toBeUndefined();
  expect(currentSlot(slot, undefined)).toBeUndefined();
  expect(currentSlot(undefined, 's1')).toBeUndefined();
});

it('loads again only on the way from busy to idle', () => {
  expect(becameIdle(false, true)).toBe(true);
  expect(becameIdle(true, true)).toBe(false);
  expect(becameIdle(false, false)).toBe(false);
  expect(becameIdle(true, false)).toBe(false);
});
