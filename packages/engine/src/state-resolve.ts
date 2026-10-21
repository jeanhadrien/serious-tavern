import {
  incrementedValue,
  keyDefault,
  type CollectionItem,
  type StateDefinition,
  type StateKeyDef,
  type StateSnapshot,
  type StateWrite,
} from '@st/shared';
import type { StateWriteRequest } from './types.js';

/** A request as buffered: an `add` already carries its minted item id. */
export type BufferedRequest =
  | Exclude<StateWriteRequest, { op: 'add' }>
  | (Omit<Extract<StateWriteRequest, { op: 'add' }>, 'item'> & { item: CollectionItem });

/** A request of a node that completed, in the wave it ran in. */
export type Committed = { nodeId: string; wave: number; request: BufferedRequest };

type Found = { definition: StateDefinition; key: string; def: StateKeyDef };

const label = (found: Pick<Found, 'definition' | 'key'>) => `${found.definition.name}.${found.key}`;

/**
 * Turns the committed requests (already sorted by wave, node id and call order) into the writes to store.
 * Scalars are stored as the value AFTER the write: an `increment` is computed from the turn-start value plus
 * the earlier writes of the same run to that key, clamped at every step, and stored as a `set`. A request for a
 * definition or key the snapshot doesn't have is dropped with a warning. A node's own key is stored under the
 * run's `workflowId` (node ids are only unique within a workflow). Never throws.
 */
export function resolveWrites(
  committed: readonly Committed[],
  snapshot: StateSnapshot | undefined,
  workflowId?: string,
): { writes: StateWrite[]; warnings: string[] } {
  const writes: StateWrite[] = [];
  const warnings: string[] = [];
  // Where each (definition, key) stands within this run, seeded lazily from the turn-start value.
  const running = new Map<string, unknown>();
  const slot = (found: Found) => `${found.definition.id}\u0000${found.key}`;
  const current = (found: Found) =>
    running.has(slot(found))
      ? running.get(slot(found))
      : (snapshot?.keys[found.definition.id]?.[found.key]?.value ?? keyDefault(found.def));

  for (const { nodeId, request } of committed) {
    const { target } = request;
    if (target.kind === 'node') {
      // A node's own key has no definition to check against.
      const node = {
        kind: 'node' as const,
        nodeId,
        key: target.key,
        ...(workflowId === undefined ? {} : { workflowId }),
      };
      if (request.op === 'set') writes.push({ op: 'set', target: node, nodeId, value: request.value });
      else if (request.op === 'add') writes.push({ op: 'add', target: node, nodeId, item: request.item });
      else if (request.op === 'remove') writes.push({ op: 'remove', target: node, nodeId, itemId: request.itemId });
      else if (request.op === 'delete') writes.push({ op: 'delete', target: node, nodeId });
      continue;
    }
    const definition = snapshot?.definitions.find((candidate) => candidate.id === target.definitionId);
    if (!definition) {
      warnings.push(`A state write was skipped: state definition ${target.definitionId} doesn't exist.`);
      continue;
    }
    const def = Object.hasOwn(definition.keys, target.key) ? definition.keys[target.key] : undefined;
    if (!def) {
      warnings.push(`A state write to "${definition.name}.${target.key}" was skipped: the key doesn't exist.`);
      continue;
    }
    const found: Found = { definition, key: target.key, def };
    const to = { kind: 'definition' as const, definitionId: definition.id, key: target.key };
    switch (request.op) {
      case 'set':
        running.set(slot(found), request.value);
        writes.push({ op: 'set', target: to, nodeId, value: request.value });
        break;
      case 'increment': {
        if (def.type !== 'number') {
          warnings.push(`A state write to "${label(found)}" was skipped: it can only increment a number key.`);
          break;
        }
        const next = incrementedValue(def, current(found), request.by);
        running.set(slot(found), next);
        writes.push({ op: 'set', target: to, nodeId, value: next });
        break;
      }
      case 'delete':
        running.set(slot(found), keyDefault(def));
        writes.push({ op: 'delete', target: to, nodeId });
        break;
      case 'add':
        writes.push({ op: 'add', target: to, nodeId, item: request.item });
        break;
      case 'update':
        if (def.type !== 'collection') {
          warnings.push(`A state write to "${label(found)}" was skipped: only a collection's items can be updated.`);
          break;
        }
        writes.push({ ...request, target: to, nodeId });
        break;
      case 'remove':
        writes.push({ op: 'remove', target: to, nodeId, itemId: request.itemId });
        break;
    }
  }
  return { writes, warnings };
}
