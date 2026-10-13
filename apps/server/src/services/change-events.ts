import type { ApiResponse } from '@st/shared';
import type { Repository } from '../storage/repository.js';
import type { PresetRepository } from '../storage/preset-repository.js';
import { watchDirectory, type DirectoryWatcher } from '../storage/directory-watcher.js';
import { isYamlFile } from '../storage/yaml-filenames.js';

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

/** Resources whose changes are announced by wrapping their repository (presets use the file watcher instead). */
export type RecordResource = 'workflows' | 'characters' | 'personas' | 'sessions';

/**
 * A repository that publishes `<resource>.changed` after every successful save, update and delete, so no
 * write path (route, service, import) can forget to announce itself. `silent` is the underlying repository,
 * for writers that announce on their own schedule (a streaming turn announces once, when it settles).
 */
export class NotifyingRepository<T extends { id: string }> implements Repository<T> {
  constructor(
    readonly silent: Repository<T>,
    private readonly changes: ChangeHub,
    private readonly resource: RecordResource,
  ) {}

  private announce(id: string) {
    this.changes.publish({ type: `${this.resource}.changed`, id });
  }
  list() {
    return this.silent.list();
  }
  get(id: string) {
    return this.silent.get(id);
  }
  async save(item: T) {
    await this.silent.save(item);
    this.announce(item.id);
  }
  async update(id: string, mutator: (current: T) => T | Promise<T>) {
    const updated = await this.silent.update(id, mutator);
    if (updated) this.announce(id);
    return updated;
  }
  async delete(id: string, beforeDelete?: (current: T | undefined) => void | Promise<void>) {
    await this.silent.delete(id, beforeDelete);
    this.announce(id);
  }
}

/** The current state of every event type, sent to each new subscriber so it can resync. */
export async function currentChangeEvents({ presets }: { presets: PresetRepository }): Promise<ChangeEvent[]> {
  return [
    { type: 'presets.changed', invalidFiles: await presets.listInvalid() },
    { type: 'workflows.changed' },
    { type: 'characters.changed' },
    { type: 'personas.changed' },
    { type: 'sessions.changed' },
  ];
}

/** Publishes `presets.changed` whenever the preset files change on disk (hand edits and our own writes alike). */
export function watchPresetFiles(
  { presets, changes }: { presets: PresetRepository; changes: ChangeHub },
  options: { debounceMs?: number } = {},
): Promise<DirectoryWatcher> {
  return watchDirectory(presets.directory, {
    accept: isYamlFile,
    debounceMs: options.debounceMs,
    onChange: async () => {
      changes.publish({ type: 'presets.changed', invalidFiles: await presets.listInvalid() });
    },
  });
}
