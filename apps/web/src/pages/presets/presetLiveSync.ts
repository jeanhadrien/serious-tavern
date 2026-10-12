import type { InvalidPresetFile, Preset } from '@st/shared';
import { subscribeToChanges } from '../../api/events.js';
import { alerts as defaultAlerts } from '../../alerts/index.js';
import { classifyDiskChange, planInvalidFileAlerts, reselectEntryId } from './liveSync.js';

export interface LiveSyncOptions {
  /** The open preset, the serialization it was loaded from (the dirty check's baseline) and the selected entry. */
  editor: { draft?: Preset; saved: string; selectedEntryId: string };
  /** Fetches the catalog (updating the list view) and returns it. */
  refresh(): Promise<Preset[]>;
  onReload(preset: Preset, selectedEntryId: string): void;
  onClose(): void;
}

const signature = ({ draft, saved }: LiveSyncOptions['editor']) => `${draft?.id ?? ''}\n${saved}`;

/** The collaborators of the sync, replaceable in tests. */
export interface LiveSyncDeps {
  subscribe: typeof subscribeToChanges;
  alerts: Pick<typeof defaultAlerts, 'warning' | 'info' | 'dismiss'>;
}

/**
 * Keeps the presets page in step with edits made to the preset files on disk: refreshes the list, reloads a
 * clean editor, warns about a dirty one (never touching its draft), and surfaces files the server could not load.
 * `current` is read at the moment of each decision, so it always sees the latest editor state. Returns the stop function.
 */
export function startPresetLiveSync(
  current: () => LiveSyncOptions,
  { subscribe, alerts }: LiveSyncDeps = { subscribe: subscribeToChanges, alerts: defaultAlerts },
): () => void {
  const shownInvalid = new Map<string, { reason: string; alertId: string }>();
  let warnedConflict: string | undefined;
  let running = false;
  let again = false;
  let disposed = false;

  const showInvalidFiles = (invalid: readonly InvalidPresetFile[]) => {
    const shown = new Map([...shownInvalid].map(([file, item]) => [file, item.reason]));
    const plan = planInvalidFileAlerts(shown, invalid);
    for (const file of plan.clear) {
      const item = shownInvalid.get(file);
      if (item) alerts.dismiss(item.alertId);
      shownInvalid.delete(file);
    }
    for (const { file, reason } of plan.show) {
      const alertId = alerts.warning(`${file} was skipped and is not available as a preset.`, {
        title: 'Invalid preset file',
        details: reason,
        timeoutMs: 0,
      });
      shownInvalid.set(file, { reason, alertId });
    }
  };

  const applyDiskChange = (fresh: Preset[]) => {
    const { editor, onReload, onClose } = current();
    const change = classifyDiskChange(editor, fresh);
    if (change.kind !== 'conflict') warnedConflict = undefined;
    switch (change.kind) {
      case 'reload':
        onReload(change.preset, reselectEntryId(editor.draft!.entries, editor.selectedEntryId, change.preset.entries));
        break;
      case 'removed':
        alerts.info(`"${editor.draft!.name}" was removed from disk.`, { title: 'Preset removed' });
        onClose();
        break;
      case 'conflict': {
        const key = `${editor.draft!.id}
${change.version}`;
        if (warnedConflict === key) break;
        warnedConflict = key;
        alerts.warning(
          change.removed
            ? `"${editor.draft!.name}" was removed from disk while you have unsaved changes. Saving will fail; duplicate the preset to keep your edits.`
            : `"${editor.draft!.name}" changed on disk while you have unsaved changes. Saving will overwrite the file.`,
          { title: 'Preset file changed', timeoutMs: 10_000 },
        );
        break;
      }
    }
  };

  // The editor may change while the list is being fetched (a save, selecting another preset); a result
  // fetched against an older editor state is not applied, the list is fetched again instead.
  const sync = async () => {
    for (let attempt = 0; attempt < 3 && !disposed; attempt++) {
      const before = signature(current().editor);
      let fresh: Preset[];
      try {
        fresh = await current().refresh();
      } catch {
        return;
      }
      if (signature(current().editor) !== before) continue;
      applyDiskChange(fresh);
      return;
    }
  };

  // Events arriving while a sync runs are folded into one follow-up sync.
  const onChange = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await sync();
      } while (again && !disposed);
    } finally {
      running = false;
    }
  };

  const unsubscribe = subscribe((event) => {
    if (event.type !== 'presets.changed') return;
    showInvalidFiles(event.invalidFiles);
    void onChange();
  });
  return () => {
    disposed = true;
    unsubscribe();
  };
}
