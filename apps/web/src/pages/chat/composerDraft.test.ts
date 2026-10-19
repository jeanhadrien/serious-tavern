import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDraftSaver, loadDraft, pruneDrafts, saveDraft } from './composerDraft.js';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const broken = {
  length: 1,
  key: () => {
    throw new Error('blocked');
  },
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('full');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

it('round-trips a draft per chat and reads a missing one as empty', () => {
  const storage = fakeStorage();
  saveDraft('a', 'hello\nworld', storage);
  saveDraft('b', 'other', storage);
  expect(loadDraft('a', storage)).toBe('hello\nworld');
  expect(loadDraft('b', storage)).toBe('other');
  expect(loadDraft('c', storage)).toBe('');
  expect(storage.data.has('st.composer.a')).toBe(true);
});

it('removes the key when the text is empty', () => {
  const storage = fakeStorage();
  saveDraft('a', 'x', storage);
  saveDraft('a', '', storage);
  expect(storage.data.size).toBe(0);
});

it('prunes the drafts of chats that are gone and leaves other keys alone', () => {
  const storage = fakeStorage({ 'st.composer.a': '1', 'st.composer.b': '2', 'st.layout.widths': '{}' });
  pruneDrafts(['a'], storage);
  expect([...storage.data.keys()].sort()).toEqual(['st.composer.a', 'st.layout.widths']);
});

it('falls back silently when storage throws or is missing', () => {
  expect(loadDraft('a', broken)).toBe('');
  expect(() => saveDraft('a', 'x', broken)).not.toThrow();
  expect(() => saveDraft('a', '', broken)).not.toThrow();
  expect(() => pruneDrafts([], broken)).not.toThrow();
  expect(loadDraft('a', undefined)).toBe('');
  expect(() => saveDraft('a', 'x', undefined)).not.toThrow();
  expect(() => pruneDrafts([], undefined)).not.toThrow();
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('saves once after the delay with the latest text', () => {
  const save = vi.fn();
  const saver = createDraftSaver(save, 300);
  saver.schedule('a', 'h');
  vi.advanceTimersByTime(200);
  saver.schedule('a', 'he');
  vi.advanceTimersByTime(200);
  expect(save).not.toHaveBeenCalled();
  vi.advanceTimersByTime(100);
  expect(save).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledWith('a', 'he');
});

it('flushes a pending draft at once to the chat it belongs to, and only once', () => {
  const save = vi.fn();
  const saver = createDraftSaver(save, 300);
  saver.schedule('a', 'text');
  saver.flush();
  expect(save).toHaveBeenCalledWith('a', 'text');
  vi.advanceTimersByTime(1000);
  saver.flush();
  expect(save).toHaveBeenCalledOnce();
});

it('cancel drops the pending draft, and a draft for another chat flushes the earlier one', () => {
  const save = vi.fn();
  const saver = createDraftSaver(save, 300);
  saver.schedule('a', 'text');
  saver.cancel();
  vi.advanceTimersByTime(1000);
  expect(save).not.toHaveBeenCalled();
  saver.schedule('a', 'one');
  saver.schedule('b', 'two');
  expect(save).toHaveBeenCalledWith('a', 'one');
  vi.advanceTimersByTime(300);
  expect(save).toHaveBeenLastCalledWith('b', 'two');
});
