import { describe, expect, it, vi } from 'vitest';
import { registerShortcutArea, runShortcut } from './shortcutAreas.js';

describe('shortcut areas', () => {
  const answer = (calls: string[], name: string, result: boolean) => () => {
    calls.push(name);
    return result;
  };
  it('asks the handlers of the view newest first and stops at the first true', () => {
    const calls: string[] = [];
    const off = [
      registerShortcutArea('editor:workflows', { undo: answer(calls, 'old', true) }),
      registerShortcutArea('editor:workflows', { undo: answer(calls, 'recent', false) }),
      registerShortcutArea('editor:workflows', { undo: answer(calls, 'newest', true) }),
    ];
    expect(runShortcut('editor:workflows', 'undo')).toBe(true);
    expect(calls).toEqual(['newest']);
    off[2]?.();
    calls.length = 0;
    expect(runShortcut('editor:workflows', 'undo')).toBe(true);
    expect(calls).toEqual(['recent', 'old']);
    off[0]?.();
    off[1]?.();
    expect(runShortcut('editor:workflows', 'undo')).toBe(false);
  });

  it('only runs the shortcut that was asked for', () => {
    const undo = vi.fn(() => true);
    const redo = vi.fn(() => true);
    const off = registerShortcutArea('editor:workflows', { undo, redo });
    expect(runShortcut('editor:workflows', 'redo')).toBe(true);
    expect(undo).not.toHaveBeenCalled();
    expect(redo).toHaveBeenCalledOnce();
    off();
  });

  it('keeps views apart: another view never gets the shortcut', () => {
    const undo = vi.fn(() => true);
    const off = registerShortcutArea('editor:workflows', { undo });
    expect(runShortcut('editor:presets', 'undo')).toBe(false);
    expect(runShortcut('chat', 'undo')).toBe(false);
    expect(undo).not.toHaveBeenCalled();
    off();
  });

  it('is false when the view claims nothing for that shortcut', () => {
    const off = registerShortcutArea('editor:workflows', { undo: () => true });
    expect(runShortcut('editor:workflows', 'redo')).toBe(false);
    off();
  });
});
