import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { subscribeToChanges } from './events.js';

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.OPEN;
  onerror: (() => void) | null = null;
  closed = false;
  private readonly handlers = new Map<string, (message: MessageEvent) => void>();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, handler: (message: MessageEvent) => void) {
    this.handlers.set(type, handler);
  }
  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(type: string, data: unknown) {
    this.handlers.get(type)?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const changed = { type: 'presets.changed', invalidFiles: [] };

it('shares one connection between listeners and closes it with the last one', () => {
  const first = vi.fn();
  const second = vi.fn();
  const stopFirst = subscribeToChanges(first);
  const stopSecond = subscribeToChanges(second);
  expect(FakeEventSource.instances).toHaveLength(1);
  FakeEventSource.instances[0]!.emit('presets.changed', changed);
  expect(first).toHaveBeenCalledWith(changed);
  expect(second).toHaveBeenCalledWith(changed);

  stopFirst();
  expect(FakeEventSource.instances[0]!.closed).toBe(false);
  stopSecond();
  expect(FakeEventSource.instances[0]!.closed).toBe(true);

  // Resubscribing opens a fresh connection.
  const stopAgain = subscribeToChanges(first);
  expect(FakeEventSource.instances).toHaveLength(2);
  stopAgain();
});

it('ignores malformed events and keeps delivering to the other listeners when one throws', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const broken = vi.fn(() => {
    throw new Error('boom');
  });
  const healthy = vi.fn();
  const stops = [subscribeToChanges(broken), subscribeToChanges(healthy)];
  const [connection] = FakeEventSource.instances;
  connection!.emit('presets.changed', { type: 'presets.changed' });
  expect(healthy).not.toHaveBeenCalled();
  connection!.emit('presets.changed', changed);
  expect(healthy).toHaveBeenCalledOnce();
  for (const stop of stops) stop();
  error.mockRestore();
});

it('reopens a connection the browser gave up on, but leaves a reconnecting one alone', () => {
  vi.useFakeTimers();
  const stop = subscribeToChanges(() => {});
  const [first] = FakeEventSource.instances;
  first!.readyState = FakeEventSource.CONNECTING;
  first!.onerror?.();
  vi.advanceTimersByTime(10_000);
  expect(FakeEventSource.instances).toHaveLength(1);

  first!.readyState = FakeEventSource.CLOSED;
  first!.onerror?.();
  vi.advanceTimersByTime(3000);
  expect(FakeEventSource.instances).toHaveLength(2);
  stop();
  expect(FakeEventSource.instances[1]!.closed).toBe(true);
});
