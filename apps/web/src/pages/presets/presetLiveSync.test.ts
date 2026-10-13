import { expect, it, vi } from 'vitest';
import { presetSchema, type ChangeEvent, type Preset } from '@st/shared';
import { startPresetLiveSync, type LiveSyncOptions } from './presetLiveSync.js';

const preset = (content = 'Hi'): Preset =>
  presetSchema.parse({
    id: '8f1fe1a9-3480-4e52-834c-f25d90684d71',
    name: 'Main',
    inputs: [],
    entries: [
      { id: 'entry-1', displayName: 'One', kind: 'message', enabled: true, role: 'system', content },
      { id: 'entry-2', displayName: 'Two', kind: 'message', enabled: true, role: 'system', content: 'x' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

function setup(initial: { draft?: Preset; saved?: string; selectedEntryId?: string }, onDisk: () => Preset[]) {
  const listeners: ((event: ChangeEvent) => void)[] = [];
  const unsubscribe = vi.fn();
  const alerts = { warning: vi.fn(() => `alert-${alerts.warning.mock.calls.length}`), info: vi.fn(), dismiss: vi.fn() };
  const state = {
    editor: {
      draft: initial.draft,
      saved: initial.saved ?? JSON.stringify(initial.draft),
      selectedEntryId: initial.selectedEntryId ?? '',
    },
  };
  const options: LiveSyncOptions = {
    get editor() {
      return state.editor;
    },
    refresh: vi.fn(async () => onDisk()),
    onReload: vi.fn(),
    onClose: vi.fn(),
  };
  const stop = startPresetLiveSync(() => options, {
    subscribe: (listener) => {
      listeners.push(listener);
      return unsubscribe;
    },
    alerts,
  });
  const emit = async (invalidFiles: { file: string; reason: string }[] = []) => {
    for (const listener of listeners) listener({ type: 'presets.changed', invalidFiles });
    await vi.waitFor(() => expect(options.refresh).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { options, alerts, state, stop, unsubscribe, emit };
}

it('does nothing for an editor that already matches the disk', async () => {
  const loaded = preset();
  const { options, alerts, emit } = setup({ draft: loaded }, () => [structuredClone(loaded)]);
  await emit();
  expect(options.onReload).not.toHaveBeenCalled();
  expect(options.onClose).not.toHaveBeenCalled();
  expect(alerts.warning).not.toHaveBeenCalled();
});

it('reloads a clean editor, keeping the selected entry by position', async () => {
  const { options, emit } = setup({ draft: preset(), selectedEntryId: 'entry-2' }, () => [preset('Edited by hand')]);
  await emit();
  expect(options.onReload).toHaveBeenCalledOnce();
  expect(options.onReload).toHaveBeenCalledWith(preset('Edited by hand'), 'entry-2');
});

it('closes the editor with an info toast when the preset disappeared', async () => {
  const { options, alerts, emit } = setup({ draft: preset() }, () => []);
  await emit();
  expect(options.onClose).toHaveBeenCalledOnce();
  expect(alerts.info).toHaveBeenCalledOnce();
});

it('leaves a dirty draft alone and warns once per disk version', async () => {
  const loaded = preset();
  let disk = preset('First edit');
  const { options, alerts, emit } = setup(
    { draft: { ...loaded, name: 'Unsaved' }, saved: JSON.stringify(loaded) },
    () => [disk],
  );
  await emit();
  await emit();
  expect(options.onReload).not.toHaveBeenCalled();
  expect(alerts.warning).toHaveBeenCalledOnce();
  disk = preset('Second edit');
  await emit();
  expect(alerts.warning).toHaveBeenCalledTimes(2);
});

it('shows each invalid file once and dismisses its warning when the file is fixed', async () => {
  const { alerts, emit } = setup({}, () => []);
  const broken = { file: 'broken.yaml', reason: 'bad YAML' };
  await emit([broken]);
  await emit([broken]);
  expect(alerts.warning).toHaveBeenCalledOnce();
  expect(alerts.warning).toHaveBeenCalledWith(
    expect.stringContaining('broken.yaml'),
    expect.objectContaining({ details: 'bad YAML', timeoutMs: 0 }),
  );
  await emit([]);
  expect(alerts.dismiss).toHaveBeenCalledWith('alert-1');
  await emit([broken]);
  expect(alerts.warning).toHaveBeenCalledTimes(2);
});

it('discards a fetch made against an editor that changed meanwhile and fetches again', async () => {
  const loaded = preset();
  const saved = preset('Saved from the UI');
  let first = true;
  const harness = setup({ draft: loaded }, () => [loaded]);
  vi.mocked(harness.options.refresh).mockImplementation(async () => {
    if (first) {
      first = false;
      // A UI save lands while the (stale) list is in flight.
      harness.state.editor = { draft: structuredClone(saved), saved: JSON.stringify(saved), selectedEntryId: '' };
      return [loaded];
    }
    return [saved];
  });
  await harness.emit();
  await vi.waitFor(() => expect(harness.options.refresh).toHaveBeenCalledTimes(2));
  expect(harness.options.onReload).not.toHaveBeenCalled();
});

it('stops listening when stopped', () => {
  const { stop, unsubscribe } = setup({}, () => []);
  stop();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
