import type { Character, Persona } from '@st/shared';
import { alerts } from '../../alerts/index.js';
import type { EntityKind } from './entityKinds.js';

/** Creates an item and refreshes the list. Resolves with it, or undefined when the API call failed (already toasted). */
export async function createEntity<T extends Character | Persona>(kind: EntityKind<T>): Promise<T | undefined> {
  try {
    const item = await kind.create();
    await kind.listStore.refresh();
    alerts.success(`${kind.label} created`);
    return item;
  } catch {
    return undefined;
  }
}

/** Imports card or image files and refreshes the list. Resolves with the last imported item, if any. */
export async function importEntityFiles<T extends Character | Persona>(
  kind: EntityKind<T>,
  files: File[],
): Promise<T | undefined> {
  const prepared = kind.prepareFiles(files);
  if (!prepared.length) return undefined;
  const form = new FormData();
  for (const file of prepared) form.append('files', file, file.name);
  try {
    const result = await kind.import(form);
    if (result.imported.length) {
      await kind.listStore.refresh();
      kind.imported(result.imported.length);
    }
    if (result.failed.length) kind.failed(result.failed);
    return result.imported.at(-1);
  } catch {
    return undefined;
  }
}
