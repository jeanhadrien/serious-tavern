import {
  stateDefinitionInUseDetailsSchema,
  type StateDefinition,
  type StateDefinitionFields,
  type StateDefinitionInUseDetails,
} from '@st/shared';
import { ApiError, stateDefinitionsApi } from '../../api.js';
import { notifyError } from '../../api/transport.js';
import { alerts } from '../../alerts/index.js';
import { stateDefinitionEditorStore, stateDefinitionsStore } from '../../stores/index.js';

// State definition writes shared by the list and the editor. Each refreshes the shared list, so every view (the
// list, the State Read and State Write node panels) reads its own write.

const refresh = () => stateDefinitionsStore.refresh().catch(() => {});

/** `base`, else `base2`, `base3`…: the first name no other definition has (ignoring case). */
export function uniqueName(base: string, taken: readonly string[]): string {
  const lower = new Set(taken.map((name) => name.toLowerCase()));
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base}${n}`;
    if (!lower.has(name.toLowerCase())) return name;
  }
}

/** What a save came to. The two 409s are answered inline by the editor; anything else is reported here. */
export type SaveOutcome =
  | { kind: 'saved'; definition: StateDefinition }
  | { kind: 'name-taken'; message: string }
  | { kind: 'in-use'; message: string; sessions: StateDefinitionInUseDetails['sessions'] }
  | { kind: 'failed' };

/** The chats and workflows of an `STATE_DEFINITION_IN_USE` error; a malformed `details` reads as none. */
function inUseDetails(error: ApiError): StateDefinitionInUseDetails {
  const parsed = stateDefinitionInUseDetailsSchema.safeParse(error.details);
  return parsed.success ? parsed.data : { sessions: [], workflows: [] };
}

export async function saveStateDefinition(id: string, body: StateDefinitionFields): Promise<SaveOutcome> {
  try {
    const definition = await stateDefinitionsApi.update(id, body, { silent: true });
    await refresh();
    alerts.success('State definition saved');
    return { kind: 'saved', definition };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'STATE_DEFINITION_NAME_TAKEN')
      return { kind: 'name-taken', message: error.message };
    if (error instanceof ApiError && error.code === 'STATE_DEFINITION_IN_USE')
      return { kind: 'in-use', message: error.message, sessions: inUseDetails(error).sessions };
    if (error instanceof ApiError) notifyError(error);
    return { kind: 'failed' };
  }
}

/** A new empty definition with a free name. Resolves with undefined when the request failed (toasted). */
export async function createStateDefinition(): Promise<StateDefinition | undefined> {
  const names = stateDefinitionsStore.getSnapshot().map((definition) => definition.name);
  return createStateDefinitionFrom({ name: uniqueName('new_state', names), keys: {} }, false);
}

/** Creates a definition from a body (the Duplicate flows). Resolves with undefined when the request failed. */
export async function createStateDefinitionFrom(
  body: StateDefinitionFields,
  announce = true,
): Promise<StateDefinition | undefined> {
  try {
    const created = await stateDefinitionsApi.create(body);
    await refresh();
    if (announce) alerts.success(`Created "${created.name}"`);
    return created;
  } catch {
    return undefined; // API errors are toasted.
  }
}

/**
 * Deletes a definition. One that chats store state under, or that State nodes use, cannot be deleted: the server
 * answers `STATE_DEFINITION_IN_USE`, and the chats and workflows are shown with what to do about it. Resolves
 * with success.
 */
export async function deleteStateDefinition(definition: Pick<StateDefinition, 'id' | 'name'>): Promise<boolean> {
  try {
    await stateDefinitionsApi.delete(definition.id, { silent: true });
  } catch (error) {
    if (!(error instanceof ApiError)) return false;
    if (error.code === 'STATE_DEFINITION_IN_USE') {
      const { sessions, workflows } = inUseDetails(error);
      const lines = [
        sessions.length && `Chats: ${sessions.map((session) => session.title).join(', ')}`,
        workflows.length && `Workflows: ${workflows.join(', ')}`,
      ].filter(Boolean);
      alerts.error(`"${definition.name}" is still in use, so it was not deleted.`, {
        title: 'State definition in use',
        details: lines.length ? lines.join('\n') : error.message,
      });
    } else notifyError(error);
    return false;
  }
  await refresh();
  alerts.info(`State definition "${definition.name}" deleted`);
  return true;
}

/** Opens a definition in its editor (`show` makes the editor visible). */
export function showStateDefinition(definition: StateDefinition, show: () => void) {
  stateDefinitionEditorStore.open(structuredClone(definition));
  show();
}

/**
 * Opens a definition by id (a node panel's link): from the shared list, fetched once more when it is not there
 * yet (just created elsewhere), and a warning when it no longer exists. The open one keeps its draft.
 */
export async function openStateDefinition(id: string, show: () => void): Promise<void> {
  const find = (list: readonly StateDefinition[]) => list.find((item) => item.id === id);
  const definition =
    find(stateDefinitionsStore.getSnapshot()) ?? find(await stateDefinitionsStore.refresh().catch(() => []));
  if (definition) showStateDefinition(definition, show);
  else alerts.warning('That state definition no longer exists');
}
