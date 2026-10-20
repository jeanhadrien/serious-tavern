import type { CollectionItem, CollectionKeyDef, StateDefinition, StateKeyDef } from '@st/shared';

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

/**
 * `locateConfigured` for nodes that work on a collection key (Next Chunk, Unlinked Messages): a key of another type is
 * an error that says so.
 */
export async function locateCollection(
  config: Record<string, unknown>,
  lookup: (id: string) => StateDefinition | undefined | Promise<StateDefinition | undefined>,
): Promise<LocatedKey & { def: CollectionKeyDef }> {
  const found = await locateConfigured(config, lookup);
  if (found.def.type !== 'collection')
    throw new Error(`${found.label} is a ${found.def.type} key; this node needs a collection key`);
  return { ...found, def: found.def };
}

/** `locateConfigured` for the Thread node: a key of another type is an error that says so. */
export async function locateThread(
  config: Record<string, unknown>,
  lookup: (id: string) => StateDefinition | undefined | Promise<StateDefinition | undefined>,
): Promise<LocatedKey> {
  const found = await locateConfigured(config, lookup);
  if (found.def.type !== 'thread')
    throw new Error(`${found.label} is a ${found.def.type} key; this node needs a thread key`);
  return found;
}

/** The items a collection key held when the turn started (a copy); an unknown key reads as no items. */
export function itemsOf(
  found: LocatedKey,
  read: (definitionId: string, key: string) => { value: unknown } | undefined,
) {
  const value = read(found.definition.id, found.key)?.value;
  return Array.isArray(value) ? (value as CollectionItem[]) : [];
}

/** A value for a log line: compact JSON, cut to `max` characters. */
export function shown(value: unknown, max = 200): string {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
