import { describe, expect, it, vi } from 'vitest';
import { liveSyncEditor, type FileSyncEditor } from './useFileSync.js';

interface Item {
  id: string;
  name: string;
  body: string;
}
const saved: Item = { id: 'a', name: 'One', body: 'x' };

const editor = (over: Partial<FileSyncEditor<Item, string>> = {}): FileSyncEditor<Item, string> => ({
  resource: { event: 'providers.changed', noun: 'provider', removedHint: '' },
  item: saved,
  draft: 'x',
  baseline: (item) => item.body,
  refresh: vi.fn(async () => [saved]),
  classify: vi.fn(() => ({ kind: 'unchanged' as const })),
  onReload: vi.fn(),
  onClose: vi.fn(),
  ...over,
});

describe('liveSyncEditor', () => {
  it('names the open item, and signs it by id, delete in progress and saved form', () => {
    const open = liveSyncEditor(editor(), () => undefined);
    expect(open.openName()).toBe('One');
    expect(open.signature()).toBe('a\n\nx');
    expect(liveSyncEditor(editor({ item: { ...saved, body: 'y' } }), () => undefined).signature()).not.toBe(
      open.signature(),
    );
    expect(liveSyncEditor(editor(), () => 'a').signature()).not.toBe(open.signature());
  });

  it('has an empty signature and name with nothing open', () => {
    const none = liveSyncEditor(editor({ item: undefined, draft: undefined }), () => undefined);
    expect(none.signature()).toBe('\n\n');
    expect(none.openName()).toBe('');
  });

  it('refreshes with the open id', async () => {
    const refresh = vi.fn(async () => [saved]);
    await liveSyncEditor(editor({ refresh }), () => undefined).refresh();
    expect(refresh).toHaveBeenCalledWith('a');
    await liveSyncEditor(editor({ refresh, item: undefined }), () => undefined).refresh();
    expect(refresh).toHaveBeenLastCalledWith(undefined);
  });

  it('classifies with the item, the draft and whether this editor is deleting that item', () => {
    const classify = vi.fn(() => ({ kind: 'removed' as const }));
    let deleting: string | undefined;
    const sync = liveSyncEditor(editor({ classify }), () => deleting);
    expect(sync.classify([saved])).toEqual({ kind: 'removed' });
    expect(classify).toHaveBeenLastCalledWith({ item: saved, draft: 'x', deleting: false }, [saved]);
    // Read when asked, not when built: a delete that starts meanwhile counts.
    deleting = 'a';
    sync.classify([]);
    expect(classify).toHaveBeenLastCalledWith({ item: saved, draft: 'x', deleting: true }, []);
    // Another item's delete does not.
    deleting = 'other';
    sync.classify([]);
    expect(classify).toHaveBeenLastCalledWith({ item: saved, draft: 'x', deleting: false }, []);
  });

  it('hands reload and close to the sync as they are', () => {
    const onReload = vi.fn();
    const onClose = vi.fn();
    const sync = liveSyncEditor(editor({ onReload, onClose }), () => undefined);
    sync.onReload(saved);
    sync.onClose();
    expect(onReload).toHaveBeenCalledWith(saved);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
