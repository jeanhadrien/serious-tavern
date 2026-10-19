import type { StateDefinition } from '../state/definition.js';

/**
 * What a workflow's run reads and writes of the chat's shared data (docs/plans/triggers/03-concurrency.md). Two runs of
 * a turn may overlap in time unless one of them writes what the other reads: then the one listed below waits, so the
 * result is always what running them top to bottom would give.
 *
 * `everything` contains all the others, `state` contains every definition and key, a `definition` its keys. `messages`
 * (the chat's messages) is a resource of its own: a collection item's computed `link` depends on the chat, so what reads
 * a collection key also reads `messages` (see `keyAccess`).
 */
export type Resource =
  | { kind: 'key'; definitionId: string; key: string }
  | { kind: 'definition'; definitionId: string }
  | { kind: 'state' }
  | { kind: 'messages' }
  | { kind: 'everything' };

export type Access = { reads: Resource[]; writes: Resource[] };

export const noAccess = (): Access => ({ reads: [], writes: [] });
export const everythingAccess = (): Access => ({ reads: [{ kind: 'everything' }], writes: [{ kind: 'everything' }] });

const stateLevel = (resource: Resource): boolean =>
  resource.kind === 'key' || resource.kind === 'definition' || resource.kind === 'state';

/** Whether `a` contains `b` or the other way round, or they are the same thing. */
export function overlaps(a: Resource, b: Resource): boolean {
  if (a.kind === 'everything' || b.kind === 'everything') return true;
  if (a.kind === 'messages' || b.kind === 'messages') return a.kind === b.kind;
  // Both are about the story state now.
  if (a.kind === 'state' || b.kind === 'state') return true;
  if (a.definitionId !== b.definitionId) return false;
  if (a.kind === 'definition' || b.kind === 'definition') return true;
  return a.key === b.key;
}

const identity = (resource: Resource): string =>
  resource.kind === 'key'
    ? `key:${resource.definitionId}:${resource.key}`
    : resource.kind === 'definition'
      ? `definition:${resource.definitionId}`
      : resource.kind;

/** Contained resources are left out: `everything` swallows all, `state` the story state, a definition its keys. */
export function simplify(resources: readonly Resource[]): Resource[] {
  if (resources.some((resource) => resource.kind === 'everything')) return [{ kind: 'everything' }];
  const wholeState = resources.some((resource) => resource.kind === 'state');
  const wholeDefinitions = new Set(
    resources.flatMap((resource) => (resource.kind === 'definition' ? [resource.definitionId] : [])),
  );
  const kept: Resource[] = [];
  for (const resource of resources) {
    if (wholeState && stateLevel(resource) && resource.kind !== 'state') continue;
    if (resource.kind === 'key' && wholeDefinitions.has(resource.definitionId)) continue;
    if (!kept.some((other) => identity(other) === identity(resource))) kept.push(resource);
  }
  return kept;
}

/** The union of the accesses, simplified. */
export function mergeAccess(...accesses: readonly Access[]): Access {
  return {
    reads: simplify(accesses.flatMap((access) => access.reads)),
    writes: simplify(accesses.flatMap((access) => access.writes)),
  };
}

/** The first write of `earlier` that overlaps a read of `later`: why `later` has to wait for it. */
export function waitReason(earlier: Access, later: Access): { write: Resource; read: Resource } | undefined {
  for (const read of later.reads) for (const write of earlier.writes) if (overlaps(write, read)) return { write, read };
  return undefined;
}

/**
 * For each run of a turn, in list order, the indexes of the EARLIER runs it waits for: those whose writes overlap what it
 * reads. A run waits for nothing else, so runs that cannot affect each other run at the same time. Two runs that only
 * write the same thing do not wait for each other: their writes are stored in list order whichever finishes first.
 */
export function predecessors(runs: readonly Access[]): number[][] {
  return runs.map((run, index) =>
    runs.slice(0, index).flatMap((earlier, other) => (waitReason(earlier, run) ? [other] : [])),
  );
}

/**
 * Names a resource for a person: `scene.tension`, `everything in scene`, `the story state`, `the chat history`.
 * An unknown definition id reads as the id itself.
 */
export function describeResource(resource: Resource, definitions: readonly Pick<StateDefinition, 'id' | 'name'>[]) {
  const nameOf = (id: string) => definitions.find((definition) => definition.id === id)?.name ?? id;
  switch (resource.kind) {
    case 'key':
      return `${nameOf(resource.definitionId)}.${resource.key}`;
    case 'definition':
      return `everything in ${nameOf(resource.definitionId)}`;
    case 'state':
      return 'the story state';
    case 'messages':
      return 'the chat history';
    default:
      return 'everything';
  }
}
