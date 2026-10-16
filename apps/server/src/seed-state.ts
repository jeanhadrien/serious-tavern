import type { StateDefinition } from '@st/shared';
import type { StateDefinitionRepository } from './storage/state-definition-repository.js';

/** Fixed, so concurrent initializers write the same file and a restart never duplicates the example. */
export const SCENE_DEFINITION_ID = '8d1f6a42-3c5e-4b7a-9e21-5f0c7a1d9b34';

/** The example definition for the creativity pipeline: pacing state a workflow can read and write. */
export function sceneDefinition(): StateDefinition {
  const date = new Date().toISOString();
  return {
    id: SCENE_DEFINITION_ID,
    name: 'scene',
    description: 'Pacing state for the creativity pipeline',
    keys: {
      tension: { type: 'number', default: 3, min: 0, max: 10 },
      mood: { type: 'enum', options: ['calm', 'uneasy', 'tense', 'release'], default: 'calm' },
      lastInjectionLevel: { type: 'number' },
      injected: { type: 'collection', cap: 30, fields: { level: 'number', entryId: 'text' } },
    },
    createdAt: date,
    updatedAt: date,
  };
}

/**
 * Seeds `scene` into an empty definitions directory, like the other seeds: nothing is created once the user
 * has any definition (or a file the server skipped), and an existing record is never overwritten.
 */
export async function seedStateDefinitions(
  repository: Pick<StateDefinitionRepository, 'list' | 'listInvalid' | 'save'>,
): Promise<void> {
  if ((await repository.list()).length || (await repository.listInvalid()).length) return;
  await repository.save(sceneDefinition());
}
