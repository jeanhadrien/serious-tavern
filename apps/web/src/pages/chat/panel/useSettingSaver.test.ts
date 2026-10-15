import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingSaver, type SaveOptions } from './useSettingSaver.js';

describe('chat setting saver', () => {
  let pending: Record<string, unknown>;
  let saves: { patch: Record<string, unknown>; options?: SaveOptions; resolve(): void }[];
  const setPending = (update: (current: Record<string, unknown>) => Record<string, unknown>) => {
    pending = update(pending);
  };
  const make = () =>
    createSettingSaver(
      (patch, options) =>
        new Promise<void>((resolve) => {
          saves.push({ patch, ...(options ? { options } : {}), resolve });
        }),
      setPending,
      500,
    );
  const settle = async (index: number) => {
    saves[index]!.resolve();
    await vi.runAllTimersAsync();
  };
  beforeEach(() => {
    vi.useFakeTimers();
    pending = {};
    saves = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves at once in "now" mode and drops the pending value when the save answers', async () => {
    const saver = make();
    saver.change('on', true, 'now');
    expect(pending).toEqual({ on: true });
    expect(saves.map((save) => save.patch)).toEqual([{ on: true }]);
    await settle(0);
    expect(pending).toEqual({});
  });

  it('debounces typed values into one request with the last value', async () => {
    const saver = make();
    saver.change('v', 0.1, 'debounced');
    await vi.advanceTimersByTimeAsync(300);
    saver.change('v', 0.15, 'debounced');
    await vi.advanceTimersByTimeAsync(300);
    expect(saves).toHaveLength(0);
    expect(pending).toEqual({ v: 0.15 });
    await vi.advanceTimersByTimeAsync(200);
    expect(saves.map((save) => save.patch)).toEqual([{ v: 0.15 }]);
  });

  it('sends a waiting value on flush, and only once', async () => {
    const saver = make();
    saver.change('note', 'Rain', 'debounced');
    saver.flush('note');
    saver.flush('note');
    await vi.advanceTimersByTimeAsync(1000);
    expect(saves.map((save) => save.patch)).toEqual([{ note: 'Rain' }]);
  });

  it('keeps pending values until every save in flight has answered', async () => {
    const saver = make();
    saver.change('a', 1, 'now');
    saver.change('b', 2, 'now');
    await settle(0);
    expect(pending).toEqual({ a: 1, b: 2 });
    await settle(1);
    expect(pending).toEqual({});
  });

  it('keeps a newer value typed while its save was in flight', async () => {
    const saver = make();
    saver.change('v', 1, 'now');
    saver.change('v', 2, 'debounced');
    await settle(0);
    expect(pending).toEqual({ v: 2 });
  });

  it('resets with null, cancelling a waiting value', async () => {
    const saver = make();
    saver.change('v', 1, 'debounced');
    saver.reset('v');
    expect(pending).toEqual({ v: null });
    await vi.advanceTimersByTimeAsync(1000);
    expect(saves.map((save) => save.patch)).toEqual([{ v: null }]);
    await settle(0);
    expect(pending).toEqual({});
  });

  it('sends every waiting value on flushAll, one request at a time', async () => {
    const saver = make();
    saver.change('a', 1, 'debounced');
    saver.change('b', 'x', 'debounced');
    saver.flushAll();
    expect(saves.map((save) => save.patch)).toEqual([{ a: 1 }]);
    await settle(0);
    expect(saves.map((save) => save.patch)).toEqual([{ a: 1 }, { b: 'x' }]);
  });

  it('keeps one request in flight and sends what came due meanwhile together, so answers stay in order', async () => {
    const saver = make();
    saver.change('flag', true, 'now');
    saver.change('mood', 'tense', 'now');
    saver.change('level', 2, 'debounced');
    saver.flush('level');
    expect(saves.map((save) => save.patch)).toEqual([{ flag: true }]);
    await settle(0);
    expect(saves.map((save) => save.patch)).toEqual([{ flag: true }, { mood: 'tense', level: 2 }]);
    expect(pending).toEqual({ flag: true, mood: 'tense', level: 2 });
    await settle(1);
    expect(pending).toEqual({});
  });

  it('cancels a value not sent yet, so a valid prefix of invalid input is never saved', async () => {
    const saver = make();
    saver.change('level', 1, 'debounced');
    saver.cancel('level');
    expect(pending).toEqual({});
    await vi.advanceTimersByTimeAsync(1000);
    saver.flush('level');
    saver.flushAll();
    expect(saves).toHaveLength(0);
  });

  it('cancels a value queued behind the request in flight', async () => {
    const saver = make();
    saver.change('on', true, 'now');
    saver.change('level', 1, 'debounced');
    await vi.advanceTimersByTimeAsync(500);
    saver.cancel('level');
    await settle(0);
    expect(saves.map((save) => save.patch)).toEqual([{ on: true }]);
    expect(pending).toEqual({});
  });

  it('sends everything not sent yet at once with keepalive when the page goes away', async () => {
    const saver = make();
    saver.change('on', true, 'now');
    saver.change('mood', 'calm', 'now');
    saver.change('note', 'Rain', 'debounced');
    saver.flushNow();
    expect(saves.map(({ patch, options }) => ({ patch, options }))).toEqual([
      { patch: { on: true }, options: undefined },
      { patch: { mood: 'calm', note: 'Rain' }, options: { keepalive: true } },
    ]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(saves).toHaveLength(2);
  });

  it('sends the newest value of a key on flushNow', async () => {
    const saver = make();
    saver.change('on', true, 'now');
    saver.change('v', 1, 'debounced');
    await vi.advanceTimersByTimeAsync(500);
    saver.change('v', 2, 'debounced');
    saver.flushNow();
    expect(saves[1]?.patch).toEqual({ v: 2 });
  });

  it('drops pending values after a failed save too', async () => {
    const saver = createSettingSaver(() => Promise.reject(new Error('400')), setPending);
    saver.change('v', 9, 'now');
    await vi.runAllTimersAsync();
    expect(pending).toEqual({});
  });
});
