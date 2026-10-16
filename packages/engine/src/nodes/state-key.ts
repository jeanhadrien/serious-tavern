import type { StateDefinition, StateKeyDef } from '@st/shared';

/** A key of a state definition, found by the ids a State Read or State Write node is configured with. */
export type LocatedKey = { definition: StateDefinition; key: string; def: StateKeyDef; label: string };

/**
 * Finds the configured key. The config may be unparsed (editor port requests, edge pruning), so ids are read
 * defensively. Throws plain errors that name what to fix; `resolvePorts` and `execute` share them.
 */
function locateKey(definition: StateDefinition | undefined, definitionId: unknown, key: unknown): LocatedKey {
  const id = typeof definitionId === 'string' ? definitionId : '';
  if (!id) throw new Error('Select a state definition');
  if (!definition)
    throw new Error(`State definition ${id} not found. Pick another state definition in the node's settings.`);
  const name = typeof key === 'string' ? key : '';
  if (!name) throw new Error('Select a key');
  if (!Object.hasOwn(definition.keys, name))
    throw new Error(`State definition "${definition.name}" has no key "${name}"`);
  return { definition, key: name, def: definition.keys[name]!, label: `${definition.name}.${name}` };
}

/**
 * `locateKey` for a node's config. `lookup` finds a definition by id: the run's resources while resolving
 * ports, the turn's snapshot while executing.
 */
export async function locateConfigured(
  config: Record<string, unknown>,
  lookup: (id: string) => StateDefinition | undefined | Promise<StateDefinition | undefined>,
): Promise<LocatedKey> {
  const id = typeof config.definitionId === 'string' ? config.definitionId : '';
  return locateKey(id ? await lookup(id) : undefined, id, config.key);
}

/** A value for a log line: compact JSON, cut to `max` characters. */
export function shown(value: unknown, max = 200): string {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
