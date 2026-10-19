import { afterEach, expect, it, vi } from 'vitest';
import { clampSize, clearSize, loadSize, saveSize } from './storedSize.js';

const memory = () => {
  const store = new Map<string, string>();
  return {
    store,
    storage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
};

afterEach(() => vi.unstubAllGlobals());

it.each([
  [100, 200, 300, 200],
  [250, 200, 300, 250],
  [999, 200, 300, 300],
  [200, 200, 300, 200],
  [300, 200, 300, 300],
])('clamps %d into %d..%d', (value, min, max, expected) => {
  expect(clampSize(value, min, max)).toBe(expected);
});

it('round-trips a size under st.size.<key> and clears it', () => {
  const { store, storage } = memory();
  expect(loadSize('chat', 320, storage)).toBe(320);
  saveSize('chat', 410, storage);
  expect(store.get('st.size.chat')).toBe('410');
  expect(loadSize('chat', 320, storage)).toBe(410);
  clearSize('chat', storage);
  expect(store.has('st.size.chat')).toBe(false);
  expect(loadSize('chat', undefined, storage)).toBeUndefined();
});

it.each(['abc', '', '  ', 'NaN', 'Infinity', '-Infinity', '{"a":1}'])('reads %j as the fallback', (raw) => {
  const { store, storage } = memory();
  store.set('st.size.k', raw);
  expect(loadSize('k', 7, storage)).toBe(7);
});

it('falls back silently when the storage methods throw', () => {
  const blocked = () => {
    throw new Error('blocked');
  };
  const storage = { getItem: blocked, setItem: blocked, removeItem: blocked };
  expect(loadSize('k', 5, storage)).toBe(5);
  expect(() => saveSize('k', 1, storage)).not.toThrow();
  expect(() => clearSize('k', storage)).not.toThrow();
});

it('falls back silently when reading localStorage itself throws or it is missing', () => {
  vi.stubGlobal('localStorage', undefined);
  expect(loadSize('k', 5)).toBe(5);
  expect(() => saveSize('k', 1)).not.toThrow();
  vi.unstubAllGlobals();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('blocked');
    },
  });
  try {
    expect(loadSize('k', 5)).toBe(5);
    expect(() => saveSize('k', 1)).not.toThrow();
    expect(() => clearSize('k')).not.toThrow();
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
