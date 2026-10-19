import { describe, expect, it, vi } from 'vitest';
import { areaOf, closeNewestLayer, layerCount, pushLayer, registerArea, runArea } from './escapeRegistry.js';

const handler = (calls: string[], name: string, result: boolean) => {
  calls.push(name);
  return result;
};

describe('layers', () => {
  it('closes the newest layer first, one per call', () => {
    const order: string[] = [];
    const popFirst = pushLayer(() => order.push('first'));
    const popSecond = pushLayer(() => order.push('second'));
    expect(layerCount()).toBe(2);
    expect(closeNewestLayer()).toBe(true);
    popSecond(); // the owner unregisters when it closes
    expect(closeNewestLayer()).toBe(true);
    popFirst();
    expect(order).toEqual(['second', 'first']);
    expect(layerCount()).toBe(0);
    expect(closeNewestLayer()).toBe(false);
  });

  it('forgets a layer that unregistered out of order', () => {
    const first = vi.fn();
    const second = vi.fn();
    const popFirst = pushLayer(first);
    const popSecond = pushLayer(second);
    popFirst();
    closeNewestLayer();
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
    popSecond();
    expect(layerCount()).toBe(0);
  });
});

describe('areas', () => {
  it('tries handlers newest first and stops at the first true', () => {
    const calls: string[] = [];
    const old = registerArea('editor:presets', () => handler(calls, 'old', true));
    const recent = registerArea('editor:presets', () => handler(calls, 'recent', false));
    const newest = registerArea('editor:presets', () => handler(calls, 'newest', true));
    expect(runArea('editor:presets')).toBe(true);
    expect(calls).toEqual(['newest']);
    newest();
    calls.length = 0;
    expect(runArea('editor:presets')).toBe(true);
    expect(calls).toEqual(['recent', 'old']);
    old();
    recent();
    expect(runArea('editor:presets')).toBe(false);
  });

  it('runs fallbacks after every other handler, whatever the registration order', () => {
    const calls: string[] = [];
    const fallback = registerArea('editor:providers', () => handler(calls, 'default', true), true);
    const inner = registerArea('editor:providers', () => handler(calls, 'inner', false));
    expect(runArea('editor:providers')).toBe(true);
    expect(calls).toEqual(['inner', 'default']);
    inner();
    fallback();
  });

  it('keeps views apart and answers false for an unknown one', () => {
    const handler = vi.fn(() => true);
    const off = registerArea('chat', handler);
    expect(runArea('editor:workflows')).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    off();
  });
});

describe('areaOf', () => {
  const fakeTree = (view: string | null) => ({
    closest: (selector: string) =>
      selector === '[data-view]' && view
        ? { getAttribute: (name: string) => (name === 'data-view' ? view : null) }
        : null,
  });

  it('reads the data-view of the closest ancestor', () => {
    expect(areaOf(fakeTree('editor:presets'))).toBe('editor:presets');
  });
  it('is undefined outside any view', () => {
    expect(areaOf(fakeTree(null))).toBeUndefined();
    expect(areaOf(null)).toBeUndefined();
  });
});
