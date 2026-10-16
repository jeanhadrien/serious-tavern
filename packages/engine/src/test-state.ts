import { emptyStateSnapshot, type StateDefinition, type StateKeyView, type StateSnapshot } from '@st/shared';
import { createStateAccess } from './state-access.js';
import type { ExecutionContext } from './types.js';

// Fixtures for tests that build an `ExecutionContext` by hand or need a story state to run against.

/** The state members of a context for a run that tracks no story state: reads find nothing, writes vanish. */
export const stateless = (nodeId: string): Pick<ExecutionContext, 'state' | 'writeState'> => ({
  state: createStateAccess(undefined, nodeId),
  writeState: () => ({}),
});

type Override = Partial<Omit<StateKeyView, 'meta'>> & { meta?: Partial<StateKeyView['meta']> };

/**
 * A snapshot built by hand: every key of `definitions` at its default, then `keys` (by
 * `<definition name>.<key>`) and `nodes` (by node id, then key) override a value, its meta or its item turns.
 * `turn` is the turn being run; unwritten keys report it as `turnsSinceWrite`.
 */
export function snapshotOf(
  definitions: StateDefinition[],
  options: {
    turn?: number;
    keys?: Record<string, Override>;
    nodes?: Record<string, Record<string, Override>>;
  } = {},
): StateSnapshot {
  const snapshot = emptyStateSnapshot(definitions);
  const turn = options.turn ?? 1;
  snapshot.turn = turn;
  const merge = (base: StateKeyView | undefined, override: Override): StateKeyView =>
    ({
      ...base,
      ...override,
      meta: { written: false, turnsSinceWrite: turn, writtenAtTurn: null, ...base?.meta, ...override.meta },
    }) as StateKeyView;
  for (const definition of definitions) {
    const views = snapshot.keys[definition.id]!;
    for (const key of Object.keys(views)) {
      const view = views[key]!;
      if (!view.meta.written) view.meta.turnsSinceWrite = turn;
      const override = options.keys?.[`${definition.name}.${key}`];
      if (override) views[key] = merge(view, override);
    }
  }
  for (const [nodeId, keys] of Object.entries(options.nodes ?? {}))
    snapshot.nodes[nodeId] = Object.fromEntries(
      Object.entries(keys).map(([key, override]) => [key, merge(undefined, { meta: { written: true }, ...override })]),
    );
  return snapshot;
}
