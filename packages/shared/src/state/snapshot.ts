import { withItemLinks } from '../links/analyze.js';
import type { LinkMessage } from '../links/fingerprint.js';
import type { PortDataType } from '../ports.js';
import { keyDefault, stateKeyPortType, type StateDefinition, type StateKeyDef } from './definition.js';
import { foldStoryState } from './fold.js';
import type { FoldedKey, KeyMeta, StoryState } from './fold-types.js';
import { byText } from './helpers.js';

/** What a run can read of one key: its value as the turn started, and its meta. */
export type StateKeyView = {
  value: unknown;
  meta: KeyMeta;
  /** Collections: the turn number that added each item, in the items' order (newest first). */
  itemTurns?: number[];
};

/**
 * The story state a run starts from, computed by the server at turn start: no history and no warnings, only
 * what nodes and templates may read. `keys` is by definition id, `nodes` by node id (implicit keys).
 */
export type StateSnapshot = {
  /** The turn being run (in an after-reply run: the turn that just finished). */
  turn: number;
  definitions: StateDefinition[];
  keys: Record<string, Record<string, StateKeyView>>;
  nodes: Record<string, Record<string, StateKeyView>>;
};

const views = (keys: Record<string, FoldedKey>, history?: readonly LinkMessage[]): Record<string, StateKeyView> =>
  Object.fromEntries(
    Object.entries(keys).map(([key, { value, meta, itemTurns }]) => [
      key,
      {
        // Collection items that link to messages carry a computed, read-only `link` (never stored).
        value: history && meta.count !== undefined && Array.isArray(value) ? withItemLinks(value, history) : value,
        meta,
        ...(itemTurns && { itemTurns }),
      },
    ]),
  );

/**
 * What a run reads. With `history` (the history messages the run's nodes see) collection items that link to messages
 * get `link: { status, ids, first }` (see `withItemLinks`); without it items are left as they are.
 */
export function stateSnapshot(
  story: StoryState,
  definitions: readonly StateDefinition[],
  history?: readonly LinkMessage[],
): StateSnapshot {
  return {
    turn: story.turn,
    definitions: structuredClone([...definitions]),
    keys: Object.fromEntries(story.definitions.map((folded) => [folded.definitionId, views(folded.keys, history)])),
    nodes: Object.fromEntries(story.nodes.map((folded) => [folded.nodeId, views(folded.keys, history)])),
  };
}

/** Turn 1 of a chat with no stored state: every key at its default (previews, runs without a session). */
export function emptyStateSnapshot(definitions: readonly StateDefinition[] = []): StateSnapshot {
  return stateSnapshot(foldStoryState({ definitions, messages: [], state: undefined }), definitions);
}

/**
 * Definitions oldest first (`createdAt`, then `id`). A name is only usable by one definition in templates;
 * hand-edited files can repeat one, and the oldest keeps it.
 */
export function oldestFirst<T extends Pick<StateDefinition, 'id' | 'createdAt'>>(definitions: readonly T[]): T[] {
  return [...definitions].sort((a, b) => byText(a.createdAt, b.createdAt) || byText(a.id, b.id));
}

/**
 * The `state` namespace of a template: `{ <definition name>: { <key>: value } }`. Collections are their
 * kept items, newest first. Where a name repeats, the oldest definition wins.
 */
export function stateTemplateValues(snapshot?: StateSnapshot): Record<string, Record<string, unknown>> {
  const values: Record<string, Record<string, unknown>> = {};
  for (const definition of oldestFirst(snapshot?.definitions ?? [])) {
    if (Object.hasOwn(values, definition.name)) continue;
    values[definition.name] = Object.fromEntries(
      Object.entries(definition.keys).map(([key, def]) => {
        const view = snapshot?.keys[definition.id]?.[key];
        return [key, view ? view.value : keyDefault(def)];
      }),
    );
  }
  return values;
}

/** Plain-language notes for the execution log about definitions that repeat a name. */
export function duplicateNameIssues(definitions: readonly StateDefinition[]): string[] {
  const counts = new Map<string, number>();
  for (const { name } of definitions) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts]
    .filter(([, count]) => count > 1)
    .sort(([a], [b]) => byText(a, b))
    .map(
      ([name, count]) =>
        `State definition name "${name}" is used ${count === 2 ? 'twice' : `${count} times`}; only the oldest is available to templates.`,
    );
}

/** A key a template can read: `path` is `<definition>.<key>`. */
export type StateHint = { path: string; type: PortDataType; description: string };

function describeKey(def: StateKeyDef): string {
  switch (def.type) {
    case 'number': {
      const { min, max } = def;
      if (min !== undefined && max !== undefined) return `Number from ${min} to ${max}`;
      if (min !== undefined) return `Number, at least ${min}`;
      return max === undefined ? 'Number' : `Number, at most ${max}`;
    }
    case 'boolean':
      return 'True or false';
    case 'enum':
      return `One of: ${def.options.join(', ')}`;
    case 'text':
      return 'Text';
    case 'object':
      return 'Object';
    case 'collection':
      return `List of items, newest first${def.cap === undefined ? '' : ` (up to ${def.cap})`}`;
  }
}

/** Template hints for the keys of a set of definitions (the oldest definition per name). */
export function stateHints(definitions: readonly StateDefinition[]): StateHint[] {
  const seen = new Set<string>();
  return oldestFirst(definitions).flatMap((definition) => {
    if (seen.has(definition.name)) return [];
    seen.add(definition.name);
    return Object.entries(definition.keys).map(([key, def]) => ({
      path: `${definition.name}.${key}`,
      type: stateKeyPortType(def.type),
      description: `Story state: ${describeKey(def)}`,
    }));
  });
}
