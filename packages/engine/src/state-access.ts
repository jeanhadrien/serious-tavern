import { stateTemplateValues, type StateKeyView, type StateSnapshot } from '@st/shared';
import type { StateAccess } from './types.js';

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/**
 * The template `state` namespace for a run. Frozen, because every node of the run shares it: one node
 * cannot change what another one renders.
 */
export const frozenStateValues = (snapshot?: StateSnapshot): StateAccess['values'] =>
  deepFreeze(stateTemplateValues(snapshot));

const view = (views: Record<string, StateKeyView> | undefined, key: string): StateKeyView | undefined =>
  views && Object.hasOwn(views, key) ? structuredClone(views[key]) : undefined;
const pick = (owners: Record<string, Record<string, StateKeyView>> | undefined, id: string) =>
  owners && Object.hasOwn(owners, id) ? owners[id] : undefined;

/**
 * Read access to the story state a run started with, for one node. Everything handed out is a copy, so a
 * node can never change the snapshot or another node's view. Without a snapshot (a caller that doesn't
 * track story state) it is turn 1 with no definitions, and every read is `undefined`.
 */
export function createStateAccess(
  snapshot: StateSnapshot | undefined,
  nodeId: string,
  values: StateAccess['values'] = frozenStateValues(snapshot),
): StateAccess {
  return {
    turn: snapshot?.turn ?? 1,
    values,
    definition: (id) => {
      const found = snapshot?.definitions.find((definition) => definition.id === id);
      return found && structuredClone(found);
    },
    read: (definitionId, key) => view(pick(snapshot?.keys, definitionId), key),
    own: (key) => view(pick(snapshot?.nodes, nodeId), key),
  };
}
