import { commitItemLinks, type ChatMessage, type StateDefinition, type StateWrite } from '@st/shared';

/**
 * The commit-time check of a run's linked writes (see `commitItemLinks`): `history` is the chat's history messages as
 * they are NOW, so call it inside the session's `update`, after the turn's own messages are in. Returns the writes to
 * store (a write whose linked messages changed meanwhile is gone, one without a fingerprint has taken it) and the
 * warnings in plain language, which belong on the turn's entry and in the run's execution log.
 */
export function commitLinks(
  history: readonly ChatMessage[],
  writes: StateWrite[],
  definitions: readonly StateDefinition[],
): { writes: StateWrite[]; warnings: string[] } {
  if (!writes.some((write) => write.op === 'add' && write.item.messages)) return { writes, warnings: [] };
  const names = new Map(definitions.map((definition) => [definition.id, definition.name]));
  return commitItemLinks(writes, history, ({ target }) =>
    target.kind === 'definition'
      ? `${names.get(target.definitionId) ?? 'A deleted definition'}.${target.key}`
      : `${target.key} of a node`,
  );
}
