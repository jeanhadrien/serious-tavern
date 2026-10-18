// Pure helpers of the State Read and State Write panels. The operations a key allows come from the shared
// `stateOpsFor`, never from a list written here.
import {
  stateOpsFor,
  stateReads,
  stateReadsFor,
  type StateDefinition,
  type StateKeyType,
  type StateRead,
} from '@st/shared';

export type Option = { value: string; label: string };

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * What the picker tells the user to do next: create a definition when there is none, else pick the definition,
 * then the key. Nothing when both are chosen. (The node's ports cannot resolve until then, which is not reported
 * as an error: this is where it is said.)
 */
export function pickerHint(config: Record<string, unknown>, catalog: readonly StateDefinition[]): string | undefined {
  if (!catalog.length) return 'Create a state definition in the State definitions list first.';
  if (!text(config.definitionId)) return 'Select a state definition.';
  if (!text(config.key)) return 'Select a key.';
  return undefined;
}

/** The definitions to pick from; a configured id without a record comes first as an unknown entry. */
export function definitionOptions(current: unknown, catalog: readonly StateDefinition[]): Option[] {
  const options = catalog.map((definition) => ({ value: definition.id, label: definition.name }));
  const id = text(current);
  if (!id || catalog.some((definition) => definition.id === id)) return options;
  return [{ value: id, label: `Unknown definition (${id})` }, ...options];
}

/** The keys of a definition (`name (type)`); a configured key it does not have comes first as an unknown entry. */
export function keyOptions(definition: StateDefinition | undefined, current: unknown): Option[] {
  const options = Object.entries(definition?.keys ?? {}).map(([name, def]) => ({
    value: name,
    label: `${name} (${def.type})`,
  }));
  const key = text(current);
  if (!key || options.some((option) => option.value === key)) return options;
  return [{ value: key, label: `Unknown key (${key})` }, ...options];
}

/**
 * The reads State Read offers for the picked key's type (`linked` only for a collection; with no key picked yet, the
 * ones every key has). A read already configured stays in the list even when the key cannot do it, so it is visible.
 */
export function readOptions(type: StateKeyType | undefined, current: string): StateRead[] {
  const allowed = type ? stateReadsFor(type) : stateReadsFor('text');
  return allowed.some((read) => read === current) || !stateReads.some((read) => read === current)
    ? allowed
    : [...allowed, current as StateRead];
}

/**
 * The config after the user picks a definition and key. A State Read (`read`) goes back to `value` when its read
 * does not fit the new key's type (`linked` is for collections). A State Write (`write`) also fits `op` to the
 * key's type (the first operation it allows when the current one is not allowed) and drops its fixed `value` when
 * the definition or key changed, because that value was typed for another key.
 */
export function retarget(
  config: Record<string, unknown>,
  next: { definitionId: string; key: string },
  catalog: readonly StateDefinition[],
  kind: 'read' | 'write',
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...config, definitionId: next.definitionId, key: next.key };
  const def = catalog.find((definition) => definition.id === next.definitionId)?.keys[next.key];
  if (kind === 'read') {
    const read = text(config.read) || 'value';
    if (def && !stateReadsFor(def.type).some((candidate) => candidate === read)) result.read = 'value';
    return result;
  }
  if (config.definitionId !== next.definitionId || config.key !== next.key) delete result.value;
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
