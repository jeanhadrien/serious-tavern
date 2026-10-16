// Pure helpers of the State Read and State Write panels. The operations a key allows come from the shared
// `stateOpsFor`, never from a list written here.
import { stateOpsFor, type StateDefinition } from '@st/shared';

export type Option = { value: string; label: string; known: boolean };

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The definitions to pick from; a configured id without a record comes first as an unknown entry. */
export function definitionOptions(current: unknown, catalog: readonly StateDefinition[]): Option[] {
  const options = catalog.map((definition) => ({ value: definition.id, label: definition.name, known: true }));
  const id = text(current);
  if (!id || catalog.some((definition) => definition.id === id)) return options;
  return [{ value: id, label: `Unknown definition (${id})`, known: false }, ...options];
}

/** The keys of a definition (`name (type)`); a configured key it does not have comes first as an unknown entry. */
export function keyOptions(definition: StateDefinition | undefined, current: unknown): Option[] {
  const options = Object.entries(definition?.keys ?? {}).map(([name, def]) => ({
    value: name,
    label: `${name} (${def.type})`,
    known: true,
  }));
  const key = text(current);
  if (!key || options.some((option) => option.value === key)) return options;
  return [{ value: key, label: `Unknown key (${key})`, known: false }, ...options];
}

/**
 * The config after the user picks a definition and key. A State Write (`write`) also fits `op` to the key's type
 * (the first operation it allows when the current one is not allowed) and drops its fixed `value` when the
 * definition or key changed, because that value was typed for another key.
 */
export function retarget(
  config: Record<string, unknown>,
  next: { definitionId: string; key: string },
  catalog: readonly StateDefinition[],
  kind: 'read' | 'write',
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...config, definitionId: next.definitionId, key: next.key };
  if (kind === 'read') return result;
  if (config.definitionId !== next.definitionId || config.key !== next.key) delete result.value;
  const def = catalog.find((definition) => definition.id === next.definitionId)?.keys[next.key];
  if (def) {
    const allowed = stateOpsFor(def.type);
    const op = text(config.op) || 'set';
    if (!allowed.some((candidate) => candidate === op)) result.op = allowed[0];
  }
  return result;
}

/** Picking a definition keeps the current key only when the new definition has it. */
export function pickDefinition(
  config: Record<string, unknown>,
  definitionId: string,
  catalog: readonly StateDefinition[],
  kind: 'read' | 'write',
): Record<string, unknown> {
  const definition = catalog.find((item) => item.id === definitionId);
  const key = text(config.key);
  return retarget(
    config,
    { definitionId, key: definition && Object.hasOwn(definition.keys, key) ? key : '' },
    catalog,
    kind,
  );
}

export const pickKey = (
  config: Record<string, unknown>,
  key: string,
  catalog: readonly StateDefinition[],
  kind: 'read' | 'write',
): Record<string, unknown> => retarget(config, { definitionId: text(config.definitionId), key }, catalog, kind);
