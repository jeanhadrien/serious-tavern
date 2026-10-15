import type { InvalidFile } from '@st/shared';
import { subscribeToChanges } from '../api/events.js';
import { alerts as defaultAlerts } from '../alerts/index.js';

// Live sync for the editors of resources stored as hand-editable YAML files (presets, providers, collections):
// the server announces `<resource>.changed` with the files it could not load, and the open editor follows the disk.

/** What an on-disk change means for the item open in an editor. */
export type DiskChange<T> =
  | { kind: 'unchanged' }
  /** The editor is clean and the file differs: show the new content. */
  | { kind: 'reload'; item: T }
  /** The editor is clean and the item no longer exists. */
  | { kind: 'removed' }
  /** The editor holds unsaved edits and the file moved on; `version` identifies the disk state, for warning once. */
  | { kind: 'conflict'; removed: boolean; version: string };

/**
 * Which invalid-file warnings to show or clear, given the (file -> reason) pairs already shown.
 * The same (file, reason) is never shown twice; a file whose reason changed is cleared and shown again.
 */
export function planInvalidFileAlerts(
  shown: ReadonlyMap<string, string>,
  invalid: readonly InvalidFile[],
): { show: InvalidFile[]; clear: string[] } {
  const current = new Map(invalid.map((item) => [item.file, item.reason]));
  const clear = [...shown].filter(([file, reason]) => current.get(file) !== reason).map(([file]) => file);
  const show = invalid.filter((item) => shown.get(item.file) !== item.reason);
  return { show, clear };
}

/** The resource being synced and how messages name it. */
export interface FileResource {
  event: 'presets.changed' | 'providers.changed' | 'collections.changed';
  /** Lowercase singular noun, e.g. "preset". */
  noun: string;
  /** What to do when the open item was deleted on disk while it has unsaved changes. */
  removedHint: string;
}

/** The editor side of the sync; read at the moment of each decision, so it always sees the latest state. */
export interface FileLiveSyncEditor<T> {
  /** Changes whenever the open item or its saved baseline changes; a list fetched across a change is re-fetched. */
  signature(): string;
  /** Fetches the list (updating the list view) and returns it. */
  refresh(): Promise<T[]>;
  /** What the fresh list means for the open item. */
  classify(fresh: T[]): DiskChange<T>;
  /** The open item's name, for messages. */
  openName(): string;
  onReload(item: T): void;
  onClose(): void;
}

/** The collaborators of the sync, replaceable in tests. */
export interface LiveSyncDeps {
  subscribe: typeof subscribeToChanges;
  alerts: Pick<typeof defaultAlerts, 'warning' | 'info' | 'dismiss'>;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Keeps an editor in step with edits made to its resource's files on disk: refreshes the list, reloads a clean
 * editor, warns about a dirty one (never touching its draft), and surfaces files the server could not load.
 * Returns the stop function.
 */
export function startFileLiveSync<T>(
  resource: FileResource,
  current: () => FileLiveSyncEditor<T>,
  { subscribe, alerts }: LiveSyncDeps = { subscribe: subscribeToChanges, alerts: defaultAlerts },
): () => void {
  const { noun } = resource;
  const Noun = capitalize(noun);
  const shownInvalid = new Map<string, { reason: string; alertId: string }>();
  let warnedConflict: string | undefined;
  let running = false;
  let again = false;
  let disposed = false;

  const showInvalidFiles = (invalid: readonly InvalidFile[]) => {
    const shown = new Map([...shownInvalid].map(([file, item]) => [file, item.reason]));
    const plan = planInvalidFileAlerts(shown, invalid);
    for (const file of plan.clear) {
      const item = shownInvalid.get(file);
      if (item) alerts.dismiss(item.alertId);
      shownInvalid.delete(file);
    }
    for (const { file, reason } of plan.show) {
      const alertId = alerts.warning(`${file} was skipped and is not available as a ${noun}.`, {
        title: `Invalid ${noun} file`,
        details: reason,
        timeoutMs: 0,
      });
      shownInvalid.set(file, { reason, alertId });
    }
  };

  const applyDiskChange = (fresh: T[]) => {
    const editor = current();
    const change = editor.classify(fresh);
    if (change.kind !== 'conflict') warnedConflict = undefined;
    switch (change.kind) {
      case 'reload':
        editor.onReload(change.item);
        break;
      case 'removed':
        alerts.info(`"${editor.openName()}" was removed from disk.`, { title: `${Noun} removed` });
        editor.onClose();
        break;
      case 'conflict': {
        const key = `${editor.signature()}\n${change.version}`;
        if (warnedConflict === key) break;
        warnedConflict = key;
        alerts.warning(
          change.removed
            ? `"${editor.openName()}" was removed from disk while you have unsaved changes. ${resource.removedHint}`
            : `"${editor.openName()}" changed on disk while you have unsaved changes. Saving will overwrite the file.`,
          { title: `${Noun} file changed`, timeoutMs: 10_000 },
        );
        break;
      }
    }
  };

  // The editor may change while the list is being fetched (a save, opening another item); a result
  // fetched against an older editor state is not applied, the list is fetched again instead.
  const sync = async () => {
    for (let attempt = 0; attempt < 3 && !disposed; attempt++) {
      const before = current().signature();
      let fresh: T[];
      try {
        fresh = await current().refresh();
      } catch {
        return;
      }
      if (current().signature() !== before) continue;
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
    if (event.type !== resource.event || !('invalidFiles' in event)) return;
    showInvalidFiles(event.invalidFiles);
    void onChange();
  });
  return () => {
    disposed = true;
    unsubscribe();
  };
}
