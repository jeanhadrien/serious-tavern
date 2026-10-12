import type { ApiResponse } from '@st/shared';
import type { PresetRepository } from '../storage/preset-repository.js';
import { watchDirectory, type DirectoryWatcher } from '../storage/directory-watcher.js';
import { isPresetFile } from '../storage/preset-filenames.js';

export type ChangeEvent = ApiResponse<'streamChanges'>;

/** In-process fan-out of change events to the open event streams. */
export class ChangeHub {
  private readonly listeners = new Set<(event: ChangeEvent) => void>();

  subscribe(listener: (event: ChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: ChangeEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must not affect the others.
      }
    }
  }
}

/** The current state of every event type, sent to each new subscriber so it can resync. */
export async function currentChangeEvents({ presets }: { presets: PresetRepository }): Promise<ChangeEvent[]> {
  return [{ type: 'presets.changed', invalidFiles: await presets.listInvalid() }];
}

/** Publishes `presets.changed` whenever the preset files change on disk (hand edits and our own writes alike). */
export function watchPresetFiles(
  { presets, changes }: { presets: PresetRepository; changes: ChangeHub },
  options: { debounceMs?: number } = {},
): Promise<DirectoryWatcher> {
  return watchDirectory(presets.directory, {
    accept: isPresetFile,
    debounceMs: options.debounceMs,
    onChange: async () => {
      changes.publish({ type: 'presets.changed', invalidFiles: await presets.listInvalid() });
    },
  });
}
